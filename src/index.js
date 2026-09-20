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

export function inspectEnv(actualText, exampleText, { strict = false, ignoreExtra = [] } = {}) {
  const actual = parseEnv(actualText);
  const example = parseEnv(exampleText);
  const actualKeys = new Set(actual.entries.keys());
  const exampleKeys = new Set(example.entries.keys());
  const missing = [...exampleKeys].filter((key) => !actualKeys.has(key)).sort();
  const extraKeys = [...actualKeys].filter((key) => !exampleKeys.has(key));
  const ignoredExtra = extraKeys.filter((key) => ignoreExtra.some((pattern) => matchesPattern(key, pattern))).sort();
  const extra = extraKeys.filter((key) => !ignoredExtra.includes(key)).sort();
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
    ignoredExtra,
    duplicates: { env: actual.duplicates, example: example.duplicates },
    suspiciousExamples,
    counts: { env: actualKeys.size, example: exampleKeys.size }
  };
}

export function formatReport(report) {
  const lines = [report.ok ? "env-guard: OK" : "env-guard: problems found"];
  add(lines, "Missing from .env", report.missing);
  add(lines, "Extra in .env", report.extra, !report.strict ? " (warning)" : "");
  add(lines, "Ignored extra in .env", report.ignoredExtra);
  add(lines, "Duplicate in .env", report.duplicates.env);
  add(lines, "Duplicate in example", report.duplicates.example);
  add(lines, "Possible secret in example", report.suspiciousExamples);
  lines.push(`Checked ${report.counts.env} env keys against ${report.counts.example} example keys.`);
  return lines.join("\n");
}

export function formatGitHubReport(report) {
  const lines = [];
  annotate(lines, "error", "Missing from .env", report.missing);
  annotate(lines, report.strict ? "error" : "warning", "Extra in .env", report.extra);
  annotate(lines, "notice", "Ignored extra in .env", report.ignoredExtra);
  annotate(lines, "error", "Duplicate in .env", report.duplicates.env);
  annotate(lines, "error", "Duplicate in example", report.duplicates.example);
  annotate(lines, "error", "Possible secret in example", report.suspiciousExamples);
  if (!lines.length) lines.push("::notice title=env-guard::Environment contract is valid");
  return lines.join("\n");
}

function add(lines, title, values, suffix = "") {
  if (values.length) lines.push(`${title}${suffix}: ${values.join(", ")}`);
}

function annotate(lines, level, title, values) {
  for (const value of values) {
    lines.push(`::${level} title=${escapeAnnotation(title, true)}::${escapeAnnotation(value)}`);
  }
}

function escapeAnnotation(value, property = false) {
  const escaped = String(value).replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  return property ? escaped.replaceAll(":", "%3A").replaceAll(",", "%2C") : escaped;
}

export async function runCli(argv, io = {}) {
  const args = parseArgs(argv);
  const read = io.readFile ?? ((path) => readFile(path, "utf8"));
  const readStdin = io.readStdin ?? readStandardInput;
  const write = io.write ?? ((value) => process.stdout.write(`${value}\n`));
  if (args.env === "-" && args.example === "-") {
    throw new Error("Only one input may be read from stdin");
  }
  const readInput = (path) => path === "-" ? readStdin() : read(path);
  const [actual, example] = await Promise.all([readInput(args.env), readInput(args.example)]);
  const report = inspectEnv(actual, example, { strict: args.strict, ignoreExtra: args.ignoreExtra });
  const output = args.json
    ? JSON.stringify(report, null, 2)
    : args.github
      ? formatGitHubReport(report)
      : formatReport(report);
  write(output);
  return report.ok ? 0 : 1;
}

async function readStandardInput() {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function parseArgs(argv) {
  const result = { env: ".env", example: ".env.example", strict: false, json: false, github: false, ignoreExtra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env") result.env = required(argv[++i], "--env");
    else if (arg === "--example") result.example = required(argv[++i], "--example");
    else if (arg === "--strict") result.strict = true;
    else if (arg === "--json") result.json = true;
    else if (arg === "--github") result.github = true;
    else if (arg === "--ignore-extra") result.ignoreExtra.push(required(argv[++i], "--ignore-extra"));
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (result.json && result.github) throw new Error("Choose either --json or --github");
  return result;
}

function matchesPattern(key, pattern) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*\*?$/.test(pattern)) {
    throw new TypeError(`Invalid ignore pattern: ${pattern}`);
  }
  return pattern.endsWith("*") ? key.startsWith(pattern.slice(0, -1)) : key === pattern;
}

function required(value, option) {
  if (!value) throw new Error(`${option} requires a path`);
  return value;
}
