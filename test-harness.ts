/**
 * Shared typed harness for the native host tests: loads the selected host's real
 * loader, registers the extension, and builds command-context doubles that
 * satisfy exactly the surfaces /ctx consumes.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
	BuildSystemPromptOptions,
	ContextWithSystemEvent,
	Extension,
	ExtensionRuntime,
	RegisteredCommand,
	SessionManager,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";
import type * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { CtxCommandContext, OverlayTheme } from "./index.ts";

export const root = dirname(fileURLToPath(import.meta.url));

/** The installed-declaration contract for whichever host module PI_HOST_INDEX selects. */
export type HostModule = typeof PiCodingAgent;

function isHostModule(value: unknown): value is HostModule {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	return (
		"SessionManager" in value &&
		typeof value.SessionManager === "function" &&
		"discoverAndLoadExtensions" in value &&
		typeof value.discoverAndLoadExtensions === "function"
	);
}

// Use the selected host's native loader, not a transformed copy of the component.
export async function loadHostModule(): Promise<HostModule> {
	const index =
		process.env.PI_HOST_INDEX ??
		fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
	const module: unknown = await import(pathToFileURL(index).href);
	if (!isHostModule(module)) {
		throw new TypeError(`Selected host ${index} does not export the pi-ctx-info test surface`);
	}
	return module;
}

export function createAgentDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-ctx-info-agent-"));
}

export function removeAgentDir(agentDir: string): void {
	rmSync(agentDir, { recursive: true, force: true });
}

export interface LoadedExtension {
	extension: Extension;
	runtime: ExtensionRuntime;
	command: RegisteredCommand;
}

export async function loadExtension(host: HostModule, agentDir: string): Promise<LoadedExtension> {
	const loaded = await host.discoverAndLoadExtensions([join(root, "index.ts")], agentDir, agentDir);
	assert.deepEqual(loaded.errors, []);
	const extension = loaded.extensions[0];
	assert.ok(extension, "pi-ctx-info must register its own extension");
	const command = extension.commands.get("ctx");
	assert.ok(command, "/ctx must be registered");
	return { extension, runtime: loaded.runtime, command };
}

/** Invoke the registered /ctx handler against a narrowed command context. */
export function ctxHandler(
	command: RegisteredCommand,
): (args: string, ctx: CtxCommandContext) => Promise<void> {
	// The handler is registered against Pi's full context type; the doubles below
	// satisfy exactly the narrower contract the overlay consumes, and any member
	// the overlay uses beyond them fails closed at runtime (missing on the double).
	// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- QX-002: the /ctx handler consumes only CtxCommandContext; unmocked members fail closed at runtime.
	return command.handler as (args: string, ctx: CtxCommandContext) => Promise<void>;
}

/** Passthrough theme double: renders text exactly as given. */
export const passthroughTheme: OverlayTheme = {
	fg: (_color, text) => text,
	bg: (_color, text) => text,
	bold: (text) => text,
};

/** Minimal tool fixture; the host runtime is mocked to return it. */
export function toolFixtures(): ToolInfo[] {
	return [
		{
			name: "read",
			description: "Read a file",
			parameters: {},
			exposure: "direct",
			sourceInfo: { path: "builtin:read", source: "pi", scope: "user", origin: "package" },
		},
	];
}

/** Render the overlay factory once at 150 columns, capturing its output. */
function captureOverlay(
	factory: Parameters<CtxCommandContext["ui"]["custom"]>[0],
	sink: (text: string) => void,
): Promise<null> {
	const component = factory(
		{
			terminal: { rows: 100 },
			requestRender() {
				/* driven synchronously by the harness */
			},
		},
		passthroughTheme,
		{},
		() => {
			/* overlay dismissal is not exercised here */
		},
	);
	sink(component.render(150).join("\n"));
	return Promise.resolve(null);
}

export interface SnapshotHarness {
	ctx: CtxCommandContext;
	sessionManager: SessionManager;
	tools: ToolInfo[];
	promptOptions: BuildSystemPromptOptions;
	setPrompt: (value: string) => void;
	setActive: (names: string[]) => void;
	event: (name: string, messages?: ContextWithSystemEvent["messages"]) => Promise<void>;
	show: () => Promise<string>;
}

