import fs from "fs";
import {
  buildASTSchema,
  DocumentNode,
  extendSchema,
  GraphQLSchema,
  parse,
  Source,
} from "graphql";

import gql from "graphql-tag";

export const directives = gql`
  directive @derivedFrom(field: String!) on FIELD_DEFINITION
  directive @entity on OBJECT
  directive @jsonField on OBJECT
  directive @index(unique: Boolean) on FIELD_DEFINITION
`;

export const scalas = gql`
  scalar BigInt
  scalar BigDecimal
  scalar Date
  scalar Bytes
  scalar Float
`;

export function buildSchema(path: string): GraphQLSchema {
  const src = new Source(fs.readFileSync(path).toString());
  const doc = parse(src);
  return buildSchemaFromDocumentNode(doc);
}

export function buildSchemaFromDocumentNode(doc: DocumentNode): GraphQLSchema {
  return extendSchema(loadBaseSchema(), doc);
}

function loadBaseSchema(): GraphQLSchema {
  const schema = buildASTSchema(scalas);
  return extendSchema(schema, directives);
}
