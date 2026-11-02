import assert from "node:assert/strict";
import { test as nodeTest, type TestContext } from "node:test";
import type { ContextUsage } from "@earendil-works/pi-coding-agent";
import type { CtxModel } from "./index.ts";
import {
	createAgentDir,
	createSnapshotHarness,
	loadHostModule,
	removeAgentDir,
	type SnapshotHarness,
} from "./test-harness.ts";

// Use the selected host's native loader, not a transformed copy of the component.
const host = await loadHostModule();
const agentDir = createAgentDir();
nodeTest.after(() => removeAgentDir(agentDir));

const model: CtxModel = { provider: "fixture", id: "one", contextWindow: 128000 };

async function harness(): Promise<SnapshotHarness> {
	const created = await createSnapshotHarness(host, agentDir);
	created.ctx.model = model;
	return created;
}

/** Renders the overlay while counting prompt-key and tool-schema JSON.stringify calls. */
async function measuredShow(
	t: TestContext,
	h: SnapshotHarness,
): Promise<{ output: string; counts: [number, number] }> {
	const spy = t.mock.method(JSON, "stringify");
	let output: string;
	try {
		output = await h.show();
	} finally {
		spy.mock.restore();
	}
	let keys = 0;
	let schemas = 0;
	for (const call of spy.mock.calls) {
		const value: unknown = call.arguments[0];
		if (
			Array.isArray(value) &&
			value.length === 4 &&
			value[0] === h.sessionManager.getSessionId() &&
			value[1] === h.ctx.model?.provider &&
			value[2] === h.ctx.model?.id &&
			Array.isArray(value[3])
		) {
			keys += 1;
		}
		if (h.tools.some((tool) => tool.parameters === value)) {
			schemas += 1;
		}
	}
	return { output, counts: [keys, schemas] };
}

nodeTest(
	"labels native context usage, unknown totals, and unavailable usage honestly",
	async () => {
		const h = await harness();
		const usage: ContextUsage = { tokens: 1234, contextWindow: 128000, percent: 0.964 };
		const cases: [ContextUsage | undefined, string][] = [
			[usage, "1,234 (1.0% of window) · reported + estimated"],
			[{ ...usage, tokens: null, percent: null }, "unknown"],
			[undefined, "unavailable"],
		];
		for (const [value, expected] of cases) {
			h.ctx.getContextUsage = () => value;
			const line = (await h.show())
				.split("\n")
				.find((candidate) => candidate.includes("Pi context usage:"));
			assert.ok(line !== undefined);
			assert.equal(line.trim(), `Pi context usage: ${expected}`);
		}
	},
);

nodeTest(
	"only fingerprints comparisons with a prepared prompt, preserving tool accounting and reset output",
	async (t) => {
		const h = await harness();
		const current = await h.show();
		const fresh = await measuredShow(t, h);
		assert.deepEqual(fresh.counts, [0, h.tools.length]);
		assert.equal(fresh.output, current);

		for (const event of ["session_start", "session_tree", "session_compact", "model_select"]) {
			h.setPrompt("b".repeat(400) + "g".repeat(800));
			await h.event("context_with_system");
			h.setPrompt("b".repeat(400));
			await h.event("agent_settled");
			const prepared = await h.show();
			const control = await measuredShow(t, h);
			assert.deepEqual(
				control.counts,
				[1, h.tools.length],
				`${event}: prepared comparison retained`,
			);
			assert.equal(control.output, prepared);
			assert.match(prepared, /last prepared request prompt/);

			await h.event(event);
			const cleared = await measuredShow(t, h);
			assert.deepEqual(cleared.counts, [0, h.tools.length], `${event}: no comparison after reset`);
			assert.equal(cleared.output, current, `${event}: unchanged current prompt output`);
		}
	},
);

nodeTest("counts active namespaced tools in the breakdown", async () => {
	const h = await harness();
	assert.match(await h.show(), /Tool definitions\s+5\b/);
	h.tools.push({
		namespace: { name: "docs" },
		name: "search",
		description: "x".repeat(400),
		parameters: {},
		exposure: "direct",
		sourceInfo: { path: "builtin:search", source: "pi", scope: "user", origin: "package" },
	});
	h.setActive(["search"]);
	assert.match(await h.show(), /Tool definitions\s+102\b/);
});

nodeTest("shows prepared request instructions after the run settles", async () => {
	const h = await harness();
	h.sessionManager.appendMessage({ role: "user", content: "question", timestamp: 1 });
	h.setPrompt("b".repeat(400) + "g".repeat(800));
	const before = structuredClone(h.sessionManager.getEntries());
	await h.event("context_with_system");
	assert.deepEqual(h.sessionManager.getEntries(), before, "observed guidance is never persisted");
	h.setPrompt("b".repeat(400));
	await h.event("agent_settled");
	const shown = await h.show();
	assert.match(shown, /System prompt\s+300\b/);
	assert.match(shown, /last prepared request prompt/);
	assert.match(shown, /Pi context usage:.*1,234/);
	assert.doesNotMatch(shown, /reported \(last request\)/);
});

