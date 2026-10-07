import { readFileSync } from "node:fs";
import { runClaude } from "./claude.ts";
import { fmtMs, fmtUsd, mapPool, now } from "./clock.ts";
import { outPath, readJson, rootPath, writeText } from "./env.ts";
import { type ClaudeAlias, MODELS } from "./pricing.ts";

export type PR = {
  number: number;
  url: string;
  title: string;
  body: string;
  labels: string[];
  additions: number;
  deletions: number;
  files: { path: string; additions: number; deletions: number }[];
  diff: string;
};

export function loadPrs(only?: string): PR[] {
  const prs = readJson<{ prs: PR[] }>(rootPath("data", "prs.json")).prs;
  if (!only) return prs;
  const wanted = new Set(only.split(",").map((n) => Number(n.trim())));
  return prs.filter((p) => wanted.has(p.number));
}

export const REVIEW_SYSTEM = () => readFileSync(rootPath("prompts", "review.md"), "utf8");

const MAX_DIFF_CHARS = 80_000;

/** El mismo prompt de revisión para el antes y el después. */
export function reviewPrompt(pr: PR): string {
  const diff = pr.diff.length > MAX_DIFF_CHARS ? pr.diff.slice(0, MAX_DIFF_CHARS) + "\n\n[diff truncado]" : pr.diff;
  return [
    `# PR #${pr.number}: ${pr.title}`,
    pr.body ? `\n## Descripción\n${pr.body}` : "",
    `\n## Archivos (+${pr.additions} / −${pr.deletions})`,
    ...pr.files.map((f) => `- ${f.path} (+${f.additions} / −${f.deletions})`),
    `\n## Diff\n\`\`\`diff\n${diff}\n\`\`\``,
  ].join("\n");
}

/** Lo que ve Jev para decidir: metadatos, nunca el diff. */
export function routingState(pr: PR) {
  return {
    title: pr.title,
    description: pr.body.slice(0, 1500),
    labels: pr.labels,
    lines_added: pr.additions,
    lines_deleted: pr.deletions,
    files: pr.files.map((f) => ({ path: f.path, added: f.additions, deleted: f.deletions })),
  };
}

/** Viñeta (-, *, 1.) opcionalmente en negritas, seguida de [ALTA]. */
const HIGH_RE = /^\s*(?:[-*]|\d+\.)\s*(?:\*\*)?\s*\[ALTA\]/i;

export function highFindings(review: string): string[] {
  return review
    .split("\n")
    .filter((l) => HIGH_RE.test(l))
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s*/, "").replace(/\*\*/g, "").trim());
}

export function mockReview(pr: PR, model: ClaudeAlias): string {
  const sensitive = /payment|stripe|auth|migration|currency|capture/i.test(pr.title + pr.files.map((f) => f.path).join(" "));
  const findings =
    sensitive && model !== "haiku"
      ? `- [ALTA] \`${pr.files[0]?.path}:1\` — hallazgo simulado en código sensible\n- [MEDIA] \`${pr.files[0]?.path}:1\` — falta un test del caso borde`
      : "- Ninguno";
  return `## Veredicto\n${sensitive ? "CAMBIOS REQUERIDOS" : "APROBAR"}\n\n## Hallazgos\n${findings}\n\n## Resumen\nRevisión simulada de ${model} para #${pr.number}.`;
}

export type Reviewer = "lint_only" | ClaudeAlias;

export type ReviewItem = {
  number: number;
  title: string;
  reviewer: Reviewer;
  cost_usd: number;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  high_findings: string[];
  review_file: string | null;
};

export type ReviewRun = {
  side: "antes" | "despues";
  generated_at: string;
  mode: "live" | "mock" | "replay";
  wall_ms: number;
  wall_estimated?: boolean;
  claude_engine: string;
  jev_cost_usd: number;
  jev_ms: number;
  items: ReviewItem[];
};

export type Routing = {
  number: number;
  title: string;
  jev_choice: Reviewer;
  reviewer: Reviewer;
  confidence: number;
  probabilities: Record<string, number>;
  risk: number;
  sensitive: number;
  cross_module: number;
  gray_zone: boolean;
  rules: string[];
};

export type RoutingResult = {
  generated_at: string;
  mode: "live" | "mock" | "replay";
  model: string;
  wall_ms: number;
  cost_usd: number;
  input_tokens: number;
  routes: Routing[];
};

export const ROUTING_FILE = () => outPath("despues", "routing.json");

export function reviewerLabel(r: Reviewer): string {
  return r === "lint_only" ? "solo lint" : MODELS.claude[r].label;
}

// ---------- Corredor de revisiones (mismo para el antes y el después) ----------

export async function runReviews(
  side: "antes" | "despues",
  plan: { pr: PR; reviewer: Reviewer }[],
  concurrency: number,
): Promise<{ items: ReviewItem[]; wall_ms: number }> {
  const t0 = now();
  let anyReplayed = false;
  const items = await mapPool(plan, concurrency, async ({ pr, reviewer }) => {
    if (reviewer === "lint_only") {
      const text = `## Veredicto\nAPROBAR\n\n## Hallazgos\n- Ninguno\n\n## Resumen\nJev lo mandó a solo lint: sin revisión de LLM.`;
      const file = outPath(side, "reviews", `${pr.number}.md`);
      writeText(file, text);
      return { number: pr.number, title: pr.title, reviewer, cost_usd: 0, duration_ms: 0, input_tokens: 0, output_tokens: 0, high_findings: [], review_file: file } satisfies ReviewItem;
    }
    const r = await runClaude({ model: reviewer, system: REVIEW_SYSTEM(), prompt: reviewPrompt(pr), mock: () => mockReview(pr, reviewer) });
    anyReplayed ||= r.replayed;
    const file = outPath(side, "reviews", `${pr.number}.md`);
    writeText(file, `<!-- ${r.model_id} · ${fmtMs(r.duration_ms)} · ${fmtUsd(r.cost_usd)} -->\n${r.text}\n`);
    console.log(`  #${pr.number} ${reviewerLabel(reviewer).padEnd(10)} ${fmtMs(r.duration_ms).padStart(9)}  ${fmtUsd(r.cost_usd).padStart(9)}  ${pr.title.slice(0, 60)}`);
    return {
      number: pr.number,
      title: pr.title,
      reviewer,
      cost_usd: r.cost_usd,
      duration_ms: r.duration_ms,
      input_tokens: r.usage.input_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens,
      output_tokens: r.usage.output_tokens,
      high_findings: highFindings(r.text),
      review_file: file,
    } satisfies ReviewItem;
  });
  // En replay no hubo espera real: se estima el tiempo de pared con la duración guardada de cada revisión.
  const wall_ms = anyReplayed ? estimateWall(items.map((i) => i.duration_ms), concurrency) : now() - t0;
  return { items, wall_ms };
}

/** Tiempo de pared estimado si las revisiones corren en `concurrency` carriles. */
export function estimateWall(durations: number[], concurrency: number): number {
  const lanes = new Array(Math.max(1, concurrency)).fill(0);
  for (const d of durations) {
    const i = lanes.indexOf(Math.min(...lanes));
    lanes[i] += d;
  }
  return Math.max(...lanes);
}
