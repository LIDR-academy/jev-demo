// ANTES del Acto 1: Claude Sonnet prioriza el mismo backlog con un prompt, como lo haría hoy un dev con IA.
// Corre 2 veces (para medir consistencia) y se guarda en out/antes/backlog.json.
//
//   npm run antes:backlog
//   npm run antes:backlog -- --input data/backlog-seed.json   sin Jira
//   npm run antes:backlog -- --model opus                     otro modelo para el antes

import { existsSync, readFileSync } from "node:fs";
import { type BacklogResult, type Decision, PRIORITIES, SNAPSHOT, checkTraps, consistency, loadIssues, printDecisions } from "./lib/backlog.ts";
import { ENGINE, extractJson, runClaude } from "./lib/claude.ts";
import { fmtMs, fmtUsd } from "./lib/clock.ts";
import { MOCK, REPLAY, arg, modeBanner, outPath, readJson, rootPath, writeJson } from "./lib/env.ts";
import { type ClaudeAlias, claudeModel, isClaudeAlias } from "./lib/pricing.ts";
import type { Issue } from "./lib/jira.ts";

const SPRINT = readJson<{ objetivo: string }>(rootPath("config", "sprint.json"));
const goal = arg("goal") ?? SPRINT.objetivo;
const runs = Math.max(1, Number(arg("runs") ?? 2));
const model = parseModel(arg("model") ?? "sonnet");

function parseModel(m: string): ClaudeAlias {
  if (!isClaudeAlias(m)) throw new Error("--model debe ser haiku, sonnet u opus");
  return m;
}

type Row = {
  key: string;
  issue_type?: string;
  priority?: string;
  business_impact?: number;
  blocks_revenue?: boolean;
  ready_for_dev?: boolean;
  duplicate_of?: string | null;
  reason?: string;
};

function buildPrompt(issues: Issue[]): string {
  const list = issues
    .map((i) => `### ${i.key} · ${i.issuetype} · prioridad actual ${i.priority}\n${i.summary}\n${i.description}`)
    .join("\n\n");
  return readFileSync(rootPath("prompts", "backlog-antes.md"), "utf8").replace("{{SPRINT_GOAL}}", goal).replace("{{ISSUES}}", list);
}

function mockAnswer(issues: Issue[], run: number): string {
  const rows: Row[] = issues.map((i, n) => ({
    key: i.key,
    issue_type: i.issuetype === "Bug" ? "bug" : "feature",
    priority: PRIORITIES[(n * 7 + run * (n % 3)) % 5],
    business_impact: n % 5,
    blocks_revenue: /pago|cobr|cup[oó]n|checkout/i.test(i.summary + i.description),
    ready_for_dev: i.description.length > 60,
    duplicate_of: null,
    reason: "simulado",
  }));
  return "```json\n" + JSON.stringify(rows, null, 2) + "\n```";
}

function toDecision(issue: Issue, row: Row | undefined): Decision {
  return {
    key: issue.key,
    summary: issue.summary,
    priority_before: issue.priority,
    priority: row?.priority && PRIORITIES.includes(row.priority as never) ? row.priority : issue.priority,
    issue_type: row?.issue_type ?? "?",
    business_impact: typeof row?.business_impact === "number" ? row.business_impact : null,
    blocks_revenue: typeof row?.blocks_revenue === "boolean" ? Number(row.blocks_revenue) : null,
    ready_for_dev: typeof row?.ready_for_dev === "boolean" ? Number(row.ready_for_dev) : null,
    is_duplicate: row?.duplicate_of ? 1 : 0,
    duplicate_of: row?.duplicate_of ?? null,
    needs_review: row?.ready_for_dev === false,
    decided: row !== undefined, // el LLM siempre decide una prioridad, salvo que omita el ticket
    confidence: null, // un LLM de texto no trae una confianza calibrada por decisión
    rules: row ? [] : ["faltó en la respuesta del modelo"],
    reason: row?.reason,
  };
}

async function main() {
  const banner = modeBanner();
  if (banner) console.log(banner);
  // Por defecto usa el snapshot del backlog: así el antes y el después ven exactamente la misma entrada.
  const input = arg("input") ?? (existsSync(SNAPSHOT()) ? SNAPSHOT() : undefined);
  const { issues, source } = await loadIssues(input);
  console.log(`ANTES · ${claudeModel(model).label} con un prompt · ${issues.length} issues desde ${source}`);
  console.log(`Objetivo del sprint: ${goal}\n`);

  const prompt = buildPrompt(issues);
  const result: BacklogResult = {
    side: "antes",
    engine: `${claudeModel(model).label} con un prompt`,
    goal,
    source,
    generated_at: new Date().toISOString(),
    mode: MOCK ? "mock" : REPLAY ? "replay" : "live",
    claude_engine: MOCK ? "mock" : ENGINE,
    runs: [],
  };

  for (let run = 1; run <= runs; run++) {
    const r = await runClaude({
      model,
      system: "Eres un tech lead experto en priorización. Respondes solo con JSON válido.",
      prompt,
      mock: () => mockAnswer(issues, run),
      tag: `backlog-run${run}`,
    });
    const parsed = extractJson<Row[] | { issues: Row[] }>(r.text);
    const rows = parsed.ok ? (Array.isArray(parsed.value) ? parsed.value : parsed.value.issues ?? []) : [];
    result.runs.push({
      wall_ms: r.duration_ms,
      cost_usd: r.cost_usd,
      input_tokens: r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens,
      output_tokens: r.usage.output_tokens,
      // Válida solo si el JSON se pudo leer y trae una decisión por cada ticket.
      parse_ok: parsed.ok && issues.every((i) => rows.some((row) => row.key === i.key)),
      decisions: issues.map((i) => toDecision(i, rows.find((row) => row.key === i.key))),
    });
    const last = result.runs.at(-1)!;
    const missing = issues.filter((i) => !rows.some((row) => row.key === i.key)).length;
    console.log(
      `Corrida ${run}: ${fmtMs(last.wall_ms)} · ${fmtUsd(last.cost_usd)} · JSON ${last.parse_ok ? "válido y completo" : parsed.ok ? `incompleto (faltan ${missing} tickets)` : `inválido (${parsed.error})`}`,
    );
  }

  writeJson(outPath("antes", "backlog.json"), result);
  console.log("");
  printDecisions(result.runs[0].decisions);
  console.log("\nTrampas:");
  for (const t of checkTraps(result.runs[0].decisions)) console.log(`  ${t.detected === null ? "?" : t.detected ? "✔" : "✘"} ${t.label}`);
  if (result.runs.length > 1) {
    const c = consistency(result.runs[0].decisions, result.runs[1].decisions);
    console.log(`Consistencia: ${c.changed} de ${c.total} decididos cambiaron de prioridad entre corridas · ${c.undecided} sin decidir (faltantes)`);
  }
  console.log("\nGuardado en out/antes/backlog.json");
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
