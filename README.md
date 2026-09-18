# pi-ctx-info

Pi extension that adds a `/ctx` command: a visual breakdown of what is occupying your current pi session context.

## Usage

Type `/ctx` in the pi TUI. An overlay opens with:

- reported context usage from the last LLM request (`ctx.getContextUsage()`)
- an estimated composition bar (pi's chars/4 heuristic) split by category:
  system prompt (context files, skills), tool definitions, user messages,
  assistant text, thinking, tool calls, tool results, extension messages,
  compaction/branch summaries, native context-window handoffs (when supported), bash executions
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
npm test      # breakdown, native session fixtures, and overlay allocation tests
```

Set `PI_HOST_INDEX` to a host's absolute `dist/index.js` path to run the native
session and overlay tests against that host. Context-window fixtures are skipped
on hosts without native context windows; ordinary compaction is always tested.

Token figures are estimates. The overlay shows pi's reported total separately instead of
forcing the estimates to reconcile.

## 0.1.1

- Respect narrow TUI allocations, including resize, expanded view, and refresh.
- Include native context-window handoff text in the estimated composition without
  counting discarded history or duplicating the prompt/tool checkpoint.
