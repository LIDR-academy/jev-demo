// DESPUÉS del Acto 1: Jev prioriza el backlog con preguntas tipadas y (con --write) escribe el resultado en Jira.
//
//   npm run priorizar                       lee el backlog de Jira, 2 corridas, solo muestra
//   npm run priorizar -- --write            además escribe prioridad, etiquetas y comentario en Jira
//   npm run priorizar -- --input data/backlog-seed.json   sin Jira
//   npm run priorizar -- --giro             usa el objetivo alternativo de config/sprint.json
//   npm run priorizar -- --goal "..."       cualquier otro objetivo del sprint
//   npm run priorizar -- --input out/backlog-snapshot.json --replay   reproduce lo guardado en out/cache

import { existsSync } from "node:fs";
import { type BacklogResult, type Decision, PRIORITIES, checkTraps, consistency, loadIssues, printDecisions, priorityRank } from "./lib/backlog.ts";
import { fmtMs, fmtUsd, mapPool, now } from "./lib/clock.ts";
import { MOCK, REPLAY, arg, flag, modeBanner, outPath, readJson, rootPath, writeJson } from "./lib/env.ts";
import { type JevResult, type Questions, askJev, choice, noul, score } from "./lib/jev.ts";
import { type Issue, JEV_COMMENT_MARK, JIRA, addComment, hasJiraCreds, updateIssue } from "./lib/jira.ts";

const T = readJson<{ backlog: Record<string, number> }>(rootPath("config", "thresholds.json")).backlog;
const SPRINT = readJson<{ objetivo: string; _objetivo_para_el_giro: string }>(rootPath("config", "sprint.json"));
const TEMPLATE = readJson<{ questions: Questions }>(rootPath("questions", "backlog.json")).questions;

const goal = arg("goal") ?? (flag("giro") ? SPRINT._objetivo_para_el_giro : SPRINT.objetivo);
const runs = Math.max(1, Number(arg("runs") ?? 2));
const write = flag("write");

function stateFor(issue: Issue, others: Issue[]) {
  return {
    sprint_goal: goal,
    issue: { key: issue.key, type: issue.issuetype, reporter_priority: issue.priority, summary: issue.summary, description: issue.description },
    other_issues: others.map((o) => ({ key: o.key, summary: o.summary })),
  };
}

function questionsFor(others: Issue[]): Questions {
  const q = structuredClone(TEMPLATE);
  const dup = q.duplicate_of;
  if (dup.type !== "choice") throw new Error("duplicate_of debe ser choice");
  dup.criteria = { none: "No issue in `other_issues` describes the same problem.", ...Object.fromEntries(others.map((o) => [o.key, o.summary])) };
  return q;
}

function decide(issue: Issue, r: JevResult): Decision {
  const rules: string[] = [];
  const p = choice(r, "priority");
  const revenue = noul(r, "blocks_revenue");
  const ready = noul(r, "ready_for_dev");
  const isDup = noul(r, "is_duplicate");
  const dupOf = choice(r, "duplicate_of").choice;
  const duplicate_of = isDup >= T.duplicado && dupOf !== "none" ? dupOf : null;

  // 1. Si Jev no está seguro o al ticket le falta detalle, no se cambia la prioridad: decide una persona.
  const needs_review = p.confidence < T.confianza_minima_prioridad || ready < T.listo_para_desarrollo_minimo;
  let priority = needs_review ? issue.priority : p.choice;
  if (needs_review) {
    rules.push(
      p.confidence < T.confianza_minima_prioridad
        ? `confianza baja en la prioridad (${p.confidence.toFixed(2)} < ${T.confianza_minima_prioridad}) → revisión humana`
        : `poco detalle para desarrollar (${ready.toFixed(2)} < ${T.listo_para_desarrollo_minimo}) → revisión humana`,
    );
  }
  // 2. Regla de piso: lo que bloquea ingresos nunca queda por debajo de High, aunque vaya a revisión humana.
  let floored = false;
  if (revenue >= T.piso_bloquea_ingresos && priorityRank(priority) > priorityRank("High")) {
    priority = "High";
    floored = true;
    rules.push(`piso: bloquea ingresos (${revenue.toFixed(2)} ≥ ${T.piso_bloquea_ingresos}) → al menos High`);
  }
  return {
    key: issue.key,
    summary: issue.summary,
    priority_before: issue.priority,
    priority,
    issue_type: choice(r, "issue_type").choice,
    business_impact: score(r, "business_impact").score,
    blocks_revenue: revenue,
    ready_for_dev: ready,
    is_duplicate: isDup,
    duplicate_of,
    needs_review,
    decided: !needs_review || floored,
    confidence: p.confidence,
    rules,
  };
}

function labelsFor(d: Decision): string[] {
  return [
    "jev-priorizado",
    ...(d.blocks_revenue !== null && d.blocks_revenue >= T.piso_bloquea_ingresos ? ["jev-bloquea-ingresos"] : []),
    ...(d.duplicate_of ? ["jev-duplicado"] : []),
    ...(d.needs_review ? ["needs-human-review"] : []),
  ];
}

