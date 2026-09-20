# env-guard

Catch environment-file drift before deployment—without printing secret values.

`env-guard` compares a local `.env` with `.env.example` and reports missing keys, unexpected keys, duplicates, and likely real secrets accidentally placed in the example file. It has no runtime dependencies.

## Quick start

```bash
npx @forgesaroj/env-guard
npx @forgesaroj/env-guard --strict --json
npx @forgesaroj/env-guard --env .env.production --example .env.example
npx print-env | npx @forgesaroj/env-guard --env - --example .env.example
npx @forgesaroj/env-guard --strict --ignore-extra CI --ignore-extra 'VERCEL_*'
```

Exit codes are `0` for a clean check, `1` for validation problems, and `2` for usage or file errors. Extra variables are warnings unless `--strict` is used. Values are never included in reports.

Use repeatable `--ignore-extra` options for known platform-managed keys. A pattern may be an exact key such as `CI` or a trailing-wildcard prefix such as `VERCEL_*`; ignored keys remain visible in the report for auditability.

Pass `-` to either `--env` or `--example` to read that input from standard input. Only one input may use standard input at a time, which makes generated or secret-managed environments easy to validate without writing them to disk.

## CI example

```yaml
- name: Check environment contract
  run: npx @forgesaroj/env-guard --strict
```

## What it checks

- keys present in the example but missing from the real environment;
- keys present only in the real environment;
- repeated definitions in either file;
- secret-looking keys with non-placeholder values in `.env.example`.

This is a guardrail, not a full secret scanner. Pair it with your platform's secret management and repository scanning.

## Development

```bash
npm test
npm run check
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. MIT licensed.
