import {
	estimateTokens,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	type ExtensionUIContext,
} from "@earendil-works/pi-coding-agent";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { type BreakdownInput, buildBreakdown, sanitizeLabel } from "./breakdown.ts";
import {
	CtxOverlay,
	type OverlayCustomFactory,
	type OverlayKeybindings,
	type OverlayTheme,
	type OverlayTui,
	type Snapshot,
} from "./overlay.ts";

export type { OverlayCustomFactory, OverlayKeybindings, OverlayTheme, OverlayTui };

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
		| "hasUI"
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

interface PreparedPrompt {
	key: string;
	text: string;
	tools: ReturnType<typeof activeTools>;
	leaf: string | null;
	settledPrompt?: string;
}

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
		modelId: sanitizeLabel(ctx.model?.id ?? "unknown model"),
		contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow,
		promptSource: usePrepared ? "prepared" : "current",
	};
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
			if (!ctx.hasUI) {
				if (ctx.mode === "print") {
					console.error("/ctx requires interactive mode");
				}
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/ctx requires interactive mode", "warning");
				return;
			}
			await ctx.ui.custom(
				(tui: OverlayTui, theme: OverlayTheme, keybindings: OverlayKeybindings, done) =>
					new CtxOverlay({
						snapshot: takeSnapshot(ctx, pi, prepared),
						tui,
						theme,
						keybindings,
						onClose: () => done(null),
						onRefresh: () => takeSnapshot(ctx, pi, prepared),
					}),
				{ overlay: true, overlayOptions: { width: "85%", maxHeight: "85%", anchor: "center" } },
			);
		},
	});
}
