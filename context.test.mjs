import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { buildBreakdown } from "./breakdown.ts";

const host = process.env.PI_HOST_INDEX ?? fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { SessionManager } = await import(pathToFileURL(host));
const composition = (manager) => buildBreakdown({
	systemPrompt: "system",
	contextFiles: [], skills: [], tools: [],
	entries: manager.buildContextEntries(),
});

test("native compaction counts the summary and retained messages, not discarded history", () => {
	const manager = SessionManager.inMemory();
	manager.appendMessage({ role: "user", content: "discarded".repeat(100), timestamp: 0 });
	const kept = manager.appendMessage({ role: "user", content: "kept", timestamp: 1 });
	manager.appendCompaction("summary!", kept, 1000);
	assert.equal(composition(manager).estimatedTotal, 2 + 1 + 2);
});

test("native context-window handoff contributes once without earlier history or checkpoint duplication", {
	skip: typeof SessionManager.prototype.appendContextWindow !== "function" && "Host has no native context windows",
}, () => {
	const manager = SessionManager.inMemory();
	manager.appendMessage({ role: "system", content: "system", timestamp: 0 });
	manager.appendMessage({ role: "user", content: "discarded".repeat(100), timestamp: 1 });
	const boundary = manager.appendContextWindow("handoff!", 1000);
	manager.appendMessage({ role: "user", content: "kept", timestamp: 2 });
	assert.equal(manager.buildContextEntries()[0].type, "context_window");
	assert.ok(manager.buildSessionContext().messages.some(message => message.role === "custom" && message.content.includes("handoff!")));
	assert.equal(composition(manager).estimatedTotal, 2 + 2 + 1);
	manager.appendCompaction("summary!", boundary, 1000);
	assert.equal(composition(manager).estimatedTotal, 2 + 2 + 1 + 2);
	manager.appendContextWindow(undefined, null);
	assert.equal(composition(manager).estimatedTotal, 2);
});
