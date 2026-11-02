import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { test as nodeTest } from "node:test";
import {
	createAgentDir,
	createOverlayHarness,
	loadHostModule,
	removeAgentDir,
	type OverlayComponent,
} from "./test-harness.ts";

// Use the selected host's native loader, not a transformed copy of the component.
const host = await loadHostModule();

function assertRendersWithin(component: OverlayComponent, widths: number[]): void {
	for (const width of widths) {
		const lines = component.render(width);
		assert.ok(lines.length > 0);
		for (const line of lines) {
			assert.ok(visibleWidth(line) <= width, `${visibleWidth(line)} columns exceeds ${width}`);
		}
	}
}

function assertScrollReachesEveryLine(
	component: OverlayComponent,
	setRows: (rows: number) => void,
	full: string[],
): void {
	for (const rows of [10, 1]) {
		setRows(rows);
		component.handleInput?.("\x1b[H"); // Home
		const seen = new Set<string>();
		for (let i = 0; i < full.length; i++) {
			const lines = component.render(80);
			assert.ok(
				lines.length <= Math.max(1, Math.floor(rows * 0.85)),
				"overlay exceeds its height allocation",
			);
			if (rows > 1) {
				assert.match(lines.at(-1) ?? "", /esc\/q close/);
			}
			for (const line of lines) {
				seen.add(line);
			}
			component.handleInput?.("\x1b[B"); // Down
		}
		for (const line of full.slice(0, -1)) {
			assert.ok(seen.has(line), "scrolling must reach every content line");
		}
	}
}

nodeTest(
	"/ctx overlay respects narrow allocations through resize, expand and refresh",
	async (t) => {
		const agentDir = createAgentDir();
		t.after(() => removeAgentDir(agentDir));
		const harness = await createOverlayHarness(host, agentDir);
		const { component, terminal } = harness;
		for (const key of [undefined, "e", "r", "e"]) {
			if (key !== undefined) {
				component.handleInput?.(key);
			}
			assertRendersWithin(component, [80, 39, 20, 1, 0, 2, 40, 80]);
		}
		const narrowSystemRow = component.render(34).find((line) => line.includes("System prompt"));
		assert.ok(narrowSystemRow !== undefined);
		assert.match(
			narrowSystemRow,
			new RegExp(`\\b${Math.ceil(harness.ctx.getSystemPrompt().length / 4)}\\b`),
			"category count must remain visible in narrow overlays",
		);
		component.handleInput?.("e");
		const narrowFileRow = component.render(50).find((line) => line.includes("configs/a-very"));
		assert.ok(narrowFileRow !== undefined);
		assert.match(narrowFileRow, /\b100\b/, "long context-file count must remain visible");
		component.handleInput?.("e");
		assertScrollReachesEveryLine(
			component,
			(rows) => {
				terminal.rows = rows;
			},
			component.render(80),
		);
		assert.ok(harness.renderRequests > 0, "overlay input must request a re-render");
	},
);
