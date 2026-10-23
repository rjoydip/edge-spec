# Examples

Small applications and modules for exercising EdgeSpec locally. Most examples
are intentionally incomplete; `complete-app` is the one that should produce
"No missing tests."

## Run everything

```bash
bun test
bun test --coverage examples/coverage-gaps
```

The reference tests live in each example's `tests/` folder, or beside the
source for `coverage-gaps` and `complete-app`. Keeping them out of `src/` means
EdgeSpec still reports the incomplete examples as gaps.

## Framework and shape examples

| Folder           | Shape                    | What is incomplete                                  |
| ---------------- | ------------------------ | --------------------------------------------------- |
| `hono/`          | Hono routes              | `app.ts` has no `app.test.ts`                       |
| `express/`       | Express routes           | `app.ts` has no `app.test.ts`                       |
| `elysia/`        | Elysia routes            | `app.ts` has no `app.test.ts`                       |
| `node/`          | `node:http` server       | `server.ts` has no `server.test.ts`                 |
| `openapi/`       | OpenAPI spec + server    | `server.ts` has no test; the spec is `openapi.json` |
| `missing-files/` | Three plain modules      | Every file in `src/` has no sibling test            |
| `coverage-gaps/` | One module, partial test | `pricing.test.ts` exists but covers only one branch |
| `complete-app/`  | Minimal complete app     | Nothing: source and sibling test are both present   |

The reference tests show what a passing suite looks like, including `supertest`
for Express and `app.request` / `app.handle` for Hono and Elysia.

## Coverage gaps

EdgeSpec's scanner is file-level: it reports a source file when its sibling
`*.test.ts` file is missing. It does not measure branch coverage. The
`coverage-gaps/` example makes that visible: `pricing.test.ts` exists, so the
scanner reports no gap, but it tests only one of the four paths.

```bash
bun test --coverage examples/coverage-gaps
```

`complete-app/` is the control case for the scanner: the source and its sibling
test both exist, and the test covers both branches. It should produce no gap.

## Using with EdgeSpec

1. Push this folder, or a single example folder, to GitHub.
2. Start the Worker and dashboard:

   ```bash
   bun run dev:worker
   bun run dev
   ```

3. Scan the repository and generate a test for a file in `src/` or the example
   folder.
4. Validate locally with `bun test path/to/example`, or configure a sandbox
   runner. Without a runner, EdgeSpec reports `static check only`; it never
   claims the suite ran.

The framework examples import Hono, Express or Elysia. A sandbox needs those
dependencies installed in its image; the default EdgeSpec sandbox only receives
the source and generated test files. Run those examples locally with the
workspace dependencies when you are not using a prepared runner.
