import type {
	ExtensionContext,
	ExtensionUIContext,
	KeybindingsManager,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	type Component,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { type Breakdown, formatTokens } from "./breakdown.ts";

type Theme = ExtensionUIContext["theme"];
type FgColor = Parameters<Theme["fg"]>[0];

/** The overlay reads only these surfaces from Pi's TUI, theme, and keybinding objects. */
export type OverlayTui = Pick<TUI, "requestRender"> & { terminal: Pick<TUI["terminal"], "rows"> };
export type OverlayTheme = Pick<Theme, "fg" | "bg" | "bold">;
export type OverlayKeybindings = Pick<KeybindingsManager, "matches" | "getKeys">;

/** Factory shape the overlay registers with `ui.custom`, narrowed to the surfaces it consumes. */
export type OverlayCustomFactory = (
	tui: OverlayTui,
	theme: OverlayTheme,
	keybindings: OverlayKeybindings,
	done: (result: null) => void,
) => Component & { dispose?: () => void };

export interface Snapshot {
	breakdown: Breakdown;
	usage: ReturnType<ExtensionContext["getContextUsage"]>;
	modelId: string;
	contextWindow: number | undefined;
	promptSource: "prepared" | "current";
}

export interface CtxOverlayOptions {
	snapshot: Snapshot;
	tui: OverlayTui;
	theme: OverlayTheme;
	keybindings: OverlayKeybindings;
	onClose: () => void;
	onRefresh: () => Snapshot;
}

const PALETTE: FgColor[] = [
	"accent",
	"warning",
	"success",
	"error",
	"toolTitle",
	"customMessageLabel",
	"muted",
	"dim",
	"toolOutput",
	"searchMatchText",
];

interface CountedRowSpec {
	prefix: string;
	label: string;
	tokens: number;
	labelWidth: number;
	suffix?: string;
}

/** One aligned `label ... count` row, falling back to count-first when too wide for `width`. */
function countedRow(spec: CountedRowSpec, width: number): string {
	const count = formatTokens(spec.tokens).padStart(8);
	const labelPad = " ".repeat(Math.max(spec.labelWidth - visibleWidth(spec.label), 0));
	const wide = spec.prefix + spec.label + labelPad + count + (spec.suffix ?? "");
	return visibleWidth(wide) < width
		? wide
		: spec.prefix + count + "  " + spec.label + (spec.suffix ?? "");
}

function primaryKey(keys: readonly string[]): string | undefined {
	if (keys.length === 0) {
		return undefined;
	}
	return keys.reduce((shortest, key) =>
		visibleWidth(key) < visibleWidth(shortest) ? key : shortest,
	);
}

export class CtxOverlay {
	private snapshot: Snapshot;
	private expanded = false;
	private scrollOffset = 0;
	private cachedWidth: number | undefined;
	private cachedExpanded: boolean | undefined;
	private cachedHeader: string[] = [];
	private cachedBody: string[] = [];
	private readonly tui: OverlayTui;
	private readonly theme: OverlayTheme;
	private readonly keybindings: OverlayKeybindings;
	private readonly onClose: () => void;
	private readonly onRefresh: () => Snapshot;

	constructor(options: CtxOverlayOptions) {
		this.snapshot = options.snapshot;
		this.tui = options.tui;
		this.theme = options.theme;
		this.keybindings = options.keybindings;
		this.onClose = options.onClose;
		this.onRefresh = options.onRefresh;
	}

	private fg(color: FgColor, text: string): string {
		return this.theme.fg(color, text);
	}

	private bold(text: string): string {
		return this.theme.bold(text);
	}

	handleInput(data: string): void {
		if (
			this.keybindings.matches(data, "tui.select.cancel") ||
			this.keybindings.matches(data, "tui.select.confirm") ||
			matchesKey(data, "q")
		) {
			this.onClose();
			return;
		}
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.scrollOffset -= 1;
		} else if (this.keybindings.matches(data, "tui.select.down")) {
			this.scrollOffset += 1;
		} else if (matchesKey(data, "r")) {
			this.snapshot = this.onRefresh();
			this.invalidate();
		} else if (matchesKey(data, "e")) {
			this.expanded = !this.expanded;
			this.scrollOffset = 0;
			this.invalidate();
		} else if (matchesKey(data, Key.home)) {
			this.scrollOffset = 0;
		} else if (matchesKey(data, Key.end)) {
			this.scrollOffset = Number.MAX_SAFE_INTEGER;
		} else {
			return;
		}
		this.tui.requestRender();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
	}

	render(width: number): string[] {
		const w = Math.max(width, 0);
		if (this.cachedWidth !== w || this.cachedExpanded !== this.expanded) {
			const built = this.buildLines(w);
			this.cachedHeader = built.header;
			this.cachedBody = built.body;
			this.cachedWidth = w;
			this.cachedExpanded = this.expanded;
		}

		// Scroll the header too when pinning it would leave no room for content.
		const overlayRows = Math.max(1, Math.floor(this.tui.terminal.rows * 0.85));
		const header = overlayRows >= this.cachedHeader.length + 2 ? this.cachedHeader : [];
		const body = header.length > 0 ? this.cachedBody : [...this.cachedHeader, ...this.cachedBody];
		const hintRows = overlayRows > 1 ? 1 : 0;
		const visible = overlayRows - header.length - hintRows;
		const maxOffset = Math.max(0, body.length - visible);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));

		const hint = hintRows > 0 ? [this.buildHint(w, maxOffset)] : [];
		return [...header, ...body.slice(this.scrollOffset, this.scrollOffset + visible), ...hint];
	}

	private pad(line: string, width: number): string {
		// Full-width background fill so transcript text doesn't bleed through.
		return this.theme.bg("customMessageBg", truncateToWidth(` ${line}`, width, "...", true));
	}

	private buildLines(width: number): { header: string[]; body: string[] } {
		return { header: this.buildHeader(width), body: this.buildBody(width) };
	}

	private buildHeader(width: number): string[] {
		const { breakdown, usage, modelId, contextWindow, promptSource } = this.snapshot;
		const inner = Math.max(width - 2, 0);
		const padLine = (line: string) => this.pad(line, width);

		const header: string[] = [];
		header.push(
			padLine(this.fg("accent", this.bold("ctx — what's occupying this session's context"))),
		);
		header.push(padLine(this.fg("dim", "─".repeat(inner))));
		header.push(
			padLine(
				this.fg("muted", modelId) +
					(contextWindow !== undefined && contextWindow > 0
						? this.fg("dim", ` · window ${formatTokens(contextWindow)}`)
						: ""),
			),
		);
		if (usage === undefined) {
			header.push(padLine(this.fg("dim", "Pi context usage: unavailable")));
		} else if (usage.tokens === null || usage.percent === null) {
			// percent is null only when tokens is; both are handled as one unknown state.
			header.push(padLine(this.fg("muted", "Pi context usage: ") + "unknown"));
		} else {
			const nativeUsage = `${formatTokens(usage.tokens)} (${usage.percent.toFixed(1)}% of window)`;
			header.push(
				padLine(
					this.fg("muted", "Pi context usage: ") +
						nativeUsage +
						this.fg("dim", " · reported + estimated"),
				),
			);
		}
		header.push(
			padLine(
				this.fg(
					"dim",
					promptSource === "prepared"
						? "current entries/tools; last prepared request prompt"
						: "current entries/tools; current Pi prompt (per-run guidance may be unavailable)",
				),
			),
		);
		const estimatedPct =
			contextWindow !== undefined && contextWindow > 0
				? ` (${((breakdown.estimatedTotal / contextWindow) * 100).toFixed(1)}% of window)`
				: "";
		header.push(
			padLine(
				this.fg("muted", "estimated composition: ") +
					`${formatTokens(breakdown.estimatedTotal)}${estimatedPct}` +
					this.fg("dim", " · chars/4 heuristic"),
			),
		);
		header.push(padLine(""));
		if (breakdown.estimatedTotal > 0) {
			header.push(padLine(this.buildBar(Math.max(Math.min(inner, 60), 20))));
		}
		header.push(padLine(""));
		return header;
	}

	private buildBody(width: number): string[] {
		const { breakdown, contextWindow } = this.snapshot;
		const padLine = (line: string) => this.pad(line, width);
		const body: string[] = [];

		breakdown.categories.forEach((category, i) => {
			const color = PALETTE[i % PALETTE.length] ?? "muted";
			const basis = contextWindow ?? breakdown.estimatedTotal;
			const pct = basis > 0 ? ((category.tokens / basis) * 100).toFixed(1) : "0.0";
			body.push(
				padLine(
					countedRow(
						{
							prefix: this.fg(color, "■ "),
							label: category.label,
							tokens: category.tokens,
							labelWidth: 30,
							suffix: this.fg("dim", `  ${pct}%`),
						},
						width,
					),
				),
			);
			const rows = this.expanded ? category.expandedSubs : category.subs;
			for (const sub of rows) {
				body.push(
					padLine(
						this.fg(
							"dim",
							countedRow(
								{ prefix: "    ", label: sub.label, tokens: sub.tokens, labelWidth: 26 },
								width,
							),
						),
					),
				);
			}
		});
		if (contextWindow !== undefined && contextWindow > breakdown.estimatedTotal) {
			const free = contextWindow - breakdown.estimatedTotal;
			const pct = ((free / contextWindow) * 100).toFixed(1);
			body.push(
				padLine(
					countedRow(
						{
							prefix: this.fg("dim", "□ "),
							label: "estimated free",
							tokens: free,
							labelWidth: 30,
							suffix: this.fg("dim", `  ${pct}%`),
						},
						width,
					),
				),
			);
		}

		const largest = this.expanded ? breakdown.largest : breakdown.largest.slice(0, 5);
		if (largest.length > 0) {
			body.push(padLine(""));
			body.push(padLine(this.fg("muted", this.bold("largest entries"))));
			largest.forEach((entry, i) => {
				body.push(
					padLine(
						countedRow(
							{
								prefix: this.fg("dim", `${i + 1}. `),
								label: entry.label,
								tokens: entry.tokens,
								labelWidth: 34,
							},
							width,
						),
					),
				);
			});
		}
		return body;
	}

	private buildHint(width: number, maxOffset: number): string {
		const parts = [this.expanded ? "e collapse" : "e expand"];
		if (maxOffset > 0) {
			const scrollKeys = [
				primaryKey(this.keybindings.getKeys("tui.select.up")),
				primaryKey(this.keybindings.getKeys("tui.select.down")),
			]
				.filter((key): key is string => key !== undefined)
				.join("/");
			const scrollLabel = scrollKeys.length > 0 ? `${scrollKeys} scroll` : "home/end scroll";
			parts.push(`${scrollLabel} (${this.scrollOffset}/${maxOffset})`);
		}
		const cancelKey =
			primaryKey(this.keybindings.getKeys("tui.select.cancel")) ??
			primaryKey(this.keybindings.getKeys("tui.select.confirm"));
		const closeKeys = cancelKey === undefined ? ["q"] : [...new Set([cancelKey, "q"])];
		parts.push(`${closeKeys.join("/")} close`, "r refresh");
		return this.pad(this.fg("dim", parts.join(" · ")), width);
	}

	private buildBar(barWidth: number): string {
		const { breakdown, contextWindow } = this.snapshot;
		// The bar spans the full context window; free space trails as dim cells.
		const basis = Math.max(contextWindow ?? breakdown.estimatedTotal, breakdown.estimatedTotal);
		const cells = breakdown.categories.map((category, i) => ({
			color: PALETTE[i % PALETTE.length] ?? "muted",
			width: Math.round((category.tokens / basis) * barWidth),
			tokens: category.tokens,
		}));
		// Every non-zero category gets at least one cell.
		for (const cell of cells) {
			if (cell.tokens > 0 && cell.width === 0) {
				cell.width = 1;
			}
		}
		// Never exceed the bar; the free tail soaks up unused cells.
		let sum = cells.reduce((a, b) => a + b.width, 0);
		while (sum > barWidth) {
			const widest = cells.reduce((a, b) => (b.width > a.width ? b : a));
			widest.width -= 1;
			sum -= 1;
		}
		const parts = cells
			.filter((cell) => cell.width > 0)
			.map((cell) => this.theme.fg(cell.color, "█".repeat(cell.width)));
		const used = cells.reduce((a, b) => a + b.width, 0);
		if (used < barWidth) {
			parts.push(this.theme.fg("dim", "░".repeat(barWidth - used)));
		}
		return parts.join("");
	}
}