nodeTest(
	"captures canonical system sections and prepared declarations without session scans",
	async () => {
		const h = await harness();
		h.sessionManager.appendMessage({
			role: "system",
			content: "b".repeat(400),
			timestamp: 0,
			toolsAdded: [{ name: "read", description: "x".repeat(400), parameters: {} }],
		});
		h.sessionManager.appendMessage({
			role: "system",
			content: "",
			sections: { policy: "g".repeat(800) },
			timestamp: 1,
		});
		h.sessionManager.appendMessage({ role: "user", content: "question", timestamp: 2 });
		const messages = h.sessionManager.buildSessionContext().messages;
		const sessionManager = h.sessionManager;
		// Replaced with failing doubles: request capture must not scan the session.
		const originals = {
			buildContextEntries: sessionManager.buildContextEntries.bind(sessionManager),
			buildSessionProjection: sessionManager.buildSessionProjection.bind(sessionManager),
			getBranch: sessionManager.getBranch.bind(sessionManager),
			getEntries: sessionManager.getEntries.bind(sessionManager),
		};
		const fail = (name: string): never => assert.fail(`request capture must not call ${name}`);
		sessionManager.buildContextEntries = () => fail("buildContextEntries");
		sessionManager.buildSessionProjection = () => fail("buildSessionProjection");
		sessionManager.getBranch = () => fail("getBranch");
		sessionManager.getEntries = () => fail("getEntries");
		try {
			await h.event("context_with_system", messages);
		} finally {
			sessionManager.buildContextEntries = originals.buildContextEntries;
			sessionManager.buildSessionProjection = originals.buildSessionProjection;
			sessionManager.getBranch = originals.getBranch;
			sessionManager.getEntries = originals.getEntries;
		}
		const shown = await h.show();
		assert.match(
			shown,
			/System prompt\s+3\d\d\b/,
			"native named sections are included, not only ctx's base prompt",
		);
		assert.match(
			shown,
			/Tool definitions\s+102\b/,
			"prepared declarations rather than registration descriptions",
		);
		h.sessionManager.appendCompaction("", null, 1000);
		assert.match(
			await h.show(),
			/System prompt\s+100\b/,
			"boundary drafts invalidate prepared state even without a session_compact notification",
		);
	},
);

nodeTest("uses the current prompt after an idle base-prompt edit", async () => {
	const h = await harness();
	h.setPrompt("b".repeat(400) + "g".repeat(800));
	await h.event("context_with_system");
	h.setPrompt("b".repeat(400));
	await h.event("agent_settled");
	assert.match(await h.show(), /System prompt\s+300\b/);

	h.promptOptions.appendSystemPrompt = "z".repeat(40_000);
	h.setPrompt("b".repeat(400) + h.promptOptions.appendSystemPrompt);
	const shown = await h.show();
	assert.match(shown, /System prompt\s+10,100\b/);
	assert.match(shown, /current Pi prompt/);
});

nodeTest(
	"does not reuse a prepared prompt after active tools, model, or session context changes",
	async () => {
		const h = await harness();
		async function capture() {
			h.setPrompt("b".repeat(400) + "g".repeat(800));
			await h.event("context_with_system");
			h.setPrompt("b".repeat(400));
			assert.match(await h.show(), /System prompt\s+300\b/);
		}
		await capture();
		h.setActive([]);
		assert.match(await h.show(), /System prompt\s+100\b/);
		assert.match(await h.show(), /current Pi prompt/);

		await capture();
		h.ctx.model = { ...model, id: "two" };
		assert.match(await h.show(), /System prompt\s+100\b/);

		await capture();
		await h.event("session_tree");
		assert.match(await h.show(), /System prompt\s+100\b/);

		for (const event of ["session_start", "session_compact", "model_select"]) {
			await capture();
			await h.event(event);
			assert.match(await h.show(), /System prompt\s+100\b/);
		}
		await capture();
		assert.match(await (await harness()).show(), /current Pi prompt/);
	},
);

nodeTest("counts native compaction and retained messages without discarded history", async () => {
	const h = await harness();
	h.setActive([]);
	h.sessionManager.appendMessage({ role: "user", content: "discarded".repeat(100), timestamp: 0 });
	const kept = h.sessionManager.appendMessage({ role: "user", content: "kept", timestamp: 1 });
	h.sessionManager.appendCompaction("summary!", kept, 1000);
	const shown = await h.show();
	assert.match(shown, /estimated composition: 103\b/);
	assert.match(shown, /User messages\s+1\b/);
	assert.match(shown, /Summaries\s+2\b/);

	h.sessionManager.appendCompaction("", null, 1000);
	await h.event("session_compact");
	const fresh = await h.show();
	assert.match(fresh, /estimated composition: 100\b/);
	assert.doesNotMatch(fresh, /User messages|Summaries/);
	h.sessionManager.appendMessage({ role: "user", content: "next", timestamp: 2 });
	assert.match(await h.show(), /User messages\s+1\b/);
});

nodeTest("does not count a message removed from model context", async (t) => {
	const h = await harness();
	if (typeof h.sessionManager.appendContextEdit !== "function") {
		t.skip("Selected host does not support context edits");
		return;
	}
	const id = h.sessionManager.appendMessage({
		role: "user",
		content: "x".repeat(40_000),
		timestamp: 1,
	});
	assert.match(await h.show(), /User messages\s+10,000\b/);
	h.sessionManager.appendContextEdit(id, null);
	assert.equal(
		h.sessionManager.buildSessionContext().messages.some((message) => message.role === "user"),
		false,
	);
	assert.doesNotMatch(await h.show(), /User messages/);
});
