#!/usr/bin/env node

import * as yargs from "yargs";
import { ModelGen } from "./index";

async function main() {
  const argv = yargs
    .help()
    .usage(
      "$0 <schema-file> <output-dir>",
      "Generate sequelize models from schema.graphql"
    ).argv;
  await ModelGen.run({
    graphqlSchemaPath: argv.schemaFile as string,
    outputDir: argv.outputDir as string,
  });
}

main();
