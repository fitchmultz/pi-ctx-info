/**
 * Verifies the adopted strict oxlint/oxfmt quality policy (docs/quality/standard.md).
 *
 * Fails when the lint configuration drifts from the adopted baseline, when a
 * representative policy downgrade or an uncovered maintained source is
 * accepted, when recorded exceptions stop matching the source, or when the
 * enforcement controls (node:test registration boundary, floating promises,
 * type safety, structural limits, test profile) stop producing diagnostics.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import oxfmtConfig from "../.oxfmtrc.json" with { type: "json" };
import oxlintConfig from "../.oxlintrc.json" with { type: "json" };
import exceptions from "../docs/quality/exceptions.json" with { type: "json" };
import { CLEAN_FIXTURES, DIRTY_FIXTURES, fixtureDir } from "./policy-fixtures.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const oxlintBin = join(root, "node_modules", ".bin", "oxlint");

type OxlintConfig = typeof oxlintConfig;
type Violation = string;

/** Rules the adopted baseline deliberately leaves off (standard, Appendix A). */
const BASELINE_OFF_RULES: readonly string[] = [
	"no-await-in-loop",
	"no-control-regex",
	"no-underscore-dangle",
	"require-await",
	"typescript/consistent-return",
	"typescript/prefer-readonly-parameter-types",
	"typescript/require-await",
	"typescript/strict-void-return",
	"unicorn/consistent-function-scoping",
	"unicorn/no-array-reverse",
	"unicorn/no-array-sort",
];

const SOURCE_PATTERN = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const MAINTAINED_DIRECTORIES = [".", "scripts"];

function isDeepEqual(actual: unknown, expected: unknown): boolean {
	try {
		assert.deepEqual(actual, expected);
		return true;
	} catch {
		return false;
	}
}

function drift(label: string, actual: unknown, expected: unknown): Violation | null {
	return isDeepEqual(actual, expected) ? null : `${label} drifted from the adopted baseline`;
}

function compact(values: (Violation | null)[]): Violation[] {
	return values.filter((value): value is Violation => value !== null);
}

function globalOptionViolations(config: OxlintConfig): Violation[] {
	const { options } = config;
	return compact([
		drift("options.typeAware", options.typeAware, true),
		drift("options.typeCheck", options.typeCheck, false),
		drift("options.denyWarnings", options.denyWarnings, true),
		drift("options.reportUnusedDisableDirectives", options.reportUnusedDisableDirectives, "error"),
		drift("options.respectEslintDisableDirectives", options.respectEslintDisableDirectives, false),
	]);
}

