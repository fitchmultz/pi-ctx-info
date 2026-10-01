# pi-ctx-info

Pi extension that adds a `/ctx` command: a visual breakdown of what is occupying your current pi session context.

## Usage

Type `/ctx` in the pi TUI. An overlay opens with:

- Pi's current context usage (`ctx.getContextUsage()`), labeled `reported + estimated`,
  `unknown` after a boundary without fresh usage, or `unavailable` without a model
- an estimated composition bar (pi's chars/4 heuristic) split by category:
  system prompt (context files, skills), tool definitions, user messages,
  assistant text, thinking, tool calls, tool results, extension messages,
  compaction/branch summaries, bash executions
- the five largest individual entries in the session

Keys: `e` expand/collapse (lists every context file, skill, and active tool, plus the
top-10 largest entries), `up`/`down`/`home`/`end` scroll the expanded view,
`esc`/`q`/`enter` close, `r` recompute.

## Install

Requires Node.js 24.15 or later and official Pi 1.0.0 or later, or the
`fitchmultz/pi` fork. Current hosts use public compaction and retained-message
accounting, including summary-free rollovers.

```sh
pi install git:github.com/fitchmultz/pi-ctx-info
```

Or try it without installing:

```sh
pi -e git:github.com/fitchmultz/pi-ctx-info
```

## Development

```sh
npm ci --ignore-scripts  # dev deps only; Pi supplies runtime peers
npm run check:compat     # lockfile check + type-check + all behavior tests
npm run check            # type-check (TypeScript 7)
npm test                 # breakdown, native session fixtures, and overlay allocation tests
```

Development uses Node 24 (`.nvmrc`) and npm 12. The Pi development cohort is pinned to official `1.0.0` (the eight-package Pi cohort, with host TypeBox `1.3.27`). No build or `prepare` is needed.

`check:lock` rejects a lockfile containing private-registry URLs. If you install through a
registry mirror, point every `resolved` URL back at `https://registry.npmjs.org/` before committing.

Set `PI_HOST_INDEX` to the selected installed host's absolute `dist/index.js` path to run native snapshot and overlay tests against that host. Typechecking resolves the checkout's `node_modules`, so host qualification must select that graph too, not only set the hook. Both 1.0 targets use official usage/compaction APIs. Former fork-only usage-source labels and native checkpoint tests are retired with those unsupported APIs; ordinary compaction, retained messages and context edits remain tested.

CI qualifies official Pi and the current fork `main` on Node 24.15 (the minimum) and the latest Node 24 with the shared `fitchmultz/.github` qualifier: package contracts, a fresh Git install, and the real bundled Pi CLI.

## Accounting basis

The composition uses Pi's current model-context projection and active tool definitions.
It applies context edits, includes compaction and branch summaries, and excludes
discarded conversation. System checkpoints are counted through the single system-prompt
row, so they do not duplicate prompt or tool totals.

The system/tool rows use Pi's canonical prompt and tool-delta replay at the last native `context_with_system` event, including
per-run instructions from extensions such as Posthorse and ATB. That prompt is kept
only in memory. The overlay identifies this basis and falls back to Pi's current
prompt after a session, branch, model, tool, base-prompt, or context-boundary
change. After reload or resume, idle Pi may expose only its base prompt until
another request is prepared; the overlay makes that limitation explicit. Refresh
recomputes current entries/tools.

Expanded context-file rows describe discovered files. Guidance injected by extensions
is included in the observed prompt total but is not attributed to discovered files.
Later full-context transformations and provider-payload rewrites are outside this estimate. Request capture does not query session projections; accounting and append-boundary validation run only when opening or refreshing the overlay.
Token figures use the chars/4 heuristic. Pi's native usage stays separate; the extension
does not force the two figures to reconcile. Free space is also labeled as estimated.

## 0.3.0

- Require Pi 1.0.0 and qualify its exact native SDK/CLI cohort.
- Capture the canonical prepared system sections and tool declarations, without rebuilding session context on every request.
- Keep full current-entry accounting and fresh model limits at explicit overlay refresh. Validate appends for retain-none boundary drafts before reusing a prepared prompt.
- Preserve approximate/unknown labels, keyboard controls, options, and narrow/fullscreen/regular rendering. Retire dropped fork-only usage-source and checkpoint assumptions.

## 0.2.0

- Require Node.js 24.15 or later and official Pi 0.87.0 or later.
- Use Pi's own per-message token estimate, so message totals and the largest-entries list
  match Pi's accounting (including images).
- Develop with TypeScript 7 and npm 12.

## 0.1.1

- Respect narrow TUI allocations, including resize, expanded view, and refresh.
- Include native context-window framing and handoffs without counting discarded
  history or duplicating the prompt/tool checkpoint.
- Retain observed per-run guidance in the system estimate after a request settles.
- Identify the prompt basis and distinguish native usage from estimated composition
  and free space.
