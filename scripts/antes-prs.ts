// ANTES del Acto 2: los 12 PRs revisados todos con Opus, con el mismo prompt que usará el después.
// Se guarda en out/antes/prs.json y out/antes/reviews/.
//   npm run antes:prs
//   npm run antes:prs -- --only 16722,17148

import { ENGINE } from "./lib/claude.ts";
import { fmtMs, fmtUsd } from "./lib/clock.ts";
import { MOCK, REPLAY, arg, modeBanner, outPath, readJson, rootPath, writeJson } from "./lib/env.ts";
import { isClaudeAlias } from "./lib/pricing.ts";
import { type ReviewRun, loadPrs, reviewerLabel, runReviews } from "./lib/prs.ts";

const T = readJson<{ prs: Record<string, number> }>(rootPath("config", "thresholds.json")).prs;

async function main() {
  const banner = modeBanner();
  if (banner) console.log(banner);
  const model = arg("model") ?? "opus";
  if (!isClaudeAlias(model)) throw new Error("--model debe ser haiku, sonnet u opus");
  const prs = loadPrs(arg("only"));
  const concurrency = Number(arg("concurrency") ?? T.concurrencia_revisiones);
  console.log(`ANTES · ${prs.length} PRs revisados todos con ${reviewerLabel(model)} (${concurrency} en paralelo)\n`);

  const { items, wall_ms } = await runReviews("antes", prs.map((pr) => ({ pr, reviewer: model })), concurrency);
  const run: ReviewRun = {
    side: "antes",
    generated_at: new Date().toISOString(),
    mode: MOCK ? "mock" : REPLAY ? "replay" : "live",
    wall_ms,
    claude_engine: MOCK ? "mock" : ENGINE,
    jev_cost_usd: 0,
    jev_ms: 0,
    items,
  };
  writeJson(outPath("antes", "prs.json"), run);
  const cost = items.reduce((a, i) => a + i.cost_usd, 0);
  const high = items.reduce((a, i) => a + i.high_findings.length, 0);
  console.log(`\nTotal: ${fmtMs(wall_ms)} · ${fmtUsd(cost)} · ${high} hallazgos [ALTA]`);
  console.log("Guardado en out/antes/prs.json y out/antes/reviews/");
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
