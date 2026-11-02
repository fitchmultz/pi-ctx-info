import {
	estimateTokens,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import {
	Key,
	matchesKey,
	type Component,
	type TUI,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { type Breakdown, type BreakdownInput, buildBreakdown, formatTokens } from "./breakdown.ts";

type Theme = ExtensionUIContext["theme"];
type FgColor = Parameters<Theme["fg"]>[0];

/** The overlay reads only these surfaces from Pi's TUI and theme objects. */
export type OverlayTui = Pick<TUI, "requestRender"> & { terminal: Pick<TUI["terminal"], "rows"> };
export type OverlayTheme = Pick<Theme, "fg" | "bg" | "bold">;

/** Factory shape the overlay registers with `ui.custom`, narrowed to the surfaces it consumes. */
export type OverlayCustomFactory = (
	tui: OverlayTui,
	theme: OverlayTheme,
	keybindings: unknown,
	done: (result: null) => void,
) => Component & { dispose?: () => void };

type OverlayShowOptions = Parameters<ExtensionUIContext["custom"]>[1];

/** Model fields the overlay reads; Pi passes its full Model, which is assignable to this. */
export type CtxModel = Pick<
	NonNullable<ExtensionCommandContext["model"]>,
	"id" | "provider" | "contextWindow"
>;

/**
 * The command context the /ctx overlay actually consumes. Pi passes its full
 * ExtensionCommandContext, which is assignable to this narrower contract.
 */
export type CtxCommandContext = Omit<
	Pick<
		ExtensionCommandContext,
		| "mode"
		| "model"
		| "sessionManager"
		| "getSystemPrompt"
		| "getSystemPromptOptions"
		| "getContextUsage"
	>,
	"model"
> & {
	model: CtxModel | undefined;
	ui: Pick<ExtensionUIContext, "notify"> & {
		/** The overlay is always shown with a null result: closing calls done(null). */
		custom: (factory: OverlayCustomFactory, options?: OverlayShowOptions) => Promise<null>;
	};
};

/** Session surfaces the prompt fingerprint and boundary checks read. */
type CtxSessionContext = Omit<
	Pick<ExtensionContext, "sessionManager" | "model" | "getSystemPrompt">,
	"model"
> & {
	model: CtxModel | undefined;
};

interface Snapshot {
	breakdown: Breakdown;
	usage: ReturnType<ExtensionContext["getContextUsage"]>;
	modelId: string;
	contextWindow: number | undefined;
	promptSource: "prepared" | "current";
}

interface PreparedPrompt {
	key: string;
	text: string;
	tools: ReturnType<typeof activeTools>;
	leaf: string | null;
	settledPrompt?: string;
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

function activeTools(pi: ExtensionAPI) {
	const active = new Set(pi.getActiveTools());
	return pi
		.getAllTools()
		.filter((tool) => active.has(tool.name))
		.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		}));
}

function promptKey(ctx: CtxSessionContext, tools: ReturnType<typeof activeTools>): string {
	return JSON.stringify([
		ctx.sessionManager.getSessionId(),
		ctx.model?.provider,
		ctx.model?.id,
		tools,
	]);
}

function sameContextBoundary(
	ctx: Pick<ExtensionContext, "sessionManager">,
	prepared: PreparedPrompt,
): boolean {
	for (let id = ctx.sessionManager.getLeafId(); id !== prepared.leaf;) {
		if (id === null) {
			return false;
		}
		const entry = ctx.sessionManager.getEntry(id);
		if (!entry || entry.type === "compaction") {
			return false;
		}
		id = entry.parentId;
	}
	return true;
}

/** Whether the last prepared request still describes the current session context. */
function matchesPreparedPrompt(
	ctx: CtxSessionContext,
	prepared: PreparedPrompt,
	tools: ReturnType<typeof activeTools>,
): boolean {
	if (prepared.key !== promptKey(ctx, tools)) {
		return false;
	}
	if (prepared.settledPrompt !== undefined && prepared.settledPrompt !== ctx.getSystemPrompt()) {
		return false;
	}
	return sameContextBoundary(ctx, prepared);
}

