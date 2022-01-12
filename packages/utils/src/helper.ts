import { underscoredIf } from "sequelize/lib/utils";
import { camelCase } from "lodash";

export function camelCaseObjectKey(object: object) {
  return Object.keys(object).reduce(
    (result, key) => ({
      ...result,
      [camelCase(key)]: object[key],
    }),
    {}
  );
}

export function smartTags(tags: Record<string, string>): string {
  return Object.entries(tags)
    .map(([k, v]) => `@${k} ${v}`)
    .join("\n");
}

export function getFkConstraint(tableName: string, foreignKey: string): string {
  return [tableName, foreignKey, "fkey"].map(underscored).join("_");
}

export function getUniqConstraint(tableName: string, field: string): string {
  return [tableName, field, "uindex"].map(underscored).join("_");
}

export function commentConstraintQuery(
  table: string,
  constraint: string,
  comment: string
): string {
  return `COMMENT ON CONSTRAINT ${constraint} ON ${table} IS E'${comment}'`;
}

export function createUniqueIndexQuery(
  schema: string,
  table: string,
  field: string
): string {
  return `create unique index if not exists '${getUniqConstraint(
    table,
    field
  )}' on '${schema}.${table}' (${underscored(field)})`;
}

function underscored(input: string) {
  return underscoredIf(input, true);
}
