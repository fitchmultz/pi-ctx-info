# Development

[Back to the README](../README.md)

Use Node 24.22.3 or newer in the 24.x line (`.nvmrc` pins 24.22.3), or Node 26.13.1 or later, and npm 12 (`package.json` selects npm 12.2.0).

```sh
npm ci --ignore-scripts  # install development dependencies; Pi supplies runtime peers
npm run check:compat     # every gate, run independently and aggregated
npm run check            # type-check with TypeScript 7
npm run lint             # oxlint with the adopted strict baseline
npm run format:check     # oxfmt formatting check
npm run check:policy     # adopted quality-policy verification
npm test                 # breakdown, native session fixtures, and overlay allocation tests
```

The Pi development cohort is pinned to official `1.5.0`: the eight-package Pi cohort, with host TypeBox `1.3.27`. No build or `prepare` step is needed.

## Quality policy

The repository follows the [Strict Oxlint and Oxfmt Engineering Standard](quality/standard.md) (v5.1.2), adopted with the recorded decisions in [quality/records.md](quality/records.md). `check:policy` verifies the adopted baseline on every run: configuration integrity against the standard, compiler and lint coverage of maintained source, the recorded exceptions against the source, and enforcement controls (node:test registration boundary, floating promises, type safety, structural limits, test profile) through temporary diagnostic fixtures. Relaxations require a quality-exception record; the machine-readable manifest is [quality/exceptions.json](quality/exceptions.json).

## Lockfile

`check:lock` rejects the known `workos` and `socket-firewall` private-registry references. The repository uses `https://registry.npmjs.org/`. If you install through a registry mirror, point every `resolved` URL back at that public registry before committing.

## Select a host for native tests

Set `PI_HOST_INDEX` to the selected installed host's absolute `dist/index.js` path to run native snapshot and overlay tests against that host.

Typechecking resolves the checkout's `node_modules`, so host qualification must select that dependency graph too, rather than only setting the hook. Both targets use official usage and compaction APIs.

Former fork-only usage-source labels and native checkpoint tests were retired with those unsupported APIs. Ordinary compaction, retained messages, and context edits remain tested.

## CI compatibility

CI qualifies official Pi and the current fork `main` on Node 24.22.3 (the minimum) and the latest Node 24. The shared `fitchmultz/.github` qualifier checks package contracts, a fresh Git install, and the real bundled Pi CLI. See [the workflow](../.github/workflows/pi-compatibility.yml).
