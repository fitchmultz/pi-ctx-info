/**
 * Pure context-composition logic for the /ctx command.
 * No pi imports: structural types only, so this file is unit-testable with node:test.
 * Per-message totals come from pi's estimateTokens; category splits use the same chars/4 heuristic.
 */

export interface ContentBlock {
	type: string;
	text?: string;
	thinking?: string;
	name?: string;
	arguments?: unknown;
}

export interface MessageLike {
	role: string;
	/** pi's estimateTokens for the whole message. */
	tokens: number;
	customType?: string;
	content?: string | ContentBlock[];
	excludeFromContext?: boolean;
	toolName?: string;
}

export interface ContextFileLike {
	path: string;
	content: string;
}

export interface SkillLike {
	name: string;
	description?: string;
}

export interface ToolLike {
	name: string;
	description?: string;
	parameters?: unknown;
}

export interface BreakdownInput {
	systemPrompt: string;
	contextFiles: ContextFileLike[];
	skills: SkillLike[];
	/** Active tools only — inactive tool schemas are not sent. */
	tools: ToolLike[];
	/** Messages from Pi's native context-entry projection. */
	messages: MessageLike[];
}

export interface SubRow {
	label: string;
	tokens: number;
}

export interface CategoryRow {
	key: string;
	label: string;
	tokens: number;
	/** Compact sub-rows for the collapsed view. */
	subs: SubRow[];
	/** Full per-item sub-rows for the expanded view. */
	expandedSubs: SubRow[];
}

export interface LargestEntry {
	label: string;
	tokens: number;
}

export interface Breakdown {
	categories: CategoryRow[];
	largest: LargestEntry[];
	estimatedTotal: number;
}

const tokensOf = (text: string): number => Math.ceil(text.length / 4);

const CATEGORY_ORDER = [
	"system",
	"tools",
	"user",
	"assistant",
	"thinking",
	"toolcalls",
	"toolresults",
	"custom",
	"summaries",
	"bash",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
	system: "System prompt",
	tools: "Tool definitions",
	user: "User messages",
	assistant: "Assistant text",
	thinking: "Thinking",
	toolcalls: "Tool calls",
	toolresults: "Tool results",
	custom: "Extension messages",
	summaries: "Summaries / handoffs",
	bash: "Bash executions",
};

export function buildBreakdown(input: BreakdownInput): Breakdown {
	const totals = new Map<string, number>();
	const subs = new Map<string, SubRow[]>();
	const expandedSubs = new Map<string, SubRow[]>();
	const largest: LargestEntry[] = [];

	const add = (key: string, tokens: number) => {
		if (tokens > 0) totals.set(key, (totals.get(key) ?? 0) + tokens);
	};

	// System prompt + structural sub-rows.
	const systemTokens = tokensOf(input.systemPrompt);
	add("system", systemTokens);
	const systemSubs: SubRow[] = [];
	const fileRows = input.contextFiles
		.map((f) => ({ label: f.path.split("/").slice(-2).join("/"), tokens: tokensOf(f.content) }))
		.sort((a, b) => b.tokens - a.tokens);
	if (fileRows.length > 0) {
		systemSubs.push({ label: `context files ×${fileRows.length}`, tokens: fileRows.reduce((a, b) => a + b.tokens, 0) });
	}
	const skillRows = input.skills
		.map((s) => ({ label: s.name, tokens: tokensOf(s.name + (s.description ?? "")) }))
		.sort((a, b) => b.tokens - a.tokens);
	if (skillRows.length > 0) {
		systemSubs.push({ label: `skills ×${skillRows.length}`, tokens: skillRows.reduce((a, b) => a + b.tokens, 0) });
	}
	subs.set("system", systemSubs);
	expandedSubs.set("system", [...fileRows, ...skillRows]);

	// Active tool definitions.
	const toolRows = input.tools
		.map((t) => ({ label: t.name, tokens: tokensOf(t.name + (t.description ?? "") + JSON.stringify(t.parameters ?? {})) }))
		.sort((a, b) => b.tokens - a.tokens);
	const toolsTotal = toolRows.reduce((a, b) => a + b.tokens, 0);
	add("tools", toolsTotal);
	subs.set(
		"tools",
		toolRows.slice(0, 3).map((r) => ({ label: r.label, tokens: r.tokens })),
	);
	expandedSubs.set("tools", toolRows);

	// Native context messages. System checkpoints are already counted above.
	for (const message of input.messages) {
		if (message.role === "bashExecution" && message.excludeFromContext) continue;
		const { tokens } = message;
		switch (message.role) {
			case "user":
				add("user", tokens);
				largest.push({ label: "user message", tokens });
				break;
			case "assistant": {
				for (const block of (message.content as ContentBlock[] | undefined) ?? []) {
					if (block.type === "text" && block.text) add("assistant", tokensOf(block.text));
					else if (block.type === "thinking" && block.thinking) add("thinking", tokensOf(block.thinking));
					else if (block.type === "toolCall") {
						add("toolcalls", tokensOf((block.name ?? "") + JSON.stringify(block.arguments ?? null)));
					}
				}
				largest.push({ label: "assistant message", tokens });
				break;
			}
			case "toolResult": {
				add("toolresults", tokens);
				largest.push({ label: `tool result: ${message.toolName ?? "?"}`, tokens });
				break;
			}
			case "bashExecution":
				add("bash", tokens);
				largest.push({ label: "bash execution", tokens });
				break;
			case "custom": {
				const handoff = message.customType === "context-window";
				add(handoff ? "summaries" : "custom", tokens);
				largest.push({ label: handoff ? "context-window handoff" : `extension: ${message.customType ?? "?"}`, tokens });
				break;
			}
			case "branchSummary":
			case "compactionSummary":
				add("summaries", tokens);
				largest.push({ label: `${message.role}`, tokens });
				break;
		}
	}

	const categories: CategoryRow[] = [];
	for (const key of CATEGORY_ORDER) {
		const tokens = totals.get(key) ?? 0;
		if (tokens === 0) continue;
		categories.push({ key, label: CATEGORY_LABELS[key] ?? key, tokens, subs: subs.get(key) ?? [], expandedSubs: expandedSubs.get(key) ?? [] });
	}

	const estimatedTotal = categories.reduce((sum, c) => sum + c.tokens, 0);
	largest.sort((a, b) => b.tokens - a.tokens);

	return { categories, largest: largest.slice(0, 10), estimatedTotal };
}

export function formatTokens(tokens: number): string {
	return tokens.toLocaleString("en-US");
}
