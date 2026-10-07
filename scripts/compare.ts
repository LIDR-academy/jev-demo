// Tarjetas de antes y después con las mismas métricas.
//   npm run compare -- backlog
//   npm run compare -- prs
//   npm run compare -- all
//   npm run compare -- backlog --solo-antes      solo la columna del antes (para mostrarla primero)

import { existsSync } from "node:fs";
import { type BacklogResult, checkTraps, consistency } from "./lib/backlog.ts";
import { fmtMs, fmtUsd } from "./lib/clock.ts";
import { flag, outPath, positional, readJson } from "./lib/env.ts";
import { type ReviewRun, type Reviewer, type RoutingResult, ROUTING_FILE, reviewerLabel } from "./lib/prs.ts";

type Row = { label: string; antes: string; despues: string; sub?: boolean };
type Card = { title: string; antesTitle: string; despuesTitle: string; engineNote: string; rows: Row[]; footer: string[]; modes: string[] };

const engineName = (e?: string) => (e === "api" ? "API de Anthropic" : e === "cli" ? "claude -p" : e ?? "?");

const soloAntes = flag("solo-antes");
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const bold = (s: string) => (color ? `\x1b[1m${s}\x1b[0m` : s);
const dim = (s: string) => (color ? `\x1b[2m${s}\x1b[0m` : s);
const yellow = (s: string) => (color ? `\x1b[33m${s}\x1b[0m` : s);

