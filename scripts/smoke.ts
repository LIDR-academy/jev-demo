// Prueba de punta a punta con respuestas simuladas: no llama a Jev, a Claude ni a Jira, y no gasta.
// Sirve para comprobar que todo está instalado y conectado. Los números que imprime NO se presentan.
//   npm run smoke

import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { rootPath } from "./lib/env.ts";

const env = { ...process.env, DEMO_MOCK: "1", DEMO_OUT: "out-smoke", NO_COLOR: "1" };
rmSync(rootPath("out-smoke"), { recursive: true, force: true });

const steps: [string, string[]][] = [
  ["antes:backlog", ["scripts/antes-backlog.ts", "--input", "data/backlog-seed.json"]],
  ["priorizar", ["scripts/priorizar.ts", "--input", "data/backlog-seed.json"]],
  ["priorizar --replay", ["scripts/priorizar.ts", "--input", "data/backlog-seed.json", "--replay"]],
  ["antes:prs", ["scripts/antes-prs.ts"]],
  ["route", ["scripts/route.ts"]],
  ["despues:prs", ["scripts/despues-prs.ts"]],
  ["despues:prs --only (parcial)", ["scripts/despues-prs.ts", "--only", "17148,16722"]],
  ["hallazgos:init", ["scripts/hallazgos-init.ts"]],
  ["compare all", ["scripts/compare.ts", "all"]],
  ["compare --solo-antes", ["scripts/compare.ts", "backlog", "--solo-antes"]],
];

for (const [name, args] of steps) {
  process.stdout.write(`▶ ${name} … `);
  try {
    const out = execFileSync(process.execPath, args, { cwd: rootPath(), env, encoding: "utf8" });
    console.log("ok");
    if (process.argv.includes("--verbose")) console.log(out);
  } catch (e) {
    console.log("FALLÓ");
    const err = e as { stdout?: string; stderr?: string };
    console.error(err.stdout, err.stderr);
    process.exit(1);
  }
}
console.log("\nTodo conectado. Resultados simulados en out-smoke/ (no se presentan).");
