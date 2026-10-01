import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const host = process.env.PI_HOST_INDEX ?? fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { SessionManager, discoverAndLoadExtensions } = await import(pathToFileURL(host));
const root = dirname(fileURLToPath(import.meta.url));
const agentDir = mkdtempSync(join(tmpdir(), "pi-ctx-info-agent-"));

async function harness() {
	const loaded = await discoverAndLoadExtensions([join(root, "index.ts")], agentDir, agentDir);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	let prompt = "b".repeat(400);
	let active = ["read"];
	const tools = [{ name: "read", description: "Read a file", parameters: {} }];
	const sessionManager = SessionManager.inMemory(agentDir);
	const promptOptions = { contextFiles: [], skills: [], appendSystemPrompt: "" };
	loaded.runtime.getActiveTools = () => active;
	loaded.runtime.getAllTools = () => tools;
	let output;
	const theme = { fg: (_color, value) => value, bg: (_color, value) => value, bold: value => value };
	const ctx = {
		mode: "tui", model: { provider: "fixture", id: "one", contextWindow: 128000 },
		sessionManager,
		getSystemPrompt: () => prompt,
		getSystemPromptOptions: () => promptOptions,
		getContextUsage: () => ({ tokens: 1234, contextWindow: 128000, percent: 0.964 }),
		ui: {
			custom: async factory => {
				const component = factory({ terminal: { rows: 100 }, requestRender() {} }, theme, {}, () => {});
				output = component.render(150).join("\n");
			},
		},
	};
	return {
		ctx, sessionManager, tools, promptOptions,
		setPrompt(value) { prompt = value; },
		setActive(value) { active = value; },
		async event(name) {
			for (const handler of extension.handlers.get(name) ?? []) await handler({ messages: [] }, ctx);
		},
		async show() { await extension.commands.get("ctx").handler("", ctx); return output; },
	};
}

test("labels native context usage by its optional source", async () => {
	const h = await harness();
	const usage = { tokens: 1234, contextWindow: 128000, percent: 0.964 };
	for (const [value, expected] of [
		[usage, "1,234 (1.0% of window) · reported + estimated"],
		[{ ...usage, source: "reported" }, "1,234 (1.0% of window) · provider-anchored (later content estimated)"],
		[{ ...usage, source: "estimated" }, "1,234 (1.0% of window) · heuristic estimate"],
		[{ ...usage, source: "unknown", tokens: null, percent: null }, "unknown"],
		[{ ...usage, tokens: null, percent: null }, "unknown · reported + estimated"],
		[undefined, "unavailable"],
	]) {
		h.ctx.getContextUsage = () => value;
		const line = (await h.show()).split("\n").find(line => line.includes("Pi context usage:"));
		assert.equal(line.trim(), `Pi context usage: ${expected}`);
	}
});

test("counts active namespaced tools in the breakdown", async () => {
	const h = await harness();
	assert.match(await h.show(), /Tool definitions\s+5\b/);
	h.tools.push({ namespace: { name: "docs" }, name: "search", description: "x".repeat(400), parameters: {} });
	h.setActive(["search"]);
	assert.match(await h.show(), /Tool definitions\s+102\b/);
});

test("shows prepared request instructions after the run settles", async () => {
	const h = await harness();
	h.sessionManager.appendMessage({ role: "user", content: "question", timestamp: 1 });
	h.setPrompt("b".repeat(400) + "g".repeat(800));
	const before = structuredClone(h.sessionManager.getEntries());
	await h.event("context");
	assert.deepEqual(h.sessionManager.getEntries(), before, "observed guidance is never persisted");
	h.setPrompt("b".repeat(400));
	await h.event("agent_settled");
	const shown = await h.show();
	assert.match(shown, /System prompt\s+300\b/);
	assert.match(shown, /last prepared request prompt/);
	assert.match(shown, /Pi context usage:.*1,234/);
	assert.doesNotMatch(shown, /reported \(last request\)/);
});

test("uses the current prompt after an idle base-prompt edit", async () => {
	const h = await harness();
	h.setPrompt("b".repeat(400) + "g".repeat(800));
	await h.event("context");
	h.setPrompt("b".repeat(400));
	await h.event("agent_settled");
	assert.match(await h.show(), /System prompt\s+300\b/);

	h.promptOptions.appendSystemPrompt = "z".repeat(40_000);
	h.setPrompt("b".repeat(400) + h.promptOptions.appendSystemPrompt);
	const shown = await h.show();
	assert.match(shown, /System prompt\s+10,100\b/);
	assert.match(shown, /current Pi prompt/);
});

test("does not reuse a prepared prompt after active tools, model, or session context changes", async () => {
	const h = await harness();
	async function capture() {
		h.setPrompt("b".repeat(400) + "g".repeat(800));
		await h.event("context");
		h.setPrompt("b".repeat(400));
		assert.match(await h.show(), /System prompt\s+300\b/);
	}
	await capture();
	h.setActive([]);
	assert.match(await h.show(), /System prompt\s+100\b/);
	assert.match(await h.show(), /current Pi prompt/);

	await capture();
	h.ctx.model = { ...h.ctx.model, id: "two" };
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
});

test("counts native compaction and retained messages without discarded history", async () => {
	const h = await harness();
	h.setActive([]);
	h.sessionManager.appendMessage({ role: "user", content: "discarded".repeat(100), timestamp: 0 });
	const kept = h.sessionManager.appendMessage({ role: "user", content: "kept", timestamp: 1 });
	h.sessionManager.appendCompaction("summary!", kept, 1000);
	const shown = await h.show();
	assert.match(shown, /estimated composition: 103\b/);
	assert.match(shown, /User messages\s+1\b/);
	assert.match(shown, /Summaries\s+2\b/);

	h.sessionManager.appendCompaction("", undefined, 1000);
	await h.event("session_compact");
	const fresh = await h.show();
	assert.match(fresh, /estimated composition: 100\b/);
	assert.doesNotMatch(fresh, /User messages|Summaries/);
	h.sessionManager.appendMessage({ role: "user", content: "next", timestamp: 2 });
	assert.match(await h.show(), /User messages\s+1\b/);
});

test("does not count a message removed from model context", async t => {
	const h = await harness();
	if (typeof h.sessionManager.appendContextEdit !== "function") {
		t.skip("Selected host does not support context edits");
		return;
	}
	const id = h.sessionManager.appendMessage({ role: "user", content: "x".repeat(40000), timestamp: 1 });
	assert.match(await h.show(), /User messages\s+10,000\b/);
	h.sessionManager.appendContextEdit(id, null);
	assert.equal(h.sessionManager.buildSessionContext().messages.some(m => m.role === "user"), false);
	assert.doesNotMatch(await h.show(), /User messages/);
});
