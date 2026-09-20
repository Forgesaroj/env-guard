import { readFile } from "node:fs/promises";

const SECRET_KEY = /(secret|token|password|passwd|private[_-]?key|api[_-]?key)/i;
const PLACEHOLDER = /^(|change[-_ ]?me|example|your[_-].+|<.+>|\$\{.+\})$/i;

export function parseEnv(text) {
  const entries = new Map();
  const duplicates = new Set();

  for (const rawLine of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (entries.has(key)) duplicates.add(key);
    entries.set(key, unquote(rawValue.trim()));
  }

  return { entries, duplicates: [...duplicates].sort() };
}

function unquote(value) {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, "").trim();
}

export function inspectEnv(actualText, exampleText, { strict = false } = {}) {
  const actual = parseEnv(actualText);
  const example = parseEnv(exampleText);
  const actualKeys = new Set(actual.entries.keys());
  const exampleKeys = new Set(example.entries.keys());
  const missing = [...exampleKeys].filter((key) => !actualKeys.has(key)).sort();
  const extra = [...actualKeys].filter((key) => !exampleKeys.has(key)).sort();
  const suspiciousExamples = [...example.entries]
    .filter(([key, value]) => SECRET_KEY.test(key) && value && !PLACEHOLDER.test(value))
    .map(([key]) => key)
    .sort();
  const errors = missing.length + actual.duplicates.length + example.duplicates.length +
    suspiciousExamples.length + (strict ? extra.length : 0);

  return {
    ok: errors === 0,
    strict,
    missing,
    extra,
    duplicates: { env: actual.duplicates, example: example.duplicates },
    suspiciousExamples,
    counts: { env: actualKeys.size, example: exampleKeys.size }
  };
}

export function formatReport(report) {
  const lines = [report.ok ? "env-guard: OK" : "env-guard: problems found"];
  add(lines, "Missing from .env", report.missing);
  add(lines, "Extra in .env", report.extra, !report.strict ? " (warning)" : "");
  add(lines, "Duplicate in .env", report.duplicates.env);
  add(lines, "Duplicate in example", report.duplicates.example);
  add(lines, "Possible secret in example", report.suspiciousExamples);
  lines.push(`Checked ${report.counts.env} env keys against ${report.counts.example} example keys.`);
  return lines.join("\n");
}

function add(lines, title, values, suffix = "") {
  if (values.length) lines.push(`${title}${suffix}: ${values.join(", ")}`);
}

export async function runCli(argv, io = {}) {
  const args = parseArgs(argv);
  const read = io.readFile ?? ((path) => readFile(path, "utf8"));
  const write = io.write ?? ((value) => process.stdout.write(`${value}\n`));
  const [actual, example] = await Promise.all([read(args.env), read(args.example)]);
  const report = inspectEnv(actual, example, { strict: args.strict });
  write(args.json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.ok ? 0 : 1;
}

function parseArgs(argv) {
  const result = { env: ".env", example: ".env.example", strict: false, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") result.env = required(argv[++i], "--env");
    else if (arg === "--example") result.example = required(argv[++i], "--example");
    else if (arg === "--strict") result.strict = true;
    else if (arg === "--json") result.json = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return result;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a path`);
  return value;
}
