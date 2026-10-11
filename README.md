# pi-ctx-info

See what is filling your [Pi](https://pi.dev) session's context window. This extension adds `/ctx`, a visual breakdown that helps you spot large tool results, messages, and instructions before deciding what to trim.

![Pi's current prompt, active tools, context messages, and usage feed the /ctx overlay, which shows category estimates and the largest entries.](.github/readme/context-overview.png)

*Open `/ctx` to see Pi's usage alongside an estimated breakdown; press `e` to explore the details.*

## Quick start

Requires **Node.js 24.15+** and **official Pi 1.0.0+** or the current [fitchmultz/pi](https://github.com/fitchmultz/pi) fork.

```sh
pi install git:github.com/fitchmultz/pi-ctx-info
pi
```

Type `/ctx` in Pi's interactive terminal UI. To try it for one session without installing:

```sh
pi -e git:github.com/fitchmultz/pi-ctx-info
```

Next: [explore the overlay](#explore-the-overlay) or [understand the numbers](#understand-the-numbers).

## Explore the overlay

The overlay shows Pi's context usage, an estimated composition bar, and the five largest message entries. Categories cover the system prompt, active tool definitions, user messages, assistant text, thinking, tool calls and results, extension messages, compaction and branch summaries, and bash executions.

For example, if **Tool results** takes a large share, check **largest entries** to see which tool result is contributing most. Press `e` to list every discovered context file, skill, and active tool, plus up to ten largest entries.

| Key | Action |
| --- | --- |
| `e` | Expand or collapse details |
| `↑` / `↓` | Scroll |
| `Home` / `End` | Jump to the start or end |
| `r` | Recompute the snapshot |
| `Esc` / `q` / `Enter` | Close the overlay |

The overlay is available in the interactive TUI; print and RPC modes cannot show it.

## Understand the numbers

- **Pi context usage** comes from Pi and is labeled `reported + estimated`. It can be `unknown` after a context boundary until fresh usage is available, or `unavailable` when there is no model.
- **Estimated composition** uses Pi's characters-divided-by-four heuristic. Whole-message estimates use Pi's own estimator, including its image accounting. Category totals and estimated free space can differ from Pi's usage figure.
- **Prompt basis** is shown in the overlay. It uses the last prepared request's prompt when still applicable, including per-run extension guidance. After reload or resume, Pi may expose only its base prompt until another request is prepared.

The breakdown follows Pi's current model context: it includes retained messages and summaries, applies context edits, and leaves out discarded conversation. Later extension transformations and provider-payload rewrites can change what is sent beyond this estimate.

See the [accounting reference](docs/reference.md#accounting-basis) for the exact boundaries and attribution rules.

## More information

- [Development and compatibility testing](docs/development.md)
- [Accounting reference and version history](docs/reference.md)
- [Report an issue](https://github.com/fitchmultz/pi-ctx-info/issues)

## License

[MIT](LICENSE) · Copyright © 2026 Mitch Fultz.
