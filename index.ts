import { sessionEntryToContextMessages, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { type Breakdown, buildBreakdown, formatTokens } from "./breakdown.ts";

type Theme = ExtensionUIContext["theme"];
type FgColor = Parameters<Theme["fg"]>[0];

interface UsageInfo {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

interface Snapshot {
	breakdown: Breakdown;
	usage: UsageInfo | undefined;
	modelId: string;
	contextWindow: number | undefined;
	promptSource: "prepared" | "current";
}

interface PreparedPrompt {
	key: string;
	text: string;
}

const PALETTE: FgColor[] = ["accent", "warning", "success", "error", "toolTitle", "customMessageLabel", "muted", "dim", "toolOutput", "searchMatchText"];

function activeTools(pi: ExtensionAPI) {
	const active = new Set(pi.getActiveTools());
	return pi.getAllTools()
		.filter((tool) => active.has("id" in tool && typeof tool.id === "string" ? tool.id : tool.name))
		.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

function promptKey(ctx: ExtensionContext, tools: ReturnType<typeof activeTools>): string {
	return JSON.stringify([
		ctx.sessionManager.getSessionId(), ctx.model?.provider, ctx.model?.id,
		ctx.sessionManager.buildContextEntries()[0]?.id, tools,
	]);
}

function takeSnapshot(ctx: ExtensionCommandContext, pi: ExtensionAPI, prepared?: PreparedPrompt): Snapshot {
	const options = ctx.getSystemPromptOptions();
	const tools = activeTools(pi);
	const usePrepared = prepared?.key === promptKey(ctx, tools);
	const breakdown = buildBreakdown({
		systemPrompt: usePrepared ? prepared.text : ctx.getSystemPrompt(),
		contextFiles: options.contextFiles ?? [],
		skills: (options.skills ?? []).map((skill) => ({ name: skill.name, description: skill.description })),
		tools,
		// Let the host project summaries and fresh-window handoffs exactly as it does for context.
		// System checkpoints remain separate from the single prompt/tool accounting above.
		messages: ctx.sessionManager.buildContextEntries().flatMap(sessionEntryToContextMessages),
	});

	const usage = ctx.getContextUsage();
	return {
		breakdown,
		usage,
		modelId: ctx.model?.id ?? "unknown model",
		contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow,
		promptSource: usePrepared ? "prepared" : "current",
	};
}

class CtxOverlay {
	private snapshot: Snapshot;
	private expanded = false;
	private scrollOffset = 0;
	private cachedWidth: number | undefined;
	private cachedExpanded: boolean | undefined;
	private cachedHeader: string[] = [];
	private cachedBody: string[] = [];

	constructor(
		snapshot: Snapshot,
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly onClose: () => void,
		private readonly onRefresh: () => Snapshot,
	) {
		this.snapshot = snapshot;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || data === "q" || matchesKey(data, "enter")) {
			this.onClose();
			return;
		}
		if (data === "r") {
			this.snapshot = this.onRefresh();
			this.invalidate();
		} else if (data === "e") {
			this.expanded = !this.expanded;
			this.scrollOffset = 0;
			this.invalidate();
		} else if (matchesKey(data, Key.up)) {
			this.scrollOffset -= 1;
		} else if (matchesKey(data, Key.down)) {
			this.scrollOffset += 1;
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

		const hint = hintRows ? [this.buildHint(w, maxOffset)] : [];
		return [...header, ...body.slice(this.scrollOffset, this.scrollOffset + visible), ...hint];
	}

	private pad(line: string, width: number): string {
		const truncated = truncateToWidth(` ${line}`, width);
		const padding = " ".repeat(Math.max(width - visibleWidth(truncated), 0));
		// Full-width background fill so transcript text doesn't bleed through.
		return this.theme.bg("customMessageBg", truncated + padding);
	}

	private buildLines(width: number): { header: string[]; body: string[] } {
		const fg = (color: FgColor, text: string) => this.theme.fg(color, text);
		const bold = (text: string) => this.theme.bold(text);
		const { breakdown, usage, modelId, contextWindow, promptSource } = this.snapshot;
		const inner = Math.max(width - 2, 0);
		const padLine = (line: string) => this.pad(line, width);
		const labelAndCount = (label: string, tokens: number, labelWidth: number) => {
			const count = formatTokens(tokens).padStart(8);
			return width < 50 ? `${count}  ${label}` : label.padEnd(labelWidth) + count;
		};

		const header: string[] = [];
		header.push(padLine(fg("accent", bold("ctx — what's occupying this session's context"))));
		header.push(padLine(fg("dim", "─".repeat(inner))));
		header.push(padLine(fg("muted", modelId) + (contextWindow ? fg("dim", ` · window ${formatTokens(contextWindow)}`) : "")));
		if (usage) {
			const nativeUsage = usage.tokens === null
				? "unknown"
				: `${formatTokens(usage.tokens)} (${usage.percent?.toFixed(1)}% of window)`;
			header.push(padLine(fg("muted", "Pi context usage: ") + nativeUsage + fg("dim", " · reported + estimated")));
		} else {
			header.push(padLine(fg("dim", "Pi context usage: unavailable")));
		}
		header.push(padLine(fg("dim", promptSource === "prepared"
			? "current entries/tools; last prepared request prompt"
			: "current entries/tools; current Pi prompt (per-run guidance may be unavailable)")));
		const estimatedPct = contextWindow ? ` (${((breakdown.estimatedTotal / contextWindow) * 100).toFixed(1)}% of window)` : "";
		header.push(padLine(fg("muted", "estimated composition: ") + `${formatTokens(breakdown.estimatedTotal)}${estimatedPct}` + fg("dim", " · chars/4 heuristic")));
		header.push(padLine(""));
		if (breakdown.estimatedTotal > 0) {
			header.push(padLine(this.buildBar(Math.max(Math.min(inner, 60), 20))));
		}
		header.push(padLine(""));

		const body: string[] = [];
		breakdown.categories.forEach((category, i) => {
			const color = PALETTE[i % PALETTE.length] ?? "muted";
			const basis = contextWindow ?? breakdown.estimatedTotal;
			const pct = basis > 0 ? ((category.tokens / basis) * 100).toFixed(1) : "0.0";
			body.push(padLine(fg(color, "■ ") + labelAndCount(category.label, category.tokens, 30) + fg("dim", `  ${pct}%`)));
			const rows = this.expanded ? category.expandedSubs : category.subs;
			for (const sub of rows) {
				body.push(padLine(fg("dim", `    ${labelAndCount(sub.label, sub.tokens, 26)}`)));
			}
		});
		if (contextWindow && contextWindow > breakdown.estimatedTotal) {
			const free = contextWindow - breakdown.estimatedTotal;
			const pct = ((free / contextWindow) * 100).toFixed(1);
			body.push(padLine(fg("dim", "□ ") + labelAndCount("estimated free", free, 30) + fg("dim", `  ${pct}%`)));
		}

		const largest = this.expanded ? breakdown.largest : breakdown.largest.slice(0, 5);
		if (largest.length > 0) {
			body.push(padLine(""));
			body.push(padLine(fg("muted", bold("largest entries"))));
			largest.forEach((entry, i) => {
				body.push(padLine(fg("dim", `${i + 1}. `) + labelAndCount(entry.label, entry.tokens, 34)));
			});
		}

		return { header, body };
	}

	private buildHint(width: number, maxOffset: number): string {
		const fg = (color: FgColor, text: string) => this.theme.fg(color, text);
		const parts = [this.expanded ? "e collapse" : "e expand"];
		if (maxOffset > 0) parts.push(`↑↓ scroll (${this.scrollOffset}/${maxOffset})`);
		parts.push("esc/q close", "r refresh");
		return this.pad(fg("dim", parts.join(" · ")), width);
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
			if (cell.tokens > 0 && cell.width === 0) cell.width = 1;
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
		if (used < barWidth) parts.push(this.theme.fg("dim", "░".repeat(barWidth - used)));
		return parts.join("");
	}
}

export default function (pi: ExtensionAPI) {
	let prepared: PreparedPrompt | undefined;
	// Run-only prompt additions disappear from getSystemPrompt() after settlement.
	// Keep only the observed prompt in memory; never write sensitive guidance to the session.
	pi.on("context", (_event, ctx) => {
		prepared = { key: promptKey(ctx, activeTools(pi)), text: ctx.getSystemPrompt() };
	});
	const clearPrompt = () => { prepared = undefined; };
	pi.on("session_start", clearPrompt);
	pi.on("session_tree", clearPrompt);
	pi.on("session_compact", clearPrompt);
	pi.on("model_select", clearPrompt);

	pi.registerCommand("ctx", {
		description: "Visual breakdown of what occupies the session context",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/ctx requires the interactive TUI", "warning");
				return;
			}
			await ctx.ui.custom<null>(
				(tui, theme, _keybindings, done) =>
					new CtxOverlay(
						takeSnapshot(ctx, pi, prepared),
						tui,
						theme,
						() => done(null),
						() => {
							const next = takeSnapshot(ctx, pi, prepared);
							tui.requestRender();
							return next;
						},
					),
				{ overlay: true, overlayOptions: { width: "85%", maxHeight: "85%", anchor: "center" } },
			);
		},
	});
}
