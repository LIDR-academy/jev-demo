// DESPUÉS del Acto 2, paso 2: cada PR se revisa con el modelo que eligió Jev (corre npm run route antes).
//   npm run despues:prs
//   npm run despues:prs -- --only 17148,16722      solo algunos (el resto sale de la caché)
//   npm run despues:prs -- --replay

import { existsSync } from "node:fs";
import { ENGINE } from "./lib/claude.ts";
import { fmtMs, fmtUsd } from "./lib/clock.ts";
import { MOCK, REPLAY, arg, modeBanner, outPath, readJson, rootPath, writeJson } from "./lib/env.ts";
import { ROUTING_FILE, type ReviewRun, type RoutingResult, estimateWall, loadPrs, reviewerLabel, runReviews } from "./lib/prs.ts";

const T = readJson<{ prs: Record<string, number> }>(rootPath("config", "thresholds.json")).prs;

async function main() {
  const banner = modeBanner();
  if (banner) console.log(banner);
  if (!existsSync(ROUTING_FILE())) throw new Error("No hay ruteo. Corre primero: npm run route");
  const routing = readJson<RoutingResult>(ROUTING_FILE());
  const prs = loadPrs(arg("only"));
  const plan = prs.map((pr) => {
    const route = routing.routes.find((r) => r.number === pr.number);
    if (!route) throw new Error(`El PR #${pr.number} no está en el ruteo. Corre npm run route de nuevo.`);
    return { pr, reviewer: route.reviewer };
  });
  const concurrency = Number(arg("concurrency") ?? T.concurrencia_revisiones);
  console.log(`DESPUÉS · ${plan.length} PRs, cada uno con el modelo que eligió Jev (${concurrency} en paralelo)\n`);

  const { items, wall_ms } = await runReviews("despues", plan, concurrency);

  // Si se corrió solo una parte (--only), se combina con lo guardado para que la tarjeta tenga los 12.
  const file = outPath("despues", "prs.json");
  const previous = arg("only") && existsSync(file) ? readJson<ReviewRun>(file).items.filter((i) => !items.some((n) => n.number === i.number)) : [];
  const all = [...previous, ...items].sort((a, b) => a.number - b.number);
  const partial = previous.length > 0;
  const run: ReviewRun = {
    side: "despues",
    generated_at: new Date().toISOString(),
    mode: MOCK ? "mock" : REPLAY ? "replay" : "live",
    // Con una corrida parcial, el tiempo total se estima con la duración real de cada revisión.
    wall_ms: partial ? estimateWall(all.map((i) => i.duration_ms), concurrency) : wall_ms,
    wall_estimated: partial || undefined,
    claude_engine: MOCK ? "mock" : ENGINE,
    jev_cost_usd: routing.cost_usd,
    jev_ms: routing.wall_ms,
    items: all,
  };
  writeJson(file, run);

  const lint = items.filter((i) => i.reviewer === "lint_only");
  if (lint.length) console.log(`  ${lint.map((i) => `#${i.number}`).join(", ")}: ${reviewerLabel("lint_only")}, sin LLM`);
  const cost = all.reduce((a, i) => a + i.cost_usd, 0);
  const high = all.reduce((a, i) => a + i.high_findings.length, 0);
  const scope = partial ? `los ${all.length} PRs (${items.length} en esta corrida, el resto guardado; tiempo estimado)` : `los ${all.length} PRs`;
  console.log(`\nRevisiones de ${scope}: ${fmtMs(run.wall_ms)} · ${fmtUsd(cost)} · ${high} hallazgos [ALTA]`);
  console.log(`Decidir con Jev costó ${fmtUsd(routing.cost_usd)} y tardó ${fmtMs(routing.wall_ms)}`);
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