function structuralViolations(config: OxlintConfig): Violation[] {
	const { rules } = config;
	return compact([
		drift("complexity", rules.complexity, ["error", { max: 10, variant: "modified" }]),
		drift("max-depth", rules["max-depth"], ["error", { max: 3 }]),
		drift("max-params", rules["max-params"], ["error", { max: 4 }]),
		drift("max-statements", rules["max-statements"], ["error", { max: 40 }]),
		drift("max-lines-per-function", rules["max-lines-per-function"], [
			"error",
			{ max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
		]),
		drift("max-lines", rules["max-lines"], [
			"error",
			{ max: 500, skipBlankLines: true, skipComments: true },
		]),
	]);
}

function testProfileViolations(config: OxlintConfig): Violation[] {
	const testOverride = config.overrides[0];
	if (testOverride === undefined) {
		return ["test override profile missing"];
	}
	const violation = drift("test override profile", testOverride.rules, {
		complexity: ["error", { max: 15, variant: "modified" }],
		"max-depth": ["error", { max: 4 }],
		"max-params": ["error", { max: 6 }],
		"max-statements": "off",
		"max-lines-per-function": "off",
		"max-lines": "off",
	});
	return violation === null ? [] : [violation];
}

function safetyRuleViolations(config: OxlintConfig): Violation[] {
	const { rules } = config;
	return compact([
		drift("typescript/no-explicit-any", rules["typescript/no-explicit-any"], [
			"error",
			{ fixToUnknown: false, ignoreRestArgs: false },
		]),
		drift(
			"typescript/no-unsafe-type-assertion",
			rules["typescript/no-unsafe-type-assertion"],
			"error",
		),
		drift("typescript/strict-boolean-expressions", rules["typescript/strict-boolean-expressions"], [
			"error",
			{
				allowAny: false,
				allowNullableBoolean: false,
				allowNullableEnum: false,
				allowNullableNumber: false,
				allowNullableObject: true,
				allowNullableString: false,
				allowNumber: false,
				allowString: false,
			},
		]),
		drift("eqeqeq", rules.eqeqeq, ["error", "always"]),
		drift("no-implicit-coercion", rules["no-implicit-coercion"], "error"),
		drift("no-param-reassign", rules["no-param-reassign"], [
			"error",
			{ props: true, ignorePropertyModificationsFor: [], ignorePropertyModificationsForRegex: [] },
		]),
	]);
}

function floatingPromisesSetting(): unknown {
	return [
		"error",
		{
			checkThenables: true,
			ignoreIIFE: false,
			ignoreVoid: false,
			allowForKnownSafeCalls: [exceptions.exceptions["QX-001"].config],
			allowForKnownSafePromises: [],
		},
	];
}

function promiseRuleViolations(config: OxlintConfig): Violation[] {
	const { rules } = config;
	return compact([
		drift(
			"typescript/no-floating-promises",
			rules["typescript/no-floating-promises"],
			floatingPromisesSetting(),
		),
		drift("typescript/no-misused-promises", rules["typescript/no-misused-promises"], "error"),
		drift("typescript/await-thenable", rules["typescript/await-thenable"], "error"),
		drift("promise/catch-or-return", rules["promise/catch-or-return"], "error"),
		drift("import/no-cycle", rules["import/no-cycle"], [
			"error",
			{ ignoreTypes: false, ignoreExternal: false, allowUnsafeDynamicCyclicDependency: false },
		]),
	]);
}

function offRuleViolations(config: OxlintConfig): Violation[] {
	const offRules: string[] = [];
	for (const [name, setting] of Object.entries(config.rules)) {
		const severity = Array.isArray(setting) ? setting[0] : setting;
		if (severity !== "error") {
			offRules.push(name);
		}
	}
	const expected = [...BASELINE_OFF_RULES].sort();
	const actual = [...offRules].sort();
	return isDeepEqual(actual, expected)
		? []
		: [`rules left off changed from the adopted baseline: ${actual.join(", ")}`];
}

function configViolations(config: OxlintConfig): Violation[] {
	return [
		...globalOptionViolations(config),
		...(drift("categories", config.categories, {
			correctness: "error",
			suspicious: "error",
			perf: "error",
			pedantic: "off",
			style: "off",
			restriction: "off",
			nursery: "off",
		}) === null
			? []
			: ["categories drifted from the adopted baseline"]),
		...(drift("plugins", config.plugins, [
			"eslint",
			"typescript",
			"unicorn",
			"oxc",
			"import",
			"promise",
		]) === null
			? []
			: ["plugins drifted from the adopted baseline"]),
		...structuralViolations(config),
		...testProfileViolations(config),
		...safetyRuleViolations(config),
		...promiseRuleViolations(config),
		...offRuleViolations(config),
	];
}

function formatterViolations(): Violation[] {
	return compact([
		drift("oxfmt printWidth", oxfmtConfig.printWidth, 100),
		drift("oxfmt useTabs", oxfmtConfig.useTabs, true),
		drift("oxfmt semi", oxfmtConfig.semi, true),
		drift("oxfmt singleQuote", oxfmtConfig.singleQuote, false),
		drift("oxfmt trailingComma", oxfmtConfig.trailingComma, "all"),
		drift("oxfmt endOfLine", oxfmtConfig.endOfLine, "lf"),
		drift("oxfmt insertFinalNewline", oxfmtConfig.insertFinalNewline, true),
		drift("oxfmt ignorePatterns", oxfmtConfig.ignorePatterns, ["package-lock.json"]),
	]);
}

interface DisableDirective {
	file: string;
	rule: string;
	id: string;
}

function disableDirectives(sourceFiles: string[]): DisableDirective[] {
	const directives: DisableDirective[] = [];
	for (const file of sourceFiles) {
		const text = readFileSync(join(root, file), "utf8");
		const pattern = /oxlint-disable-next-line\s+(\S+)\s+--\s+(QX-\d+)/g;
		for (const match of text.matchAll(pattern)) {
			const rule = match[1];
			const id = match[2];
			if (rule !== undefined && id !== undefined) {
				directives.push({ file, rule, id });
			}
		}
	}
	return directives;
}

function exceptionViolations(sourceFiles: string[]): Violation[] {
	const violations: Violation[] = [];
	const manifest = exceptions.exceptions;
	const qx002 = manifest["QX-002"];
	const recorded = new Set(qx002.sites.map((site) => `${site.file} ${qx002.rule}`));
	const directives = disableDirectives(sourceFiles);
	for (const directive of directives) {
		const key = `${directive.file} ${directive.rule}`;
		if (!(directive.id in manifest)) {
			violations.push(`unknown exception id ${directive.id} in ${directive.file}`);
		} else if (!recorded.has(key)) {
			violations.push(`unrecorded disable directive ${directive.rule} in ${directive.file}`);
		}
	}
	const siteCount = directives.filter((directive) => directive.id === "QX-002").length;
	if (siteCount !== qx002.sites.length) {
		violations.push(`QX-002 records ${qx002.sites.length} site(s) but source carries ${siteCount}`);
	}
	return violations;
}

function maintainedSourceFiles(): string[] {
	const files: string[] = [];
	for (const directory of MAINTAINED_DIRECTORIES) {
		const absolute = directory === "." ? root : join(root, directory);
		for (const entry of readdirSync(absolute, { withFileTypes: true })) {
			if (entry.isFile() && SOURCE_PATTERN.test(entry.name)) {
				files.push(directory === "." ? entry.name : `${directory}/${entry.name}`);
			}
		}
	}
	return files.sort();
}

function coveredByTsconfig(file: string): boolean {
	return file.endsWith(".ts") && (!file.includes("/") || file.startsWith("scripts/"));
}

function coverageViolations(): Violation[] {
	const violations: Violation[] = [];
	for (const file of maintainedSourceFiles()) {
		if (!coveredByTsconfig(file)) {
			violations.push(`${file} is maintained source outside compiler coverage`);
		}
	}
	if ("ignorePatterns" in oxlintConfig) {
		violations.push(".oxlintrc.json must not ignore maintained source");
	}
	return violations;
}

interface LintResult {
	status: number;
	output: string;
}

function runOxlint(target: string): LintResult {
	try {
		// Pin the JSON reporter: oxlint's default renderer varies with the
		// ambient environment (the CI qualifier's isolated env gets the fancy
		// renderer, which is not line-parsable).
		const output = execFileSync(oxlintBin, ["--deny-warnings", "--format=json", target], {
			cwd: root,
			encoding: "utf8",
		});
		return { status: 0, output };
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"status" in error &&
			typeof error.status === "number"
		) {
			const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
			return { status: error.status, output: stdout };
		}
		throw error;
	}
}

