# Accounting reference and version history

[Back to the README](../README.md)

## Accounting basis

The composition uses Pi's current model-context projection and active tool definitions. It applies context edits, includes compaction and branch summaries, and excludes discarded conversation. System checkpoints are counted through the single system-prompt row, so they do not duplicate prompt or tool totals.

The system and tool rows use Pi's canonical prompt and tool-delta replay at the last native `context_with_system` event, including per-run instructions from extensions such as Posthorse and ATB. That prompt is kept only in memory.

The overlay identifies this basis and falls back to Pi's current prompt after a session, branch, model, tool, base-prompt, or context-boundary change. After reload or resume, idle Pi may expose only its base prompt until another request is prepared; the overlay makes that limitation explicit. Refresh recomputes current entries and tools.

Expanded context-file rows describe discovered files. Guidance injected by extensions is included in the observed prompt total but is not attributed to discovered files. Later full-context transformations and provider-payload rewrites are outside this estimate.

Request capture does not query session projections; accounting and append-boundary validation run only when opening or refreshing the overlay.

Token figures use the characters-divided-by-four heuristic. Whole-message totals and largest entries use Pi's `estimateTokens`, including images; assistant category splits estimate text, thinking, and tool-call blocks separately. Pi's native usage stays separate; the extension does not force the two figures to reconcile. Free space is also labeled as estimated.

Current hosts use public compaction and retained-message accounting, including summary-free rollovers.

## Version history

These notes describe past releases. Current installation requirements are in the [README](../README.md#quick-start).

### 0.3.0

- Require Pi 1.0.0 and qualify its exact native SDK/CLI cohort.
- Capture the canonical prepared system sections and tool declarations, without rebuilding session context on every request.
- Keep full current-entry accounting and fresh model limits at explicit overlay refresh. Validate appends for retain-none boundary drafts before reusing a prepared prompt.
- Preserve approximate/unknown labels, keyboard controls, options, and narrow/fullscreen/regular rendering. Retire dropped fork-only usage-source and checkpoint assumptions.

### 0.2.0

- Require Node.js 24.15 or later and official Pi 0.87.0 or later.
- Use Pi's own per-message token estimate, so message totals and the largest-entries list match Pi's accounting (including images).
- Develop with TypeScript 7 and npm 12.

### 0.1.1

- Respect narrow TUI allocations, including resize, expanded view, and refresh.
- Include native context-window framing and handoffs without counting discarded history or duplicating the prompt/tool checkpoint.
- Retain observed per-run guidance in the system estimate after a request settles.
- Identify the prompt basis and distinguish native usage from estimated composition and free space.
