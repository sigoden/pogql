import fs from "fs";
import path from "path";
import { promisify } from "util";
import {
  getAllEntitiesRelations,
  getAllJsonObjects,
  setJsonObjectType,
  getFieldType,
  GraphQLEntityField,
  GraphQLJsonFieldType,
  GraphQLEntityIndex,
  GraphQLSchema,
  getAllEnums,
  buildSchema,
  GraphQLEnumsType,
} from "@pogql/graphql";
import ejs from "ejs";
import { upperFirst } from "lodash";
import inflection from "inflection";
import rimraf from "rimraf";

export interface Options {
  graphqlSchemaPath: string;
  outputDir: string;
  modelOptions?: CommonModelOptions;
}

export interface CommonModelOptions {
  underscored: boolean;
  freezeTableName: boolean;
  createdAt: boolean;
  updatedAt: boolean;
}

export const DEFUALT_TABLE_OPTIONS: CommonModelOptions = {
  underscored: true,
  freezeTableName: false,
  createdAt: true,
  updatedAt: true,
};

export async function codegen(options: Options): Promise<void> {
  options.modelOptions = {
    ...DEFUALT_TABLE_OPTIONS,
    ...(options.modelOptions || {}),
  };
  const schema: GraphQLSchema = buildSchema(options.graphqlSchemaPath);
  const exportTypes: ExportTypes = {
    models: false,
    interfaces: false,
    enums: false,
  };
  const ctx: CodeGenContext = {
    options,
    schema,
    exportTypes,
    resolveTemplate: (subPath) => path.resolve(__dirname, "templates", subPath),
    resolveOutput: (subpath) => path.resolve(options.outputDir, subpath),
  };
  await prepareDirPath(ctx.resolveOutput("models"), true);
  await generateModels(ctx);
  await generateJsonInterfaces(ctx);
  await generateEnums(ctx);

  if (exportTypes.interfaces || exportTypes.models || exportTypes.enums) {
    try {
      await renderTemplate(
        ctx.resolveTemplate("index.ts.ejs"),
        path.resolve(ctx.options.outputDir, "index.ts"),
        {
          props: {
            exportTypes,
          },
        }
      );
    } catch (e) {
      throw new Error(`When render index in types having problems.`);
    }
    console.log(`* Types index generated !`);
  }
}

interface CodeGenContext {
  options: Options;
  schema: GraphQLSchema;
  exportTypes: ExportTypes;
  resolveTemplate: (subPath: string) => string;
  resolveOutput: (subPath: string) => string;
}

interface ExportTypes {
  models: boolean;
  interfaces: boolean;
  enums: boolean;
}

async function generateJsonInterfaces(ctx: CodeGenContext): Promise<void> {
  const jsonObjects = getAllJsonObjects(ctx.schema);
  const jsonInterfaces = jsonObjects.map((r) => {
    const object = setJsonObjectType(r, jsonObjects);
    const fields = processJsonFields(object.name, object.fields);
    return {
      interfaceName: object.name,
      fields,
    };
  });

  if (jsonInterfaces.length !== 0) {
    const interfaceTemplate = {
      props: {
        jsonInterfaces,
      },
      helper: {
        upperFirst,
      },
    };
    try {
      await renderTemplate(
        ctx.resolveTemplate("interface.ts.ejs"),
        ctx.resolveOutput("interfaces.ts"),
        interfaceTemplate
      );
      ctx.exportTypes.interfaces = true;
    } catch (e) {
      throw new Error(`When render json interfaces having problems.`);
    }
  }
}

async function generateEnums(ctx: CodeGenContext): Promise<void> {
  const jsonObjects = getAllEnums(ctx.schema);
  const enums = jsonObjects.map((r) => {
    return {
      name: r.name,
      values: r.getValues().map((v) => v.name),
    };
  });

  if (enums.length !== 0) {
    const enumsTemplate = {
      props: {
        enums,
      },
    };
    try {
      await renderTemplate(
        ctx.resolveTemplate("enum.ts.ejs"),
        ctx.resolveOutput("enums.ts"),
        enumsTemplate
      );
      ctx.exportTypes.enums = true;
    } catch (e) {
      throw new Error(`When render enums having problems.`);
    }
  }
}