function need<T>(file: string, hint: string): T {
  if (!existsSync(file)) throw new Error(`Falta ${file}. ${hint}`);
  return readJson<T>(file);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** "62% menos" o "15% más", según el caso. */
const delta = (before: number, after: number, noun: string) => {
  if (!(before > 0)) return `— ${noun}`;
  const p = Math.round((1 - after / before) * 100);
  return p >= 0 ? `${p}% menos ${noun}` : `${-p}% más ${noun}`;
};

function backlogCard(): Card {
  const a = need<BacklogResult>(outPath("antes", "backlog.json"), "Corre npm run antes:backlog.");
  const d = soloAntes ? undefined : need<BacklogResult>(outPath("despues", "backlog.json"), "Corre npm run priorizar.");
  const ta = checkTraps(a.runs[0].decisions);
  const td = d ? checkTraps(d.runs[0].decisions) : [];
  const mark = (v: boolean | null | undefined) => (v === undefined ? "" : v === null ? "?" : v ? "sí" : "no");
  const count = (ts: typeof ta) => `${ts.filter((t) => t.detected).length} / ${ts.length}`;
  const cons = (r: BacklogResult) => (r.runs.length < 2 ? undefined : consistency(r.runs[0].decisions, r.runs[1].decisions));
  const cA = cons(a);
  const cDs = d ? cons(d) : undefined;
  const fmtCons = (c?: ReturnType<typeof consistency>) => (c ? `${c.changed} / ${c.total}` : "1 corrida");
  const tA = avg(a.runs.map((r) => r.wall_ms));
  const costA = avg(a.runs.map((r) => r.cost_usd));
  const tD = d ? avg(d.runs.map((r) => r.wall_ms)) : 0;
  const costD = d ? avg(d.runs.map((r) => r.cost_usd)) : 0;
  const rows: Row[] = [
    { label: "Tiempo por corrida", antes: fmtMs(tA), despues: d ? fmtMs(tD) : "" },
    { label: "Costo por corrida", antes: fmtUsd(costA), despues: d ? fmtUsd(costD) : "" },
    { label: "Trampas detectadas", antes: count(ta), despues: d ? count(td) : "" },
    ...ta.map((t, i) => ({ label: `· ${t.label}`, antes: mark(t.detected), despues: d ? mark(td[i]?.detected) : "", sub: true })),
    { label: "Confianza por decisión", antes: "no", despues: d ? "sí" : "" },
    { label: "Cambiaron de prioridad entre 2 corridas", antes: fmtCons(cA), despues: d ? fmtCons(cDs) : "" },
    { label: "· sin decidir (revisión humana o faltantes)", antes: cA ? String(cA.undecided) : "—", despues: d ? (cDs ? String(cDs.undecided) : "—") : "", sub: true },
    { label: "Respuesta usable sin parsear texto", antes: `${a.runs.filter((r) => r.parse_ok).length} / ${a.runs.length} JSON válidos`, despues: d ? "siempre (tipada)" : "" },
  ];
  const footer = d ? [`${delta(tA, tD, "tiempo")} y ${delta(costA, costD, "costo")} por corrida.`] : [];
  if (a.claude_engine === "cli") footer.push("Ojo: el antes corrió con claude -p e incluye el arranque y el contexto de Claude Code. Para una cuenta limpia usa ANTHROPIC_API_KEY.");
  return {
    title: "ACTO 1 · QUÉ HACER PRIMERO",
    antesTitle: `ANTES · ${a.engine}`,
    engineNote: a.claude_engine ? `Claude vía ${engineName(a.claude_engine)}; Jev vía API de TypeSafe.` : "",
    despuesTitle: "DESPUÉS · Jev",
    rows,
    footer,
    modes: [a.mode, d?.mode ?? "live"],
  };
}

function prsCard(): Card {
  const a = need<ReviewRun>(outPath("antes", "prs.json"), "Corre npm run antes:prs.");
  const d = soloAntes ? undefined : need<ReviewRun>(outPath("despues", "prs.json"), "Corre npm run route y npm run despues:prs.");
  const routing = d && existsSync(ROUTING_FILE()) ? readJson<RoutingResult>(ROUTING_FILE()) : undefined;
  const sum = (r: ReviewRun) => r.items.reduce((x, i) => x + i.cost_usd, 0);
  const highs = (r: ReviewRun) => r.items.reduce((x, i) => x + i.high_findings.length, 0);
  const mix = (r: ReviewRun) => {
    const order: Reviewer[] = ["lint_only", "haiku", "sonnet", "opus"];
    return order
      .map((k) => [k, r.items.filter((i) => i.reviewer === k).length] as const)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} ${reviewerLabel(k)}`)
      .join(" · ");
  };
  const costA = sum(a);
  const costD = d ? sum(d) + d.jev_cost_usd : 0;
  const timeA = a.wall_ms;
  const timeD = d ? d.wall_ms + d.jev_ms : 0;

  let preserved = "pendiente";
  const hFile = outPath("hallazgos.json");
  if (existsSync(hFile)) {
    const h = readJson<{ despues_generated_at?: string; prs: { alta_antes: { conservado: boolean | null }[] }[] }>(hFile);
    const all = h.prs.flatMap((p) => p.alta_antes);
    const marked = all.filter((e) => e.conservado !== null);
    if (all.length === 0) preserved = "0 / 0";
    else if (marked.length === all.length) preserved = `${all.filter((e) => e.conservado).length} / ${all.length}`;
    else preserved = `pendiente (${marked.length} de ${all.length} marcados)`;
    // Se marca a mano contra una corrida guardada; si el después se volvió a correr, se dice.
    if (d && h.despues_generated_at && h.despues_generated_at !== d.generated_at && !preserved.startsWith("pendiente")) preserved += " (corrida anterior)";
  }

  const rows: Row[] = [
    { label: "Revisores", antes: mix(a), despues: d ? mix(d) : "" },
    { label: "Costo total", antes: fmtUsd(costA), despues: d ? fmtUsd(costD) : "" },
    { label: "· de eso, decidir con Jev", antes: "—", despues: d ? fmtUsd(d.jev_cost_usd) : "", sub: true },
    { label: "Tiempo total" + (d?.wall_estimated ? " (estimado)" : ""), antes: fmtMs(timeA), despues: d ? fmtMs(timeD) : "" },
    { label: "· de eso, decidir con Jev", antes: "—", despues: d ? fmtMs(d.jev_ms) : "", sub: true },
    { label: "Hallazgos [ALTA] encontrados", antes: String(highs(a)), despues: d ? String(highs(d)) : "" },
    { label: "Hallazgos [ALTA] de Opus conservados", antes: "referencia", despues: d ? preserved : "" },
  ];
  const footer = d ? [`${delta(costA, costD, "costo")} y ${delta(timeA, timeD, "tiempo")}, con Jev incluido.`] : [];
  if (d && a.claude_engine !== d.claude_engine) footer.push(`OJO: el antes usó ${a.claude_engine} y el después ${d.claude_engine}; vuelve a correr uno para que coincidan.`);
  if (routing?.routes.some((r) => r.gray_zone)) footer.push(`${routing.routes.filter((r) => r.gray_zone).length} PR(s) en zona gris marcados para revisión humana.`);
  return {
    title: "ACTO 2 · QUIÉN LO HACE",
    antesTitle: `ANTES · todo con Opus`,
    engineNote: `Claude vía ${engineName(a.claude_engine)} en los dos lados; mismo prompt de revisión.`,
    despuesTitle: "DESPUÉS · ruteado por Jev",
    rows,
    footer,
    modes: [a.mode, d?.mode ?? "live"],
  };
}

function render(card: Card): void {
  const rows = soloAntes ? card.rows.filter((r) => !(r.sub && r.antes === "—")) : card.rows;
  const labelW = Math.max(...rows.map((r) => r.label.length + (r.sub ? 2 : 0)), card.title.length) + 2;
  const colW = Math.max(18, card.antesTitle.length, ...rows.map((r) => r.antes.length)) + 2;
  const colW2 = soloAntes ? 0 : Math.max(18, card.despuesTitle.length, ...rows.map((r) => r.despues.length)) + 2;
  const width = labelW + colW + colW2;
  const line = "─".repeat(width + 2);
  const cell = (s: string, w: number) => (s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w));
  if (card.modes.includes("mock")) console.log(yellow("SIMULADO (DEMO_MOCK=1): estos números no son reales, no se presentan."));
  else if (card.modes.includes("replay")) console.log(dim("Incluye respuestas reproducidas de la caché (--replay)."));
  console.log(`┌${line}┐`);
  console.log(`│ ${bold(cell(card.title, labelW))}${bold(cell(card.antesTitle, colW))}${soloAntes ? "" : bold(cell(card.despuesTitle, colW2))} │`);
  console.log(`├${line}┤`);
  for (const r of rows) {
    const label = r.sub ? dim(cell("  " + r.label, labelW)) : cell(r.label, labelW);
    console.log(`│ ${label}${cell(r.antes, colW)}${soloAntes ? "" : bold(cell(r.despues, colW2))} │`);
  }
  if (card.footer.length && !soloAntes) {
    console.log(`├${line}┤`);
    for (const f of card.footer) console.log(`│ ${bold(cell(f, width))} │`);
  }
  console.log(`└${line}┘`);
  if (card.engineNote) console.log(dim(card.engineNote));
  console.log("");
}

function main() {
  const what = positional()[0] ?? "all";
  if (what === "backlog" || what === "all") render(backlogCard());
  if (what === "prs" || what === "all") render(prsCard());
  if (!["backlog", "prs", "all"].includes(what)) throw new Error("Uso: npm run compare -- backlog|prs|all [--solo-antes]");
}

try {
  main();
} catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
}
