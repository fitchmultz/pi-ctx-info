import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import extension from "./index.ts";

function harness() {
	const handlers = new Map();
	let command;
	let prompt = "b".repeat(400);
	let active = ["read"];
	const tools = [{ name: "read", description: "Read a file", parameters: {} }];
	const sessionManager = SessionManager.inMemory();
	const pi = {
		on(name, handler) { handlers.set(name, handler); },
		registerCommand(name, definition) { if (name === "ctx") command = definition; },
		getActiveTools: () => active,
		getAllTools: () => tools,
	};
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
	extension(pi);
	return {
		ctx, sessionManager,
		setPrompt(value) { prompt = value; },
		setActive(value) { active = value; },
		async event(name) { await handlers.get(name)?.({ messages: [] }, ctx); },
		async show() { await command.handler("", ctx); return output; },
	};
}

test("shows prepared request instructions after the run settles", async () => {
	const h = harness();
	h.sessionManager.appendMessage({ role: "user", content: "question", timestamp: 1 });
	h.setPrompt("b".repeat(400) + "g".repeat(800));
	await h.event("context");
	h.setPrompt("b".repeat(400));
	const shown = await h.show();
	assert.match(shown, /System prompt\s+300\b/);
	assert.match(shown, /last prepared request prompt/);
	assert.match(shown, /Pi context usage:.*1,234/);
	assert.doesNotMatch(shown, /reported \(last request\)/);
});

test("does not reuse a prepared prompt after active tools, model, or session context changes", async () => {
	const h = harness();
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

	await capture();
	await h.event("session_start");
	assert.match(await h.show(), /System prompt\s+100\b/);
});

test("counts the native fresh-context handoff while excluding old conversation", async t => {
	const h = harness();
	if (typeof h.sessionManager.appendContextWindow !== "function") {
		t.skip("This Pi host does not implement fresh context windows");
		return;
	}
	h.sessionManager.appendMessage({ role: "system", content: "b".repeat(400), timestamp: 0 });
	h.sessionManager.appendMessage({ role: "user", content: "old".repeat(2000), timestamp: 1 });
	h.sessionManager.appendContextWindow("h".repeat(400), 2000);
	const shown = await h.show();
	assert.match(shown, /context-window handoff\s+1\d\d\b/);
	assert.doesNotMatch(shown, /User messages/);
	assert.match(shown, /System prompt\s+100\b/);
});