async function generateModels(ctx: CodeGenContext): Promise<void> {
  const extractEntities = getAllEntitiesRelations(ctx.schema);
  for (const entity of extractEntities.models) {
    const className = upperFirst(entity.name);
    const entityName = entity.name;
    const fields = processEntityFields(
      className,
      entity.fields,
      entity.indexes,
      extractEntities.enums
    );
    const importJsonInterfaces = fields
      .filter((field) => field.isJsonInterface)
      .map((f) => f.type);
    const importEnums = fields
      .filter((field) => field.isEnum)
      .map((f) => f.type);
    const indexes = entity.indexes.map(({ fields, unique, using }) => ({
      fields: JSON.stringify(
        fields.map((field) => inflection.underscore(field))
      ),
      unique,
      using,
    }));
    const id = entity.fields.find((field) => field.type === "ID").name;
    const modelTemplate = {
      props: {
        id,
        className,
        entityName,
        fields,
        importJsonInterfaces,
        importEnums,
        modelOptions: {
          ...ctx.options.modelOptions,
          comment: entity.description,
          indexes,
        },
      },
      helper: {
        upperFirst,
      },
    };
    try {
      await renderTemplate(
        ctx.resolveTemplate("model.ts.ejs"),
        ctx.resolveOutput(`models/${className}.ts`),
        modelTemplate
      );
    } catch (e) {
      console.error(e);
      throw new Error(
        `When render entity ${className} to schema having problems.`
      );
    }
    console.log(`* Schema ${className} generated !`);
  }
  const classNames = extractEntities.models.map((entity) => entity.name);
  if (classNames.length !== 0) {
    try {
      await renderTemplate(
        ctx.resolveTemplate("models-index.ts.ejs"),
        ctx.resolveOutput("models/index.ts"),
        {
          props: {
            classNames,
          },
          helper: {
            upperFirst,
          },
        }
      );
      ctx.exportTypes.models = true;
    } catch (e) {
      throw new Error(`When render index in models having problems.`);
    }
    console.log(`* Models index generated !`);
  }
}

async function renderTemplate(
  templatePath: string,
  outputPath: string,
  templateData: ejs.Data
): Promise<void> {
  const data = await ejs.renderFile(templatePath, templateData);
  await fs.promises.writeFile(outputPath, data);
}

function processJsonFields(
  className: string,
  fields: GraphQLJsonFieldType[]
): ProcessedJsonField[] {
  const fieldList: ProcessedJsonField[] = [];
  for (const field of fields) {
    const injectField = {
      name: field.name,
      required: !field.nullable,
      isArray: field.isArray,
      isEnum: false,
    } as ProcessedJsonField;
    switch (field.type) {
      default: {
        injectField.type = getFieldType(field.type).tsType;
        if (!injectField.type) {
          throw new Error(
            `Schema: undefined type "${field.type.toString()}" on field "${
              field.name
            }" in "type ${className} @jsonField"`
          );
        }
        break;
      }
      case "Json": {
        if (field.jsonInterface === undefined) {
          throw new Error(
            `On field ${field.name} type is Json but json interface is not defined`
          );
        }
        injectField.type = upperFirst(field.jsonInterface.name);
      }
    }
    fieldList.push(injectField);
  }
  return fieldList;
}

interface ProcessedJsonField {
  name: string;
  type: string;
  required: boolean;
  isArray: boolean;
  isEnum: boolean;
}