function bareRule(rule: string): string {
	const match = /^\w+\((.+)\)$/.exec(rule);
	return match === null ? rule : (match[1] ?? rule);
}

function diagnosticsOf(output: string): Map<string, string[]> {
	const found = new Map<string, string[]>();
	if (output.trim() === "") {
		return found;
	}
	const parsed: unknown = JSON.parse(output);
	if (typeof parsed !== "object" || parsed === null || !("diagnostics" in parsed)) {
		throw new Error("unexpected oxlint JSON report");
	}
	const { diagnostics } = parsed;
	if (!Array.isArray(diagnostics)) {
		throw new Error("unexpected oxlint JSON report");
	}
	for (const entry of diagnostics) {
		const diagnostic = diagnosticEntry(entry);
		if (diagnostic === null) {
			throw new Error("unexpected oxlint diagnostic entry");
		}
		const rules = found.get(diagnostic.filename) ?? [];
		rules.push(bareRule(diagnostic.code));
		found.set(diagnostic.filename, rules);
	}
	return found;
}

function diagnosticEntry(entry: unknown): { filename: string; code: string } | null {
	if (typeof entry !== "object" || entry === null || !("code" in entry) || !("filename" in entry)) {
		return null;
	}
	if (typeof entry.code !== "string" || typeof entry.filename !== "string") {
		return null;
	}
	return { filename: entry.filename, code: entry.code };
}

