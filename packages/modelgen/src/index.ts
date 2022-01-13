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
  GraphQLModelsRelationsEnums,
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

export class ModelGen {
  private options: Options;
  private graphqlSchema: GraphQLSchema;
  private exportTypes: ExportTypes;
  private modelsRelations: GraphQLModelsRelationsEnums;
  public static async run(options: Options) {
    const gen = new ModelGen();
    options.modelOptions = {
      ...DEFUALT_TABLE_OPTIONS,
      ...(options.modelOptions || {}),
    };
    gen.options = options;
    gen.graphqlSchema = buildSchema(options.graphqlSchemaPath);
    gen.modelsRelations = getAllEntitiesRelations(gen.graphqlSchema);
    const exportTypes = {
      models: false,
      interfaces: false,
      enums: false,
    };
    gen.exportTypes = exportTypes;
    await prepareDirPath(gen.resolveOutput("models"), true);
    await gen.generateModels();
    await gen.generateJsonInterfaces();
    await gen.generateEnums();

    if (exportTypes.interfaces || exportTypes.models || exportTypes.enums) {
      try {
        await renderTemplate(
          gen.resolveTemplate("index.ts.ejs"),
          path.resolve(gen.options.outputDir, "index.ts"),
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
  resolveTemplate(subPath: string) {
    return path.resolve(__dirname, "templates", subPath);
  }
  resolveOutput(subpath: string) {
    return path.resolve(this.options.outputDir, subpath);
  }
  async generateJsonInterfaces() {
    const jsonObjects = getAllJsonObjects(this.graphqlSchema);
    const jsonInterfaces = jsonObjects.map((r) => {
      const object = setJsonObjectType(r, jsonObjects);
      const fields = this.processJsonFields(object.name, object.fields);
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
          this.resolveTemplate("interface.ts.ejs"),
          this.resolveOutput("interfaces.ts"),
          interfaceTemplate
        );
        this.exportTypes.interfaces = true;
      } catch (e) {
        throw new Error(`When render json interfaces having problems.`);
      }
    }
  }

  async generateEnums() {
    const jsonObjects = getAllEnums(this.graphqlSchema);
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
          this.resolveTemplate("enum.ts.ejs"),
          this.resolveOutput("enums.ts"),
          enumsTemplate
        );
        this.exportTypes.enums = true;
      } catch (e) {
        throw new Error(`When render enums having problems.`);
      }
    }
  }

  async generateModels() {
    for (const entity of this.modelsRelations.models) {
      const className = upperFirst(entity.name);
      const entityName = entity.name;
      const fields = this.processEntityFields(
        className,
        entity.fields,
        entity.indexes
      );
      const indexes = entity.indexes.map(({ fields, unique, using }) => ({
        fields: JSON.stringify(
          fields.map((field) => inflection.underscore(field))
        ),
        unique,
        using,
      }));
      const relations = this.modelsRelations.relations.filter(
        (r) => r.from === className
      );
      const importJsonInterfaces = fields
        .filter((field) => field.isJsonInterface)
        .map((f) => f.type);
      const importEnums = fields
        .filter((field) => field.isEnum)
        .map((f) => f.type);
      const importModelSet = new Set(relations.map((r) => r.to));
      importModelSet.delete(className);
      const importModels = Array.from(importModelSet);
      const id = entity.fields.find((field) => field.type === "ID").name;
      const modelTemplate = {
        props: {
          id,
          className,
          entityName,
          fields,
          relations,
          importModels,
          importJsonInterfaces,
          importEnums,
          modelOptions: {
            ...this.options.modelOptions,
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
          this.resolveTemplate("model.ts.ejs"),
          this.resolveOutput(`models/${className}.ts`),
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
    const classNames = this.modelsRelations.models.map((entity) => entity.name);
    if (classNames.length !== 0) {
      try {
        await renderTemplate(
          this.resolveTemplate("models-index.ts.ejs"),
          this.resolveOutput("models/index.ts"),
          {
            props: {
              classNames,
            },
            helper: {
              upperFirst,
            },
          }
        );
        this.exportTypes.models = true;
      } catch (e) {
        throw new Error(`When render index in models having problems.`);
      }
      console.log(`* Models index generated !`);
    }
  }

  processJsonFields(
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

  processEntityFields(
    className: string,
    fields: GraphQLEntityField[],
    indexFields: GraphQLEntityIndex[] = []
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
      injectField.sequelize = this.processSequelizeProps(className, field);
      fieldList.push(injectField);
    }
    return fieldList;
  }

  processSequelizeProps(
    className: string,
    field: GraphQLEntityField
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
          const enumValues = this.modelsRelations.enums.find(
            (e) => e.name === field.type
          )?.values;
          if (enumValues) {
            let type = `DataTypes.ENUM(${JSON.stringify(enumValues).slice(
              1,
              -1
            )})`;
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
}
interface ExportTypes {
  models: boolean;
  interfaces: boolean;
  enums: boolean;
}

interface ProcessedJsonField {
  name: string;
  type: string;
  required: boolean;
  isArray: boolean;
  isEnum: boolean;
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

async function renderTemplate(
  templatePath: string,
  outputPath: string,
  templateData: ejs.Data
): Promise<void> {
  const data = await ejs.renderFile(templatePath, templateData);
  await fs.promises.writeFile(outputPath, data);
}