function breakdownInput(
	ctx: CtxCommandContext,
	pi: ExtensionAPI,
	prepared: PreparedPrompt | undefined,
): { input: BreakdownInput; usePrepared: boolean } {
	const options = ctx.getSystemPromptOptions();
	const tools = activeTools(pi);
	const usePrepared = prepared !== undefined && matchesPreparedPrompt(ctx, prepared, tools);
	const input: BreakdownInput = {
		systemPrompt: usePrepared ? prepared.text : ctx.getSystemPrompt(),
		contextFiles: options.contextFiles ?? [],
		skills: (options.skills ?? []).map((skill) => ({
			name: skill.name,
			description: skill.description,
		})),
		tools: usePrepared ? prepared.tools : tools,
		// Use Pi's model context after edits, summaries, and handoffs.
		// System checkpoints remain separate from the single prompt/tool accounting above.
		messages: ctx.sessionManager
			.buildSessionProjection()
			.messages.map((message) => Object.assign({}, message, { tokens: estimateTokens(message) })),
	};
	return { input, usePrepared };
}

function takeSnapshot(
	ctx: CtxCommandContext,
	pi: ExtensionAPI,
	prepared?: PreparedPrompt,
): Snapshot {
	const { input, usePrepared } = breakdownInput(ctx, pi, prepared);
	const breakdown = buildBreakdown(input);

	const usage = ctx.getContextUsage();
	return {
		breakdown,
		usage,
		modelId: ctx.model?.id ?? "unknown model",
		contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow,
		promptSource: usePrepared ? "prepared" : "current",
	};
}

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
	const wide = spec.prefix + spec.label.padEnd(spec.labelWidth) + count + (spec.suffix ?? "");
	return visibleWidth(wide) < width
		? wide
		: spec.prefix + count + "  " + spec.label + (spec.suffix ?? "");
}

interface CtxOverlayOptions {
	snapshot: Snapshot;
	tui: OverlayTui;
	theme: OverlayTheme;
	onClose: () => void;
	onRefresh: () => Snapshot;
}

class CtxOverlay {
	private snapshot: Snapshot;
	private expanded = false;
	private scrollOffset = 0;
	private cachedWidth: number | undefined;
	private cachedExpanded: boolean | undefined;
	private cachedHeader: string[] = [];
	private cachedBody: string[] = [];
	private readonly tui: OverlayTui;
	private readonly theme: OverlayTheme;
	private readonly onClose: () => void;
	private readonly onRefresh: () => Snapshot;

	constructor(options: CtxOverlayOptions) {
		this.snapshot = options.snapshot;
		this.tui = options.tui;
		this.theme = options.theme;
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

		const hint = hintRows > 0 ? [this.buildHint(w, maxOffset)] : [];
		return [...header, ...body.slice(this.scrollOffset, this.scrollOffset + visible), ...hint];
	}

	private pad(line: string, width: number): string {
		const truncated = truncateToWidth(` ${line}`, width);
		const padding = " ".repeat(Math.max(width - visibleWidth(truncated), 0));
		// Full-width background fill so transcript text doesn't bleed through.
		return this.theme.bg("customMessageBg", truncated + padding);
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
			header.push(padLine(this.fg("muted", "Pi context usage: ") + "unknown" + this.fg("dim", "")));
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
			parts.push(`↑↓ scroll (${this.scrollOffset}/${maxOffset})`);
		}
		parts.push("esc/q close", "r refresh");
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

export default function register(pi: ExtensionAPI): void {
	let prepared: PreparedPrompt | undefined;
	// Run-only prompt additions disappear from getSystemPrompt() after settlement.
	// Keep only the observed prompt in memory; never write sensitive guidance to the session.
	pi.on("context_with_system", (event, ctx) => {
		prepared = {
			key: promptKey(ctx, activeTools(pi)),
			text: getCurrentSystemPrompt(event.messages),
			tools: getCurrentTools(event.messages),
			leaf: ctx.sessionManager.getLeafId(),
		};
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (prepared && prepared.settledPrompt === undefined) {
			prepared.settledPrompt = ctx.getSystemPrompt();
		}
	});
	const clearPrompt = () => {
		prepared = undefined;
	};
	pi.on("session_start", clearPrompt);
	pi.on("session_tree", clearPrompt);
	pi.on("session_compact", clearPrompt);
	pi.on("model_select", clearPrompt);

	pi.registerCommand("ctx", {
		description: "Visual breakdown of what occupies the session context",
		handler: async (_args: string, ctx: CtxCommandContext): Promise<void> => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/ctx requires the interactive TUI", "warning");
				return;
			}
			await ctx.ui.custom(
				(tui: OverlayTui, theme: OverlayTheme, _keybindings, done) =>
					new CtxOverlay({
						snapshot: takeSnapshot(ctx, pi, prepared),
						tui,
						theme,
						onClose: () => done(null),
						onRefresh: () => {
							const next = takeSnapshot(ctx, pi, prepared);
							tui.requestRender();
							return next;
						},
					}),
				{ overlay: true, overlayOptions: { width: "85%", maxHeight: "85%", anchor: "center" } },
			);
		},
	});
}
