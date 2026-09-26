import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

// Use the selected host's native loader, not a transformed copy of the component.
const host = process.env.PI_HOST_INDEX ?? fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const { SessionManager, discoverAndLoadExtensions } = await import(pathToFileURL(host));
const root = dirname(fileURLToPath(import.meta.url));
const ansi = (value) => `\x1b[38;5;75m${value}\x1b[39m`;
const theme = { fg: (_color, value) => ansi(value), bg: (_color, value) => `\x1b[48;5;236m${value}\x1b[49m`, bold: ansi };

test("/ctx overlay respects narrow allocations through resize, expand and refresh", async () => {
	const loaded = await discoverAndLoadExtensions([join(root, "index.ts")], root, mkdtempSync(join(tmpdir(), "pi-ctx-info-agent-")));
	assert.deepEqual(loaded.errors, []);
	loaded.runtime.getActiveTools = () => [];
	loaded.runtime.getAllTools = () => [];
	let component;
	const terminal = { rows: 40 };
	const ctx = {
		mode: "tui",
		getSystemPromptOptions: () => ({ contextFiles: [{ path: "/repo/configs/a-very-long-context-file-name-here.md", content: "x".repeat(400) }] }),
		getSystemPrompt: () => "Context composition fixture 界".repeat(20),
		getContextUsage: () => undefined,
		sessionManager: SessionManager.inMemory(),
		ui: { custom: async (factory) => {
			component = factory({ terminal, requestRender() {} }, theme, {}, () => {});
		} },
	};
	await loaded.extensions[0].commands.get("ctx").handler("", ctx);
	for (const key of [undefined, "e", "r", "e"]) {
		if (key) component.handleInput(key);
		for (const width of [80, 39, 20, 1, 0, 2, 40, 80]) {
			const lines = component.render(width);
			assert.ok(lines.length > 0);
			for (const line of lines) assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} columns exceeds ${width}`);
		}
	}
	const narrowSystemRow = component.render(34).find((line) => line.includes("System prompt"));
	assert.ok(narrowSystemRow);
	assert.match(narrowSystemRow, new RegExp(`\\b${Math.ceil(ctx.getSystemPrompt().length / 4)}\\b`), "category count must remain visible in narrow overlays");
	component.handleInput("e");
	const narrowFileRow = component.render(50).find((line) => line.includes("configs/a-very"));
	assert.ok(narrowFileRow);
	assert.match(narrowFileRow, /\b100\b/, "long context-file count must remain visible");
	component.handleInput("e");
	const full = component.render(80);
	for (const rows of [10, 1]) {
		terminal.rows = rows;
		component.handleInput("\x1b[H"); // Home
		const seen = new Set();
		for (let i = 0; i < full.length; i++) {
			const lines = component.render(80);
			assert.ok(lines.length <= Math.max(1, Math.floor(rows * 0.85)), "overlay exceeds its height allocation");
			if (rows > 1) assert.match(lines.at(-1), /esc\/q close/);
			for (const line of lines) seen.add(line);
			component.handleInput("\x1b[B"); // Down
		}
		for (const line of full.slice(0, -1)) assert.ok(seen.has(line), "scrolling must reach every content line");
	}
});
