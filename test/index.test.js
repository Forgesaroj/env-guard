import test from "node:test";
import assert from "node:assert/strict";
import { formatGitHubReport, inspectEnv, parseEnv, runCli } from "../src/index.js";

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

test("strict mode can ignore exact and prefix-matched platform keys", () => {
  const report = inspectEnv("APP=1\nCI=true\nVERCEL_ENV=production\nUNEXPECTED=x", "APP=", {
    strict: true,
    ignoreExtra: ["CI", "VERCEL_*"]
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.ignoredExtra, ["CI", "VERCEL_ENV"]);
  assert.deepEqual(report.extra, ["UNEXPECTED"]);
  assert.throws(() => inspectEnv("A=1", "", { ignoreExtra: ["BAD*PATTERN"] }), /Invalid ignore pattern/);
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

test("CLI accepts repeatable ignore patterns", async () => {
  let output = "";
  const code = await runCli(["--strict", "--json", "--ignore-extra", "CI", "--ignore-extra", "VERCEL_*"], {
    readFile: async (path) => path === ".env" ? "APP=1\nCI=true\nVERCEL_ENV=preview" : "APP=",
    write: (value) => { output = value; }
  });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(output).ignoredExtra, ["CI", "VERCEL_ENV"]);
});

test("CLI can read either environment contract input from stdin", async () => {
  const outputs = [];
  const io = {
    readFile: async (path) => path.endsWith("example") ? "A=" : "A=1",
    readStdin: async () => "A=1",
    write: (value) => outputs.push(value)
  };

  assert.equal(await runCli(["--env", "-"], io), 0);
  io.readStdin = async () => "A=";
  assert.equal(await runCli(["--example", "-"], io), 0);
  assert.equal(outputs.length, 2);
});

test("CLI rejects reading both inputs from stdin", async () => {
  await assert.rejects(
    runCli(["--env", "-", "--example", "-"], { readStdin: async () => "A=1" }),
    /Only one input/
  );
});

test("formats GitHub Actions annotations without exposing values", () => {
  const output = formatGitHubReport(inspectEnv("EXTRA=do-not-print", "TOKEN=live-secret"));
  assert.match(output, /::error title=Missing from \.env::TOKEN/);
  assert.match(output, /::warning title=Extra in \.env::EXTRA/);
  assert.match(output, /::error title=Possible secret in example::TOKEN/);
  assert.equal(output.includes("do-not-print"), false);
  assert.equal(output.includes("live-secret"), false);
});

test("CLI offers mutually exclusive GitHub annotation output", async () => {
  let output = "";
  const code = await runCli(["--github"], {
    readFile: async () => "A=1",
    write: (value) => { output = value; }
  });
  assert.equal(code, 0);
  assert.equal(output, "::notice title=env-guard::Environment contract is valid");
  await assert.rejects(runCli(["--github", "--json"]), /either --json or --github/);
});
