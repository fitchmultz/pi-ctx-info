/**
 * Pure context-composition logic for the /ctx command.
 * No pi imports: structural types only, so this file is unit-testable with node:test.
 * Token estimates use pi's own chars/4 heuristic (see estimateTokens in pi's compaction module).
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
	content?: string | ContentBlock[];
	command?: string;
	output?: string;
	summary?: string;
	toolName?: string;
}

export interface EntryLike {
	type: string;
	message?: MessageLike;
	customType?: string;
	content?: string | ContentBlock[];
	summary?: string;
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
	/** Entries from sessionManager.buildContextEntries(). */
	entries: EntryLike[];
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

/** pi's ESTIMATED_IMAGE_CHARS (4800) / 4. */
export const ESTIMATED_IMAGE_TOKENS = 1200;

const tokensOf = (text: string): number => Math.ceil(text.length / 4);

function contentChars(content: string | ContentBlock[] | undefined): { chars: number; images: number } {
	if (content === undefined) return { chars: 0, images: 0 };
	if (typeof content === "string") return { chars: content.length, images: 0 };
	let chars = 0;
	let images = 0;
	for (const block of content) {
		if (block.type === "text" && block.text) chars += block.text.length;
		else if (block.type === "image") images += 1;
	}
	return { chars, images };
}

function messageTokens(message: MessageLike): number {
	switch (message.role) {
		case "assistant": {
			let chars = 0;
			for (const block of message.content as ContentBlock[] | undefined ?? []) {
				if (block.type === "text" && block.text) chars += block.text.length;
				else if (block.type === "thinking" && block.thinking) chars += block.thinking.length;
				else if (block.type === "toolCall") chars += (block.name?.length ?? 0) + JSON.stringify(block.arguments ?? null).length;
			}
			return Math.ceil(chars / 4);
		}
		case "bashExecution":
			return tokensOf((message.command ?? "") + (message.output ?? ""));
		case "branchSummary":
		case "compactionSummary":
			return tokensOf(message.summary ?? "");
		default: {
			const { chars, images } = contentChars(message.content);
			return Math.ceil(chars / 4) + images * ESTIMATED_IMAGE_TOKENS;
		}
	}
}

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
	summaries: "Summaries (compaction/branch)",
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

	// Session entries.
	for (const entry of input.entries) {
		if (entry.type === "message" && entry.message) {
			const message = entry.message;
			const tokens = messageTokens(message);
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
				case "custom":
					add("custom", tokens);
					largest.push({ label: "custom message", tokens });
					break;
				case "branchSummary":
				case "compactionSummary":
					add("summaries", tokens);
					largest.push({ label: `${message.role}`, tokens });
					break;
			}
		} else if (entry.type === "compaction") {
			const tokens = tokensOf(entry.summary ?? "");
			add("summaries", tokens);
			largest.push({ label: "compaction summary", tokens });
		} else if (entry.type === "branch_summary") {
			const tokens = tokensOf(entry.summary ?? "");
			add("summaries", tokens);
			largest.push({ label: "branch summary", tokens });
		} else if (entry.type === "custom_message") {
			const { chars, images } = contentChars(entry.content);
			const tokens = Math.ceil(chars / 4) + images * ESTIMATED_IMAGE_TOKENS;
			add("custom", tokens);
			largest.push({ label: `extension: ${entry.customType ?? "?"}`, tokens });
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
