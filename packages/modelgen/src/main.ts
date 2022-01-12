#!/usr/bin/env node

import * as yargs from "yargs";
import { codegen } from "./index";

function main() {
  const argv = yargs
    .help()
    .usage(
      "$0 <schema-file> <output-dir>",
      "Generate sequelize models from schema.graphql"
    ).argv;
  codegen({
    graphqlSchemaPath: argv.schemaFile as string,
    outputDir: argv.outputDir as string,
  });
}

main();
