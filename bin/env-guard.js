#!/usr/bin/env node
import { runCli } from "../src/index.js";

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  console.error(`env-guard: ${error.message}`);
  process.exitCode = 2;
}
