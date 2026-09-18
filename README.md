# pi-ctx-info

Pi extension that adds a `/ctx` command: a visual breakdown of what is occupying your current pi session context.

## Usage

Type `/ctx` in the pi TUI. An overlay opens with:

- Pi's current context usage (`ctx.getContextUsage()`), which combines applicable
  reported usage with native estimates
- an estimated composition bar (pi's chars/4 heuristic) split by category:
  system prompt (context files, skills), tool definitions, user messages,
  assistant text, thinking, tool calls, tool results, extension messages,
  compaction/branch summaries, fresh-context handoffs, bash executions
- the five largest individual entries in the session

Keys: `e` expand/collapse (lists every context file, skill, and active tool, plus the
top-10 largest entries), `up`/`down`/`home`/`end` scroll the expanded view,
`esc`/`q`/`enter` close, `r` recompute.

## Install

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
npm run check # type-check
npm test      # unit tests for the breakdown logic
```

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
