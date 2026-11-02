/**
 * Control fixtures for the quality-policy verification (verify-quality-policy.ts).
 *
 * Clean fixtures must lint without diagnostics; dirty fixtures must produce
 * their expected rule diagnostics under the adopted baseline.
 */

export const fixtureDir = "policy-fixtures";

function branchesSource(count: number): string {
	const branches = Array.from(
		{ length: count },
		(_, index) => `\tif (value === ${index}) {\n\t\treturn ${index};\n\t}`,
	);
	return `export function exceedsComplexity(value: number): number {\n${branches.join("\n")}\n\treturn 0;\n}\n`;
}

function statementsSource(count: number): string {
	const statements = Array.from({ length: count }, (_, index) => `\ttotal += ${index};`);
	return `export function exceedsStatements(total: number): number {\n${statements.join("\n")}\n\treturn total;\n}\n`;
}

function fileLinesSource(count: number): string {
	const lines = Array.from(
		{ length: count },
		(_, index) => `export const value${index} = ${index};`,
	);
	return `${lines.join("\n")}\n`;
}

function longTestSource(): string {
	const pushes = Array.from({ length: 90 }, (_, index) => `\t\tvalues.push(${index});`);
	return `import { test as nodeTest } from "node:test";\n\nnodeTest("long test bodies stay within the test profile", () => {\n\tconst values: number[] = [];\n${pushes.join("\n")}\n\tlet total = 0;\n\tfor (const value of values) {\n\t\ttotal += value;\n\t}\n\tconsole.log(total > 0);\n});\n`;
}

const DEPTH_SOURCE = `export function exceedsDepth(value: number): number {\n\tlet total = value;\n\tif (total > 0) {\n\t\tif (total > 1) {\n\t\t\tif (total > 2) {\n\t\t\t\tif (total > 3) {\n\t\t\t\t\tif (total > 4) {\n\t\t\t\t\t\ttotal += 1;\n\t\t\t\t\t}\n\t\t\t\t}\n\t\t\t}\n\t\t}\n\t}\n\treturn total;\n}\n`;

export interface Fixture {
	name: string;
	content: string;
	expected: string;
}

export const CLEAN_FIXTURES: Fixture[] = [
	{
		name: "registered-top-level.test.ts",
		content:
			'import { test as nodeTest } from "node:test";\n\nnodeTest("registered top-level calls are covered by the allowance", (t) => {\n\tt.assert.ok(true);\n});\n',
		expected: "none",
	},
	{
		name: "registered-suite.test.ts",
		content:
			'import { describe as nodeDescribe, it as nodeIt } from "node:test";\n\nnodeDescribe("suite", () => {\n\tnodeIt("registered suite calls are covered by the allowance", (t) => {\n\t\tt.assert.ok(true);\n\t});\n});\n',
		expected: "none",
	},
	{
		name: "awaited.test.ts",
		content:
			'import { readFile } from "node:fs/promises";\nimport { test as nodeTest } from "node:test";\n\nnodeTest("awaited promises are the compliant boundary", async () => {\n\tconst text = await readFile("/tmp/ctx-policy-fixture.txt", "utf8");\n\tconsole.log(text.length > 0);\n});\n',
		expected: "none",
	},
	{
		name: "within-structure.ts",
		content:
			"export function withinLimits(value: number): number {\n\tif (value === 1) {\n\t\treturn 1;\n\t}\n\tif (value === 2) {\n\t\treturn 2;\n\t}\n\treturn value;\n}\n",
		expected: "none",
	},
	{
		name: "long-test.test.ts",
		content: longTestSource(),
		expected: "none",
	},
];

export const DIRTY_FIXTURES: Fixture[] = [
	{
		name: "ctx-subtest.test.ts",
		content:
			'import { test } from "node:test";\n\ntest("unawaited subtests are floating promises", (t) => {\n\tt.test("nested", () => {\n\t\tt.assert.ok(true);\n\t});\n});\n',
		expected: "no-floating-promises",
	},
	{
		name: "local-name.test.ts",
		content:
			'let ran = false;\n\nfunction nodeTest(name: string, callback: () => void): Promise<void> {\n\tconsole.log(name);\n\tcallback();\n\tran = true;\n\treturn Promise.resolve();\n}\n\nnodeTest("local declarations do not inherit the allowance", () => {\n\tconsole.log(ran);\n});\n',
		expected: "no-floating-promises",
	},
	{
		name: "imported-name.test.ts",
		content:
			'import { readFile as nodeTest } from "node:fs/promises";\n\nnodeTest("/tmp/ctx-policy-fixture.txt", "utf8");\n',
		expected: "no-floating-promises",
	},
	{
		name: "in-body.test.ts",
		content:
			'import { readFile } from "node:fs/promises";\nimport { test } from "node:test";\n\ntest("floating calls inside test bodies are still floating", () => {\n\treadFile("/tmp/ctx-policy-fixture.txt", "utf8");\n});\n',
		expected: "no-floating-promises",
	},
	{
		name: "unrelated.test.ts",
		content:
			'import { readFile } from "node:fs/promises";\n\nreadFile("/tmp/ctx-policy-fixture.txt", "utf8");\n',
		expected: "no-floating-promises",
	},
	{
		name: "unsafe-any.ts",
		content:
			'const parsed: any = JSON.parse("{}");\n\nexport function unsafeMember(): number {\n\treturn parsed.length;\n}\n',
		expected: "no-explicit-any",
	},
	{
		name: "unsafe-assert.ts",
		content:
			'const value: unknown = "policy fixture";\nconst asserted = value as Date;\n\nexport function unsafeAssert(): Date {\n\treturn asserted;\n}\n',
		expected: "no-unsafe-type-assertion",
	},
	{
		name: "complexity-exceeds.ts",
		content: branchesSource(12),
		expected: "complexity",
	},
	{
		name: "depth-exceeds.ts",
		content: DEPTH_SOURCE,
		expected: "max-depth",
	},
	{
		name: "params-exceeds.ts",
		content:
			"export function exceedsParams(a: number, b: number, c: number, d: number, e: number): number {\n\treturn a + b + c + d + e;\n}\n",
		expected: "max-params",
	},
	{
		name: "statements-exceeds.ts",
		content: statementsSource(45),
		expected: "max-statements",
	},
	{
		name: "fnlines-exceeds.ts",
		content: statementsSource(85),
		expected: "max-lines-per-function",
	},
	{
		name: "filelines-exceeds.ts",
		content: fileLinesSource(505),
		expected: "max-lines",
	},
	{
		name: "test-complexity-exceeds.test.ts",
		content: branchesSource(16),
		expected: "complexity",
	},
	{
		name: "test-depth-exceeds.test.ts",
		content: DEPTH_SOURCE,
		expected: "max-depth",
	},
	{
		name: "test-params-exceeds.test.ts",
		content:
			"export function exceedsTestParams(a: number, b: number, c: number, d: number, e: number, f: number, g: number): number {\n\treturn a + b + c + d + e + f + g;\n}\n",
		expected: "max-params",
	},
];
