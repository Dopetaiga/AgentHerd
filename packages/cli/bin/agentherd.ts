#!/usr/bin/env node
import { main } from "../src/main.ts";

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: Error) => {
    console.error(`agentherd: ${error.message}`);
    process.exit(1);
  },
);
