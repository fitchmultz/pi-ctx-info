# pi-ctx-info

Pi extension that adds a `/ctx` command: a visual breakdown of what is occupying your current pi session context.

## Usage

Type `/ctx` in the pi TUI. An overlay opens with:

- Pi's current context usage (`ctx.getContextUsage()`), which combines applicable
  reported usage with native estimates
- an estimated composition bar (pi's chars/4 heuristic) split by category:
  system prompt (context files, skills), tool definitions, user messages,
  assistant text, thinking, tool calls, tool results, extension messages,
  compaction/branch summaries, native context-window handoffs (when supported), bash executions
- the five largest individual entries in the session

Keys: `e` expand/collapse (lists every context file, skill, and active tool, plus the
top-10 largest entries), `up`/`down`/`home`/`end` scroll the expanded view,
`esc`/`q`/`enter` close, `r` recompute.

## Install

Requires Pi 0.84.2 or later. Native fresh-context handoffs are shown on hosts that
support them; ordinary context and compaction accounting also work on official Pi.

```sh
pi install git:github.com/fitchmultz/pi-ctx-info
```

Or try it without installing:

```sh
pi -e git:github.com/fitchmultz/pi-ctx-info
```

## Development

```sh
npm install   # dev deps only (types + typescript); runtime deps come from pi itself
npm run check:compat # type-check + all behavior tests
npm run check # type-check
npm test      # breakdown, native session fixtures, and overlay allocation tests
```

The development Pi cohort is pinned to official `0.86.1`; the declared `0.84.2` floor is separate from this current qualification baseline. Pi supplies runtime peers; no build or `prepare` is needed.

Set `PI_HOST_INDEX` to the selected installed host's absolute `dist/index.js` path to run the native session, snapshot, overlay, and checkpoint tests against that host. Typechecking resolves the checkout's `node_modules`, so host qualification must select that graph too, not only set the hook. Checkpoint tests use an isolated HOME without model calls and skip hosts without checkpoint support. `PI_COMPAT_HOST=fork` requires both checkpoint and fresh-context APIs; `PI_REQUIRE_CHECKPOINT=1` also remains supported for standalone checkpoint qualification. Ordinary compaction is always tested.

## Accounting basis

The composition uses current native context entries and active tool definitions. Pi's
own entry projection includes fresh-context markers and handoffs while excluding old
conversation. System checkpoints are counted through the single system-prompt row,
so they do not duplicate prompt or tool totals.

The system row uses the prompt observed at the last native `context` event, including
per-run instructions from extensions such as Posthorse and ATB. That prompt is kept
only in memory. The overlay identifies this basis and falls back to Pi's current
prompt after a session, branch, model, tool, or context-boundary change. After reload
or resume, idle Pi may expose only its base prompt until another request is prepared;
the overlay makes that limitation explicit. Refresh recomputes current entries/tools.

Expanded context-file rows describe discovered files. Guidance injected by extensions
is included in the observed prompt total but is not attributed to discovered files.
Later context transformations and provider-payload rewrites are outside this estimate.
Token figures use the chars/4 heuristic. Pi's native usage stays separate; the extension
does not force the two figures to reconcile. Free space is also labeled as estimated.

## 0.1.1

- Respect narrow TUI allocations, including resize, expanded view, and refresh.
- Include native context-window framing and handoffs without counting discarded
  history or duplicating the prompt/tool checkpoint.
- Retain observed per-run guidance in the system estimate after a request settles.
- Identify the prompt basis and distinguish native usage from estimated composition
  and free space.
