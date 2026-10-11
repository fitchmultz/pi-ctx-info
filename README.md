# pi-ctx-info

`pi-ctx-info` adds `/ctx` to [Pi](https://pi.dev). The command shows which messages, tool results, and instructions use your context window.

![The /ctx overlay reads prompt, tool, message, and usage data from Pi. It shows category estimates and the largest entries.](.github/readme/context-overview.png)

*The overlay keeps Pi usage separate from context estimates.*

## Quick start

Use Node.js 24.15+ and official Pi 1.0.0+ or the current [fitchmultz/pi](https://github.com/fitchmultz/pi) fork.

Install the extension:

```sh
pi install git:github.com/fitchmultz/pi-ctx-info
```

Start Pi:

```sh
pi
```

Enter `/ctx` in the Pi interactive terminal.

To use the extension for one session without installation, run:

```sh
pi -e git:github.com/fitchmultz/pi-ctx-info
```

[Controls](#controls) · [Estimates and limits](#estimates-and-limits)

## Controls

The overlay shows a category bar and the five largest message entries.

The expanded overlay lists discovered context files, skills, and active tools. It shows up to ten largest entries.

| Key | Action |
| --- | --- |
| `e` | Expand or collapse details |
| `↑` / `↓` | Scroll |
| `Home` / `End` | Jump to the start or end |
| `r` | Refresh the overlay |
| `Esc` / `q` / `Enter` | Close the overlay |

Print and RPC modes cannot show the overlay.

## Estimates and limits

Context estimates use Pi's characters-divided-by-four heuristic. They can differ from Pi usage. Free space is also an estimate.

Pi labels its usage `reported + estimated`. Usage can stay `unknown` after a context boundary until Pi has fresh usage. Usage is `unavailable` without a model.

After reload or resume, prompt estimates can omit per-run extension guidance. Check the prompt note in the overlay.

Estimates use the current context and exclude discarded conversation. Later extension transformations and provider-payload rewrites remain outside these estimates.

See the [accounting reference](docs/reference.md#accounting-basis) for details.

## More information

[Development and tests](docs/development.md) · [Reference and version history](docs/reference.md) · [Report an issue](https://github.com/fitchmultz/pi-ctx-info/issues)

## License

[MIT](LICENSE) · Copyright © 2026 Mitch Fultz.