function processEntityFields(
  className: string,
  fields: GraphQLEntityField[],
  indexFields: GraphQLEntityIndex[] = [],
  enums: GraphQLEnumsType[]
): ProcessedEntityField[] {
  const fieldList: ProcessedEntityField[] = [];
  for (const field of fields) {
    const injectField = {
      name: field.name,
      required: !field.nullable,
      isArray: field.isArray,
      isEnum: false,
    } as ProcessedEntityField;
    const [indexed, unique] = indexFields.reduce<[boolean, boolean]>(
      (acc, indexField) => {
        if (indexField.fields.includes(field.name)) {
          acc[0] = true;
          if (indexField.fields.length === 1 && indexField.unique) {
            acc[1] = true;
          } else if (indexField.unique === undefined) {
            acc[1] = false;
          }
        }
        return acc;
      },
      [false, undefined]
    );
    injectField.indexed = indexed;
    injectField.unique = unique;
    if (field.isEnum) {
      injectField.type = field.type;
      injectField.isEnum = true;
      injectField.isJsonInterface = false;
    } else {
      switch (field.type) {
        default: {
          injectField.type = getFieldType(field.type).tsType;
          if (!injectField.type) {
            throw new Error(
              `Schema: undefined type "${field.type.toString()}" on field "${
                field.name
              }" in "type ${className} @entity"`
            );
          }
          injectField.isJsonInterface = false;
          break;
        }
        case "Json": {
          if (field.jsonInterface === undefined) {
            throw new Error(
              `On field ${field.name} type is Json but json interface is not defined`
            );
          }
          injectField.type = upperFirst(field.jsonInterface.name);
          injectField.isJsonInterface = true;
        }
      }
    }
    injectField.sequelize = processSequelizeProps(className, field, enums);
    fieldList.push(injectField);
  }
  return fieldList;
}

function processSequelizeProps(
  className: string,
  field: GraphQLEntityField,
  enums: GraphQLEnumsType[]
): SequelizeProps {
  const primaryKey = field.type === "ID";
  const common = {
    primaryKey,
    comment: field.description,
    allowNull: field.nullable,
  };
  switch (field.type) {
    case "BigInt":
      return {
        type: `DataTypes.DECIMAL`,
        ...common,
      };
    case "Boolean":
      return {
        type: `DataTypes.BOOLEAN`,
        get: ``,
        ...common,
      };
    case "Bytes":
      return {
        type: `DataTypes.BLOB`,
        ...common,
      };
    case "Date":
      return {
        type: `DataTypes.DATE`,
        ...common,
      };
    case "Float":
      return {
        type: `DataTypes.FLOAT`,
        ...common,
      };
    case "ID":
      return {
        type: "DataTypes.TEXT",
        ...common,
      };
    case "Int":
      return {
        type: "DataTypes.INTEGER",
        ...common,
      };
    case "Json":
      return {
        type: "DataTypes.JSONB",
        ...common,
      };
    case "String":
      return {
        type: "DataTypes.TEXT",
        ...common,
      };
    default:
      if (field.isEnum) {
        const enumValues = enums.find((e) => e.name === field.type)?.values;
        if (enumValues) {
          let type = `DataTypes.ENUM(${JSON.stringify(enumValues)})`;
          if (field.isArray) {
            type = `DataTypes.Array(${type})`;
          }
          return {
            type,
            ...common,
          };
        }
      }
      throw new Error(
        `Schema: undefined type "${field.type.toString()}" on field "${
          field.name
        }" in "type ${className} @entity"`
      );
  }
}

interface ProcessedEntityField {
  name: string;
  type: string;
  required: boolean;
  indexed: boolean;
  unique?: boolean;
  isArray: boolean;
  isEnum: boolean;
  isJsonInterface: boolean;
  sequelize: SequelizeProps;
}

interface SequelizeProps {
  type: string;
  primaryKey: boolean;
  allowNull: boolean;
  comment?: string;
  get?: string;
  set?: string;
}

async function prepareDirPath(path: string, recreate: boolean) {
  try {
    await promisify(rimraf)(path);
    if (recreate) {
      await fs.promises.mkdir(path, { recursive: true });
    }
  } catch (e) {
    throw new Error(`Failed to prepare ${path}`);
  }
}
