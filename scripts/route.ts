// DESPUÉS del Acto 2, paso 1: Jev decide con qué modelo se revisa cada PR, viendo solo metadatos.
//   npm run route
//   npm run route -- --replay

import { fmtMs, fmtUsd, mapPool, now } from "./lib/clock.ts";
import { MOCK, REPLAY, arg, modeBanner, readJson, rootPath, writeJson } from "./lib/env.ts";
import { type Questions, askJev, choice, noul, score } from "./lib/jev.ts";
import { ROUTING_FILE, type Reviewer, type Routing, type RoutingResult, estimateWall, loadPrs, reviewerLabel, routingState } from "./lib/prs.ts";

const T = readJson<{ prs: Record<string, number> }>(rootPath("config", "thresholds.json")).prs;
const QUESTIONS = readJson<{ questions: Questions }>(rootPath("questions", "pr-routing.json")).questions;
const RANK: Reviewer[] = ["lint_only", "haiku", "sonnet", "opus"];

async function main() {
  const banner = modeBanner();
  if (banner) console.log(banner);
  const prs = loadPrs(arg("only"));
  console.log(`Jev decide el revisor de ${prs.length} PRs de medusajs/medusa (solo metadatos, sin diff)\n`);

  const t0 = now();
  const responses = await mapPool(prs, T.concurrencia_jev, (pr) => askJev(routingState(pr), QUESTIONS, "route"));
  const replayed = responses.some((r) => r.replayed);
  const wall = replayed ? estimateWall(responses.map((r) => r.ms), T.concurrencia_jev) : now() - t0;

  const routes: Routing[] = prs.map((pr, i) => {
    const r = responses[i];
    const c = choice(r, "reviewer");
    const sensitive = noul(r, "sensitive");
    const rules: string[] = [];
    let reviewer = c.choice as Reviewer;
    if (sensitive >= T.piso_sensible && RANK.indexOf(reviewer) < RANK.indexOf("sonnet")) {
      rules.push(`piso: código sensible (${sensitive.toFixed(2)} ≥ ${T.piso_sensible}) → al menos Sonnet`);
      reviewer = "sonnet";
    }
    const gray_zone = c.confidence < T.zona_gris_confianza;
    if (gray_zone) rules.push(`zona gris: confianza ${c.confidence.toFixed(2)} < ${T.zona_gris_confianza} → revisión humana además`);
    return {
      number: pr.number,
      title: pr.title,
      jev_choice: c.choice as Reviewer,
      reviewer,
      confidence: c.confidence,
      probabilities: c.probabilities,
      risk: score(r, "risk").score,
      sensitive,
      cross_module: noul(r, "cross_module"),
      gray_zone,
      rules,
    };
  });

  const result: RoutingResult = {
    generated_at: new Date().toISOString(),
    mode: MOCK ? "mock" : REPLAY ? "replay" : "live",
    model: responses[0]?.model ?? "",
    wall_ms: wall,
    cost_usd: responses.reduce((a, r) => a + r.cost_usd, 0),
    input_tokens: responses.reduce((a, r) => a + r.usage.input_tokens, 0),
    routes,
  };
  writeJson(ROUTING_FILE(), result);

  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log(`${pad("PR", 7)} ${pad("Revisor", 14)} ${pad("Conf.", 6)} ${pad("Riesgo", 7)} ${pad("Sensible", 9)} Título`);
  for (const r of routes) {
    const who = reviewerLabel(r.reviewer) + (r.reviewer !== r.jev_choice ? "*" : "") + (r.gray_zone ? " ⚑" : "");
    console.log(`${pad("#" + r.number, 7)} ${pad(who, 14)} ${pad(r.confidence.toFixed(2), 6)} ${pad(r.risk.toFixed(1) + "/4", 7)} ${pad(r.sensitive.toFixed(2), 9)} ${r.title}`);
  }
  const ruled = routes.filter((r) => r.rules.length);
  if (ruled.length) {
    console.log("\nReglas aplicadas en código:");
    for (const r of ruled) console.log(`  #${r.number}: ${r.rules.join("; ")}`);
  }
  const counts = RANK.map((k) => `${reviewerLabel(k)}: ${routes.filter((r) => r.reviewer === k).length}`).join(" · ");
  console.log(`\n${counts}`);
  console.log(`Jev: ${prs.length} PRs en ${fmtMs(result.wall_ms)} · ${fmtUsd(result.cost_usd)}  (* = subido por la regla de piso, ⚑ = zona gris)`);
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
