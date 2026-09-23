import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const host = process.env.PI_HOST_INDEX ?? fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { SessionManager } = await import(pathToFileURL(host));
const { loadExtensions } = await import(pathToFileURL(join(dirname(host), "core/extensions/loader.js")));
const root = dirname(fileURLToPath(import.meta.url));

async function harness() {
	const loaded = await loadExtensions([join(root, "index.ts")], root);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	let prompt = "b".repeat(400);
	let active = ["read"];
	const tools = [{ name: "read", description: "Read a file", parameters: {} }];
	const sessionManager = SessionManager.inMemory();
	loaded.runtime.getActiveTools = () => active;
	loaded.runtime.getAllTools = () => tools;
	let output;
	const theme = { fg: (_color, value) => value, bg: (_color, value) => value, bold: value => value };
	const ctx = {
		mode: "tui", model: { provider: "fixture", id: "one", contextWindow: 128000 },
		sessionManager,
		getSystemPrompt: () => prompt,
		getSystemPromptOptions: () => ({ contextFiles: [], skills: [] }),
		getContextUsage: () => ({ tokens: 1234, contextWindow: 128000, percent: 0.964 }),
		ui: {
			custom: async factory => {
				const component = factory({ terminal: { rows: 100 }, requestRender() {} }, theme, {}, () => {});
				output = component.render(150).join("\n");
			},
		},
	};
	return {
		ctx, sessionManager, tools,
		setPrompt(value) { prompt = value; },
		setActive(value) { active = value; },
		async event(name) {
			for (const handler of extension.handlers.get(name) ?? []) await handler({ messages: [] }, ctx);
		},
		async show() { await extension.commands.get("ctx").handler("", ctx); return output; },
	};
}

test("counts active namespaced tools in the breakdown", async () => {
	const h = await harness();
	assert.match(await h.show(), /Tool definitions\s+5\b/);
	h.tools.push({ id: '["docs","search"]', namespace: "docs", name: "search", description: "x".repeat(400), parameters: {} });
	h.setActive(['["docs","search"]']);
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
	const shown = await h.show();
	assert.match(shown, /System prompt\s+300\b/);
	assert.match(shown, /last prepared request prompt/);
	assert.match(shown, /Pi context usage:.*1,234/);
	assert.doesNotMatch(shown, /reported \(last request\)/);
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

test("counts the native fresh-context handoff while excluding old conversation", async t => {
	const h = await harness();
	if (typeof h.sessionManager.appendContextWindow !== "function") {
		assert.notEqual(process.env.PI_COMPAT_HOST, "fork", "Fork qualification requires native fresh context windows");
		t.skip("This Pi host does not implement fresh context windows");
		return;
	}
	h.sessionManager.appendMessage({ role: "system", content: "b".repeat(400), timestamp: 0 });
	h.sessionManager.appendMessage({ role: "user", content: "old".repeat(2000), timestamp: 1 });
	const boundary = h.sessionManager.appendContextWindow("h".repeat(400), 2000);
	h.sessionManager.appendMessage({ role: "user", content: "kept", timestamp: 2 });
	const shown = await h.show();
	assert.match(shown, /context-window handoff\s+1\d\d\b/);
	assert.match(shown, /User messages\s+1\b/);
	assert.match(shown, /System prompt\s+100\b/);

	h.sessionManager.appendCompaction("summary!", boundary, 2000);
	assert.match(await h.show(), /context-window handoff\s+1\d\d\b/);
	assert.match(await h.show(), /compactionSummary\s+2\b/);

	h.sessionManager.appendContextWindow(undefined, null);
	const fresh = await h.show();
	assert.doesNotMatch(fresh, /User messages|compactionSummary/);
	assert.match(fresh, /context-window handoff\s+2\d\b/);
	assert.match(fresh, /System prompt\s+100\b/);
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
	assert.match(shown, /Summaries \/ handoffs\s+2\b/);
});
