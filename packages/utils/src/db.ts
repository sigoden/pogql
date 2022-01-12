import { buildSchema, getAllEntitiesRelations } from "@pogql/graphql";
import * as crypto from "crypto";
import { isEqual, isBuffer } from "lodash";
import { getTypeByScalarName, GraphQLModelsType } from "@pogql/graphql";
import {
  Sequelize,
  Utils,
  ModelAttributes,
  ModelAttributeColumnOptions,
} from "sequelize";
import {
  getFkConstraint,
  smartTags,
  commentConstraintQuery,
  createUniqueIndexQuery,
} from "./helper";

export function modelsTypeToModelAttributes(
  modelType: GraphQLModelsType,
  enums: Map<string, string>
): ModelAttributes<any> {
  const fields = modelType.fields;
  return Object.values(fields).reduce((acc, field) => {
    const allowNull = field.nullable;
    const columnOption: ModelAttributeColumnOptions<any> = {
      type: field.isEnum
        ? `${enums.get(field.type)}${field.isArray ? "[]" : ""}`
        : field.isArray
        ? getTypeByScalarName("Json").sequelizeType
        : getTypeByScalarName(field.type).sequelizeType,
      comment: field.description,
      allowNull,
      primaryKey: field.type === "ID",
    };
    if (field.type === "BigInt") {
      columnOption.get = function () {
        const dataValue = this.getDataValue(field.name);
        return dataValue ? BigInt(dataValue) : null;
      };
      columnOption.set = function (val: unknown) {
        this.setDataValue(field.name, val?.toString());
      };
    }
    if (field.type === "Bytes") {
      columnOption.get = function () {
        const dataValue = this.getDataValue(field.name);
        if (!dataValue) {
          return null;
        }
        if (!isBuffer(dataValue)) {
          throw new Error(
            `Bytes: column.get() returned type is not buffer type`
          );
        }
        return dataValue.toString("hex");
      };
      columnOption.set = function (val: unknown) {
        if (val === undefined || val === null) {
          this.setDataValue(field.name, null);
        } else if (typeof val === "string" && isHex(val)) {
          this.setDataValue(field.name, hexToBuffer(val));
        } else {
          throw new Error(
            `input for Bytes type is only support unprefixed hex`
          );
        }
      };
    }
    acc[field.name] = columnOption;
    return acc;
  }, {} as ModelAttributes<any>);
}

export interface Options {
  pgSchema: string;
  graphqlSchemaPath: string;
  timestampField: boolean;
  indexCountLimit: number;
}

export async function sync(sequelize: Sequelize, options: Options) {
  const graphqlSchema = buildSchema(options.graphqlSchemaPath);
  const modelsRelations = getAllEntitiesRelations(graphqlSchema);

  const enumTypeMap = new Map<string, string>();

  for (const e of modelsRelations.enums) {
    // We shouldn't set the typename to e.name because it could potentially create SQL injection,
    // using a replacement at the type name location doesn't work.
    const enumTypeName = `${options.pgSchema}_enum_${enumNameToHash(e.name)}`;

    const [results] = await sequelize.query(
      `select e.enumlabel as enum_value
         from pg_type t
         join pg_enum e on t.oid = e.enumtypid
         where t.typname = ?;`,
      { replacements: [enumTypeName] }
    );

    if (results.length === 0) {
      await sequelize.query(
        `CREATE TYPE "${enumTypeName}" as ENUM (${e.values
          .map(() => "?")
          .join(",")});`,
        {
          replacements: e.values,
        }
      );
    } else {
      const currentValues = results.map((v: any) => v.enum_value);
      // Assert the existing enum is same

      // Make it a function to not execute potentially big joins unless needed
      if (!isEqual(e.values, currentValues)) {
        throw new Error(
          `\n * Can't modify enum "${
            e.name
          }" between runs: \n * Before: [${currentValues.join(
            `,`
          )}] \n * After : [${e.values.join(
            ","
          )}] \n * You must rerun the project to do such a change`
        );
      }
    }

    const comment = `@enum\\n@enumName ${e.name}${
      e.description ? `\\n ${e.description}` : ""
    }`;

    await sequelize.query(`COMMENT ON TYPE "${enumTypeName}" IS E?`, {
      replacements: [comment],
    });
    enumTypeMap.set(e.name, `"${enumTypeName}"`);
  }
  for (const model of modelsRelations.models) {
    const attributes = modelsTypeToModelAttributes(model, enumTypeMap);
    const indexes = model.indexes.map(({ fields, unique, using }) => ({
      fields: fields.map((field) => Utils.underscoredIf(field, true)),
      unique,
      using,
    }));
    if (indexes.length > options.indexCountLimit) {
      throw new Error(`too many indexes on entity ${model.name}`);
    }
    sequelize.define(model.name, attributes, {
      underscored: true,
      comment: model.description,
      freezeTableName: false,
      createdAt: options.timestampField,
      updatedAt: options.timestampField,
      schema: options.pgSchema,
      indexes,
    });
  }
  const extraQueries = [];
  for (const relation of modelsRelations.relations) {
    const model = sequelize.model(relation.from);
    const relatedModel = sequelize.model(relation.to);
    switch (relation.type) {
      case "belongsTo": {
        model.belongsTo(relatedModel, { foreignKey: relation.foreignKey });
        break;
      }
      case "hasOne": {
        const rel = model.hasOne(relatedModel, {
          foreignKey: relation.foreignKey,
        });
        const fkConstraint = getFkConstraint(
          rel.target.tableName,
          rel.foreignKey
        );
        const tags = smartTags({
          singleForeignFieldName: relation.fieldName,
        });
        extraQueries.push(
          commentConstraintQuery(
            `"${options.pgSchema}"."${rel.target.tableName}"`,
            fkConstraint,
            tags
          ),
          createUniqueIndexQuery(
            options.pgSchema,
            relatedModel.tableName,
            relation.foreignKey
          )
        );
        break;
      }
      case "hasMany": {
        const rel = model.hasMany(relatedModel, {
          foreignKey: relation.foreignKey,
        });
        const fkConstraint = getFkConstraint(
          rel.target.tableName,
          rel.foreignKey
        );
        const tags = smartTags({
          foreignFieldName: relation.fieldName,
        });
        extraQueries.push(
          commentConstraintQuery(
            `"${options.pgSchema}"."${rel.target.tableName}"`,
            fkConstraint,
            tags
          )
        );

        break;
      }
      default:
        throw new Error("Relation type is not supported");
    }
  }
  await sequelize.sync();
  for (const query of extraQueries) {
    await sequelize.query(query);
  }
}

function enumNameToHash(enumName: string): string {
  return sha256(enumName).slice(0, 8);
}

function sha256(str: string): string {
  return crypto.createHash("sha256").update(Buffer.from(str)).digest("base64");
}

function isHex(str: string) {
  if (str.startsWith("0x")) str = str.slice(2);
  return /^[A-F0-9]+$/i.test(str);
}

function hexToBuffer(str: string) {
  if (str.startsWith("0x")) str = str.slice(2);
  return Buffer.from(str, "hex");
}
