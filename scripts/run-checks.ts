/**
 * Runs every acceptance gate independently and aggregates the results, so one
 * failing gate does not hide another (docs/quality/standard.md, Section 8).
 */
import { spawnSync } from "node:child_process";

interface Gate {
	name: string;
	label: string;
}

const GATES: readonly Gate[] = [
	{ name: "check:lock", label: "dependency lockfile policy" },
	{ name: "check:policy", label: "adopted quality policy" },
	{ name: "format:check", label: "oxfmt formatting" },
	{ name: "lint", label: "oxlint lint" },
	{ name: "check", label: "tsc type checking" },
	{ name: "test", label: "node --test" },
];

interface GateResult extends Gate {
	status: number;
}

function runGate(gate: Gate): GateResult {
	const result = spawnSync("npm", ["run", gate.name], { stdio: "inherit" });
	return { ...gate, status: result.status ?? 1 };
}

function main(): number {
	const results = GATES.map(runGate);
	for (const result of results) {
		const outcome = result.status === 0 ? "PASS" : "FAIL";
		console.log(`${outcome} ${result.name} (${result.label})`);
		if (result.status !== 0) {
			console.log(`     see the output above for the failing ${result.label} gate`);
		}
	}
	return results.filter((result) => result.status !== 0).length;
}

process.exitCode = main();
