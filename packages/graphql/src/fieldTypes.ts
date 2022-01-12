class FieldType {
  public name: string;
  public tsType: string;
  public fieldScalar: string;
  constructor(name: string, tsType: string, fieldScalar: string) {
    this.name = name;
    this.tsType = tsType;
    this.fieldScalar = fieldScalar;
  }
}

const fieldTypes = {
  BigInt: new FieldType("BigInt", "bigint", "BigInt"),
  Boolean: new FieldType("Boolean", "boolean", "Boolean"),
  Bytes: new FieldType("Bytes", "string", "Bytes"),
  Date: new FieldType("Date", "Date", "Date"),
  Float: new FieldType("Float", "number", "Float"),
  ID: new FieldType("ID", "string", "ID"),
  Int: new FieldType("Int", "number", "Int"),
  Json: new FieldType("Json", "", ""),
  String: new FieldType("String", "string", "String"),
};

export function getFieldType(type: string): FieldType {
  return Object.values(fieldTypes).find(
    ({ name }) => name === type
  ) as FieldType;
}
