# Development

[Back to the README](../README.md)

Use Node 24 (`.nvmrc`) and npm 12 (`package.json` selects npm 12.2.0).

```sh
npm ci --ignore-scripts  # install development dependencies; Pi supplies runtime peers
npm run check:compat     # lockfile check, type-check, and all behavior tests
npm run check            # type-check with TypeScript 7
npm test                 # breakdown, native session fixtures, and overlay allocation tests
```

The Pi development cohort is pinned to official `1.0.0`: the eight-package Pi cohort, with host TypeBox `1.3.27`. No build or `prepare` step is needed.

## Lockfile

`check:lock` rejects the known `workos` and `socket-firewall` private-registry references. The repository uses `https://registry.npmjs.org/`. If you install through a registry mirror, point every `resolved` URL back at that public registry before committing.

## Select a host for native tests

Set `PI_HOST_INDEX` to the selected installed host's absolute `dist/index.js` path to run native snapshot and overlay tests against that host.

Typechecking resolves the checkout's `node_modules`, so host qualification must select that dependency graph too, rather than only setting the hook. Both 1.0 targets use official usage and compaction APIs.

Former fork-only usage-source labels and native checkpoint tests were retired with those unsupported APIs. Ordinary compaction, retained messages, and context edits remain tested.

## CI compatibility

CI qualifies official Pi and the current fork `main` on Node 24.15 (the minimum) and the latest Node 24. The shared `fitchmultz/.github` qualifier checks package contracts, a fresh Git install, and the real bundled Pi CLI. See [the workflow](../.github/workflows/pi-compatibility.yml).