function commentFor(d: Decision, model: string): string {
  const lines = [
    `${JEV_COMMENT_MARK} ${
      !d.needs_review
        ? `Prioridad sugerida: ${d.priority} (confianza ${d.confidence?.toFixed(2)})`
        : d.priority === d.priority_before
          ? "Requiere revisión humana: no se cambió la prioridad."
          : `Requiere revisión humana. Se subió a ${d.priority} por la regla de ingresos.`
    }`,
    "",
    `Bloquea ingresos: ${d.blocks_revenue?.toFixed(2)}`,
    `Listo para desarrollo: ${d.ready_for_dev?.toFixed(2)}`,
    `Impacto en negocio: ${d.business_impact?.toFixed(1)} de 4`,
    `Duplicado de: ${d.duplicate_of ?? "ninguno"} (${d.is_duplicate?.toFixed(2)})`,
    ...d.rules.map((r) => `Regla: ${r}`),
    "",
    `Objetivo del sprint: ${goal}`,
    `Modelo: ${model}`,
  ];
  return lines.join("\n");
}

async function main() {
  const banner = modeBanner();
  if (banner) console.log(banner);
  const { issues, source } = await loadIssues(arg("input"));
  console.log(`Backlog: ${issues.length} issues desde ${source}`);
  console.log(`Objetivo del sprint: ${goal}\n`);

  const result: BacklogResult = {
    side: "despues",
    engine: "Jev",
    goal,
    source,
    generated_at: new Date().toISOString(),
    mode: MOCK ? "mock" : REPLAY ? "replay" : "live",
    runs: [],
  };
  let model = "";
  let questionsPerIssue = 0;

  for (let run = 1; run <= runs; run++) {
    const t0 = now();
    const responses = await mapPool(issues, T.concurrencia, (issue) => {
      const others = issues.filter((o) => o.key !== issue.key);
      const qs = questionsFor(others);
      questionsPerIssue = Object.keys(qs).length;
      return askJev(stateFor(issue, others), qs, `backlog-run${run}`);
    });
    const replayed = responses.some((r) => r.replayed);
    const wall = replayed ? responses.reduce((a, r) => a + r.ms, 0) / Math.min(T.concurrencia, responses.length) : now() - t0;
    model = responses[0]?.model ?? "";
    result.runs.push({
      wall_ms: wall,
      cost_usd: responses.reduce((a, r) => a + r.cost_usd, 0),
      input_tokens: responses.reduce((a, r) => a + r.usage.input_tokens, 0),
      output_tokens: responses.reduce((a, r) => a + r.usage.output_tokens, 0),
      parse_ok: true,
      decisions: issues.map((issue, i) => decide(issue, responses[i])),
    });
    const r = result.runs.at(-1)!;
    console.log(`Corrida ${run}: ${issues.length} issues · ${issues.length * questionsPerIssue} preguntas · ${fmtMs(r.wall_ms)} · ${fmtUsd(r.cost_usd)}`);
  }

  // El giro (otro objetivo del sprint) se guarda aparte: la tarjeta compara contra el mismo objetivo que usó el antes.
  const antesFile = outPath("antes", "backlog.json");
  const isGiro = existsSync(antesFile) && readJson<BacklogResult>(antesFile).goal !== goal;
  writeJson(outPath("despues", isGiro ? "backlog-giro.json" : "backlog.json"), result);
  if (isGiro) console.log("(Objetivo distinto al del antes: guardado como el giro, la tarjeta del Acto 1 no cambia.)");
  const decisions = result.runs[0].decisions;
  writeJson(
    outPath("despues", "backlog-decisions.json"),
    decisions.map((d) => ({ ...d, labels: labelsFor(d), comment: commentFor(d, model) })),
  );

  console.log("");
  printDecisions(decisions);
  console.log("\nTrampas:");
  for (const t of checkTraps(decisions)) console.log(`  ${t.detected === null ? "?" : t.detected ? "✔" : "✘"} ${t.label}`);
  if (result.runs.length > 1) {
    const c = consistency(result.runs[0].decisions, result.runs[1].decisions);
    console.log(`Consistencia: ${c.changed} de ${c.total} decididos cambiaron de prioridad entre corridas · ${c.undecided} sin decidir (revisión humana)`);
  }

  if (write) {
    if (!hasJiraCreds() || MOCK || REPLAY) {
      console.log("\nNo escribo en Jira (sin credenciales REST, o en modo simulado/replay). Las decisiones quedaron en out/despues/backlog-decisions.json.");
    } else {
      const t0 = now();
      const managed = new Set(JIRA.labels_jev);
      await mapPool(decisions, 5, async (d) => {
        const labels = labelsFor(d);
        await updateIssue(d.key, {
          priority: d.priority !== d.priority_before && PRIORITIES.includes(d.priority as never) ? d.priority : undefined,
          addLabels: labels,
          removeLabels: [...managed].filter((l) => !labels.includes(l)),
        });
        await addComment(d.key, commentFor(d, model));
      });
      console.log(`\nJira actualizado: ${decisions.length} issues en ${fmtMs(now() - t0)}`);
    }
  }
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
