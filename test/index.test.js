import test from "node:test";
import assert from "node:assert/strict";
import { inspectEnv, parseEnv, runCli } from "../src/index.js";

test("parses comments, export syntax, quotes, and duplicates", () => {
  const result = parseEnv("# hi\nexport API_URL='https://example.test'\nPORT=3000 # local\nPORT=4000\n");
  assert.deepEqual([...result.entries], [["API_URL", "https://example.test"], ["PORT", "4000"]]);
  assert.deepEqual(result.duplicates, ["PORT"]);
});

test("reports missing and extra keys without exposing values", () => {
  const report = inspectEnv("API_URL=private\nEXTRA=x", "API_URL=\nTOKEN=<token>");
  assert.deepEqual(report.missing, ["TOKEN"]);
  assert.deepEqual(report.extra, ["EXTRA"]);
  assert.equal(JSON.stringify(report).includes("private"), false);
});

test("strict mode fails on extra keys", () => {
  assert.equal(inspectEnv("A=1\nB=2", "A=", { strict: false }).ok, true);
  assert.equal(inspectEnv("A=1\nB=2", "A=", { strict: true }).ok, false);
});

test("flags likely secrets committed to the example", () => {
  assert.deepEqual(inspectEnv("API_TOKEN=x", "API_TOKEN=live-secret-value").suspiciousExamples, ["API_TOKEN"]);
});

test("CLI supports injected IO and JSON output", async () => {
  let output = "";
  const code = await runCli(["--json"], {
    readFile: async (path) => path === ".env" ? "A=1" : "A=",
    write: (value) => { output = value; }
  });
  assert.equal(code, 0);
  assert.equal(JSON.parse(output).ok, true);
});