function writeFixtures(): void {
	mkdirSync(join(root, fixtureDir, "clean"), { recursive: true });
	mkdirSync(join(root, fixtureDir, "dirty"), { recursive: true });
	const tsconfig = JSON.stringify(
		{ extends: "../tsconfig.json", include: ["**/*.ts"] },
		null,
		"\t",
	);
	writeFileSync(join(root, fixtureDir, "tsconfig.json"), `${tsconfig}\n`);
	for (const fixture of [...CLEAN_FIXTURES, ...DIRTY_FIXTURES]) {
		const group = CLEAN_FIXTURES.includes(fixture) ? "clean" : "dirty";
		writeFileSync(join(root, fixtureDir, group, fixture.name), fixture.content);
	}
}

function verifyControls(): void {
	const clean = runOxlint(`${fixtureDir}/clean`);
	assert.equal(
		clean.status,
		0,
		`clean control fixtures must lint without diagnostics\n${clean.output}`,
	);
	const dirty = runOxlint(`${fixtureDir}/dirty`);
	assert.notEqual(dirty.status, 0, "dirty control fixtures must fail the lint gate");
	const found = diagnosticsOf(dirty.output);
	for (const fixture of DIRTY_FIXTURES) {
		const rules = found.get(`${fixtureDir}/dirty/${fixture.name}`) ?? [];
		assert.ok(
			rules.includes(fixture.expected),
			`control fixture ${fixture.name} must produce ${fixture.expected}; got ${rules.join(", ")}`,
		);
	}
}

function main(): void {
	const sourceFiles = maintainedSourceFiles();

	assert.deepEqual(
		configViolations(oxlintConfig),
		[],
		"lint policy drifted from the adopted baseline",
	);
	assert.deepEqual(formatterViolations(), [], "formatter policy drifted from the adopted baseline");
	assert.deepEqual(
		exceptionViolations(sourceFiles),
		[],
		"recorded exceptions drifted from the source",
	);
	assert.deepEqual(coverageViolations(), [], "maintained source coverage drifted");

	const downgraded = structuredClone(oxlintConfig);
	downgraded.rules.complexity = ["warn", { max: 99, variant: "modified" }];
	assert.ok(
		configViolations(downgraded).length > 0,
		"a representative policy downgrade must be rejected",
	);

	const orphan = join(root, "orphan.mts");
	writeFileSync(orphan, "export const orphan = 1;\n");
	try {
		assert.ok(
			coverageViolations().length > 0,
			"omitted maintained source must fail coverage verification",
		);
	} finally {
		rmSync(orphan, { force: true });
	}

	writeFixtures();
	try {
		verifyControls();
	} finally {
		rmSync(join(root, fixtureDir), { recursive: true, force: true });
	}

	console.log(
		"quality policy verified: baseline integrity, source coverage, recorded exceptions, enforcement controls",
	);
}

main();
