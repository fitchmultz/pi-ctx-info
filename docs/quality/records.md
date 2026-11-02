# Quality records

[Back to development](../development.md) · [Adopted standard](standard.md) · [Machine-readable exceptions](exceptions.json)

## Adoption record

- **Repository and adopted version:** `fitchmultz/pi-ctx-info`, [Strict Oxlint and Oxfmt Engineering Standard](standard.md) v5.1.2, adopted by the migration PR on branch `oxlint-oxfmt-standard`.
- **Supported runtimes and package manager:** Node `>=24.15.0`, npm 12.2.0.
- **Installed tool versions:** oxlint 1.90.0, oxfmt 0.75.0, oxlint-tsgolint 7.0.2005 (tsgolint type service), TypeScript 7.0.2, `@types/node` 24.19.0.
- **Config and acceptance paths:** `.oxlintrc.json` (baseline copy of the standard's Appendix A plus the recorded exceptions below), `.oxfmtrc.json` (standard defaults; tabs follow the repository's established convention). Acceptance runs `npm run check:compat`, which executes `scripts/run-checks.ts` to run every gate independently and aggregate failures: `check:lock`, `check:policy`, `format:check`, `lint`, `check` (tsc), and `test`.
- **Compiler projects and source profiles:** one TypeScript project (`tsconfig.json`) covering `*.ts` and `scripts/*.ts`; strict ESM NodeNext with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`, and `verbatimModuleSyntax`. Tests run directly through Node's type stripping. Lint applies the standard's test profile to `**/*.test.ts`.
- **Formatter and generator ownership:** oxfmt owns formatting for all maintained text (TypeScript, JSON, Markdown, YAML); npm owns `package-lock.json` bytes (excluded via `.oxfmtrc.json` `ignorePatterns`). The repository has no generators or generated output; `.github/readme/*.svg` is a static asset.
- **Migration status:** complete. The `.mjs` tests were converted to TypeScript with a shared typed harness (`test-harness.ts`), all node:test registrations use the aliased forms covered by QX-001, and `check:policy` permanently verifies baseline integrity, source coverage, recorded exceptions, and the enforcement controls.
- **One-time adoption verifications:** acceptance wiring was demonstrated with disposable violations (lint, formatting, compiler, and test-assertion failures in scratch files) that failed four gates in one `check:compat` run with aggregate exit code 4, while the lockfile and policy gates still ran and passed; the scratch files were removed and the same command returned exit code 0. Repeated `oxfmt --write` is stable (`format:check` passes after a second write). A representative policy downgrade (complexity relaxed to `warn`, max 99) and an uncovered maintained source (a root-level `.mts` file) are both rejected by `check:policy` on every run.
- **Integrated verification result:** `npm run check:compat` passes all six gates on the adopting branch (see the PR checks for the exact revision).

## QX-001: node:test registration safe-calls allowance

- **ID and title:** QX-001 — aliased node:test registration calls are known-safe registrations, not floating promises.
- **Rule, option, or threshold; installed tool versions:** `typescript/no-floating-promises` `allowForKnownSafeCalls`; oxlint 1.90.0 with oxlint-tsgolint 7.0.2005.
- **Scope:** calls to `nodeTest`, `nodeIt`, and `nodeDescribe` — the only registration forms this repository uses — bound to the `node:test` package declaration origin. Every other option stays at its strict default (`ignoreVoid: false`, `checkThenables: true`, empty `allowForKnownSafePromises`).
- **Directive selectors/inventory and optional duplication bounds:** config-level allowance; no source directives. The machine-readable form is [`QX-001` in exceptions.json](exceptions.json).
- **Diagnostic and required contract:** without the allowance, every unawaited test registration in `breakdown.test.ts`, `snapshot.test.ts`, and `overlay.test.ts` fails `no-floating-promises`.
- **Actual compliant alternative and demonstrated quality cost:** awaiting registrations, async suites, or `Promise.all` collections change module evaluation and hook timing under node:test's registration model (standard §6.4), for all 16 tests, with no behavioral gain.
- **Chosen adjustment and why its scope is appropriate:** `allowForKnownSafeCalls` matching **aliased** local names (`nodeTest`, `nodeIt`, `nodeDescribe`). Bare `test`/`it`/`describe` and context subtests such as `t.test()` stay flagged: name-matching that permits the context-subtest control is too broad (standard §6.4).
- **Structural comparison or unsafe-type evidence:** not applicable (no assertion involved).
- **Verification commands, relevant tests, and results:** `node scripts/verify-quality-policy.ts` runs all six required controls on temporary fixtures and passes: (1) unawaited aliased top-level and suite registrations lint clean; (2) an unawaited context subtest `t.test()` fails with `no-floating-promises`; (3) a same-named local Promise-returning `nodeTest` fails; (4) a same-named function imported from another module fails; (5) a floating Promise inside a test body fails; (6) an unrelated floating Promise call fails.
- **Retained protection, lost detection, and established assumptions:** all other floating-promise detection is retained. Known detection limit (standard §6.4): declaration matching does not establish runtime calling context, so an imported registration invoked inside a running test would create a subtest while still matching this allowance. This repository's tests invoke subtests only through `t.*` context methods, which the allowance does not match.
- **Review and revisit trigger:** a node:test or oxlint upgrade that changes registration semantics or allowance matching, or any new registration form in the tests (extend the fixture controls first).

## QX-002: test-harness /ctx handler assertion

- **ID and title:** QX-002 — the shared test harness asserts the registered `/ctx` handler against the narrowed context double once, at the package boundary.
- **Rule, option, or threshold; installed tool versions:** `typescript/no-unsafe-type-assertion`; oxlint 1.90.0 with oxlint-tsgolint 7.0.2005.
- **Scope:** exactly one site, `ctxHandler` in `test-harness.ts`; the directive is tagged `QX-002` and cross-checked against [`QX-002` in exceptions.json](exceptions.json) by `check:policy` (unknown, stale, or extra directives fail).
- **Directive selectors/inventory and optional duplication bounds:** `ctxHandler: command.handler as (args: string, ctx: CtxCommandContext) => Promise<void>`; duplication bound: one.
- **Diagnostic and required contract:** the assertion narrows the handler registered against Pi's full `ExtensionCommandContext` to the `CtxCommandContext` contract the overlay consumes.
- **Actual compliant alternative and demonstrated quality cost:** building a full `ExtensionCommandContext` double (dozens of unrelated members) or widening the overlay's contract to all of Pi's context. The double deliberately implements only the members the overlay consumes; any member the overlay uses beyond them is missing on the double and fails closed at runtime. The single assertion encodes that boundary instead of duplicating Pi's entire context surface in tests.
- **Chosen adjustment and why its scope is appropriate:** one operation-bound directive at the package seam — not a file-wide or test-wide disable.
- **Structural comparison or unsafe-type evidence:** `CtxCommandContext` is a structural subset (narrowed `Pick`-based view) of the handler's declared context parameter, so the assertion is a pure narrowing at a boundary the runtime double enforces.
- **Verification commands, relevant tests, and results:** `npm run check:policy` (manifest cross-check) and the full gate suite pass; `npm test` runs the handler through the double in all 16 tests, including coverage of every context member the overlay reads.
- **Retained protection, lost detection, and established assumptions:** every other type assertion in the repository must be a justified narrowing or guard-based; `reportUnusedDisableDirectives: error` keeps the directive honest. Assumption: the overlay consumes only `CtxCommandContext` members — extended by design when the overlay starts reading more context.
- **Review and revisit trigger:** the overlay consuming a new context member (extend the double and contract together), or Pi changing the command-context contract.