export async function createSnapshotHarness(
	host: HostModule,
	agentDir: string,
): Promise<SnapshotHarness> {
	const { extension, runtime, command } = await loadExtension(host, agentDir);
	let prompt = "b".repeat(400);
	const active = ["read"];
	const tools = toolFixtures();
	const sessionManager = host.SessionManager.inMemory(agentDir);
	const promptOptions: BuildSystemPromptOptions = {
		cwd: agentDir,
		contextFiles: [],
		skills: [],
		appendSystemPrompt: "",
	};
	runtime.getActiveTools = () => active;
	runtime.getAllTools = () => tools;
	let output: string | undefined;
	const ctx: CtxCommandContext = {
		mode: "tui",
		model: { provider: "fixture", id: "one", contextWindow: 128000 },
		sessionManager,
		getSystemPrompt: () => prompt,
		getSystemPromptOptions: () => promptOptions,
		getContextUsage: () => ({ tokens: 1234, contextWindow: 128000, percent: 0.964 }),
		ui: {
			custom: (factory) =>
				captureOverlay(factory, (text) => {
					output = text;
				}),
			notify(message) {
				throw new Error(`unexpected notify: ${message}`);
			},
		},
	};
	const handler = ctxHandler(command);
	return {
		ctx,
		sessionManager,
		tools,
		promptOptions,
		setPrompt(value) {
			prompt = value;
		},
		setActive(value) {
			active.length = 0;
			active.push(...value);
		},
		async event(
			name,
			messages = [
				{
					role: "system",
					content: prompt,
					toolsAdded: tools.filter((tool) => active.includes(tool.name)),
					timestamp: 0,
				},
			],
		) {
			// Registered event handlers are stored as wrappers accepting any arguments.
			for (const registered of extension.handlers.get(name) ?? []) {
				await registered({ messages }, ctx);
			}
		},
		async show() {
			await handler("", ctx);
			assert.ok(output !== undefined, "/ctx must render its overlay");
			return output;
		},
	};
}

/** Component double type captured by the overlay harness. */
export type OverlayComponent = Component & { dispose?: () => void };

export interface OverlayHarness {
	ctx: CtxCommandContext;
	terminal: { rows: number };
	component: OverlayComponent;
	renderRequests: number;
}

export async function createOverlayHarness(
	host: HostModule,
	agentDir: string,
): Promise<OverlayHarness> {
	const { runtime, command } = await loadExtension(host, agentDir);
	runtime.getActiveTools = () => [];
	runtime.getAllTools = () => [];
	const terminal = { rows: 40 };
	let renderRequests = 0;
	let component: OverlayComponent | undefined;
	const ansi = (value: string) => `\x1b[38;5;75m${value}\x1b[39m`;
	const theme: OverlayTheme = {
		fg: (_color, value) => ansi(value),
		bg: (_color, value) => `\x1b[48;5;236m${value}\x1b[49m`,
		bold: ansi,
	};
	const ctx: CtxCommandContext = {
		mode: "tui",
		model: undefined,
		sessionManager: host.SessionManager.inMemory(agentDir),
		getSystemPrompt: () => "Context composition fixture 界".repeat(20),
		getSystemPromptOptions: () => ({
			cwd: agentDir,
			contextFiles: [
				{ path: "/repo/configs/a-very-long-context-file-name-here.md", content: "x".repeat(400) },
			],
		}),
		getContextUsage: () => ({ tokens: 1234, contextWindow: 128000, percent: 0.964 }),
		ui: {
			custom: async (factory) => {
				component = factory(
					{
						terminal,
						requestRender() {
							renderRequests += 1;
						},
					},
					theme,
					{},
					() => {
						/* overlay dismissal is not exercised here */
					},
				);
				return null;
			},
			notify(message) {
				throw new Error(`unexpected notify: ${message}`);
			},
		},
	};
	await ctxHandler(command)("", ctx);
	assert.ok(component, "/ctx must render its overlay");
	return {
		ctx,
		terminal,
		get component() {
			assert.ok(component, "overlay component must remain captured");
			return component;
		},
		get renderRequests() {
			return renderRequests;
		},
	};
}
