import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ESTIMATED_IMAGE_TOKENS, buildBreakdown } from "./breakdown.ts";

const base = {
	systemPrompt: "x".repeat(400),
	contextFiles: [{ path: "/repo/AGENTS.md", content: "y".repeat(800) }],
	skills: [{ name: "skill-a", description: "z".repeat(120) }],
	tools: [
		{ name: "big", description: "d".repeat(200), parameters: { p: "q".repeat(400) } },
		{ name: "small", description: "d", parameters: {} },
	],
};

describe("buildBreakdown", () => {
	it("excludes !! bash executions from totals and largest entries", () => {
		const included = [
			{ role: "bashExecution", command: "echo", output: "kept" },
			{ role: "bashExecution", command: "echo", output: "kept", excludeFromContext: false },
		];
		const expected = buildBreakdown({ ...base, messages: included });
		assert.equal(expected.categories.find((c) => c.key === "bash")?.tokens, 4);
		assert.equal(expected.largest.length, 2);
		assert.deepEqual(buildBreakdown({
			...base,
			messages: [
				...included,
				{ role: "bashExecution", command: "echo", output: "x".repeat(40000), excludeFromContext: true },
			],
		}), expected);
	});

	it("buckets assistant content blocks into text, thinking, and tool calls", () => {
		const result = buildBreakdown({
			...base,
			messages: [{
				role: "assistant",
				content: [
					{ type: "text", text: "a".repeat(400) },
					{ type: "thinking", thinking: "t".repeat(800) },
					{ type: "toolCall", name: "bash", arguments: { command: "c".repeat(396) } },
				],
			}],
		});
		const byKey = new Map(result.categories.map((c) => [c.key, c.tokens]));
		assert.equal(byKey.get("assistant"), 100);
		assert.equal(byKey.get("thinking"), 200);
		assert.ok((byKey.get("toolcalls") ?? 0) >= 100);
	});

	it("counts images in tool results at the pi image estimate", () => {
		const result = buildBreakdown({
			...base,
			messages: [{
				role: "toolResult",
				toolName: "read",
				content: [{ type: "image" }, { type: "text", text: "x".repeat(40) }],
			}],
		});
		const toolResults = result.categories.find((c) => c.key === "toolresults");
		assert.equal(toolResults?.tokens, ESTIMATED_IMAGE_TOKENS + 10);
	});

	it("folds compaction and branch summaries into one summaries category", () => {
		const result = buildBreakdown({
			...base,
			messages: [
				{ role: "compactionSummary", summary: "s".repeat(400) },
				{ role: "branchSummary", summary: "s".repeat(400) },
			],
		});
		const summaries = result.categories.find((c) => c.key === "summaries");
		assert.equal(summaries?.tokens, 200);
	});

	it("estimatedTotal is the sum of categories and largest is sorted desc, capped at 10", () => {
		const messages = Array.from({ length: 12 }, (_, i) => ({
			role: "user", content: "u".repeat(4 * (i + 1) * 10),
		}));
		const result = buildBreakdown({ ...base, messages });
		const sum = result.categories.reduce((a, c) => a + c.tokens, 0);
		assert.equal(result.estimatedTotal, sum);
		assert.equal(result.largest.length, 10);
		for (let i = 1; i < result.largest.length; i++) {
			assert.ok((result.largest[i - 1]?.tokens ?? 0) >= (result.largest[i]?.tokens ?? 0));
		}
	});

	it("keeps structural sub-rows for context files, skills, and top tools", () => {
		const result = buildBreakdown({ ...base, messages: [] });
		const system = result.categories.find((c) => c.key === "system");
		assert.deepEqual(
			system?.subs.map((s) => s.label),
			["context files ×1", "skills ×1"],
		);
		const tools = result.categories.find((c) => c.key === "tools");
		assert.equal(tools?.subs[0]?.label, "big");
	});

	it("expandedSubs carry every context file, skill, and tool", () => {
		const result = buildBreakdown({ ...base, messages: [] });
		const system = result.categories.find((c) => c.key === "system");
		assert.deepEqual(
			system?.expandedSubs.map((s) => s.label),
			["repo/AGENTS.md", "skill-a"],
		);
		const tools = result.categories.find((c) => c.key === "tools");
		assert.equal(tools?.expandedSubs.length, 2);
		assert.equal(tools?.expandedSubs[0]?.label, "big");
	});
});
