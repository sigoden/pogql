class FieldType {
  public name: string;
  public tsType: string;
  public fieldScalar: string;
  public sequelizeType: string;
  constructor(
    name: string,
    tsType: string,
    fieldScalar: string,
    sequelizeType: string
  ) {
    this.name = name;
    this.tsType = tsType;
    this.fieldScalar = fieldScalar;
    this.sequelizeType = sequelizeType;
  }
}

const fieldTypes = {
  BigInt: new FieldType("BigInt", "bigint", "BigInt", "numeric"),
  Boolean: new FieldType("Boolean", "boolean", "Boolean", "boolean"),
  Bytes: new FieldType("Bytes", "string", "Bytes", "blob"),
  Date: new FieldType("Date", "Date", "Date", "timestamp"),
  Float: new FieldType("Float", "number", "Float", "float"),
  ID: new FieldType("ID", "string", "ID", "text"),
  Int: new FieldType("Int", "number", "Int", "integer"),
  Json: new FieldType("Json", "", "", "jsonb"),
  String: new FieldType("String", "string", "String", "text"),
};

export function getTypeByScalarName(type: string): FieldType {
  return Object.values(fieldTypes).find(
    ({ name }) => name === type
  ) as FieldType;
}
