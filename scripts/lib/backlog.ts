import { existsSync } from "node:fs";
import { REPLAY, outPath, readJson, rootPath, writeJson } from "./env.ts";
import { type Issue, JIRA, hasJiraCreds, searchIssues } from "./jira.ts";

export const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"] as const;
export type Priority = (typeof PRIORITIES)[number];

export function priorityRank(p: string): number {
  const i = PRIORITIES.indexOf(p as Priority);
  return i < 0 ? 2 : i;
}

export type SeedIssue = {
  ref: string;
  trampa?: "cupon" | "duplicado" | "vago";
  duplicado_de?: string;
  issuetype: string;
  priority: string;
  summary: string;
  description: string;
};

export function loadSeed(): SeedIssue[] {
  return readJson<{ issues: SeedIssue[] }>(rootPath("data", "backlog-seed.json")).issues;
}

/** La entrada congelada: la usan el antes, el después y --replay. */
export const SNAPSHOT = () => outPath("backlog-snapshot.json");
/** Lo que se leyó de Jira en la última corrida. */
export const LIVE_SNAPSHOT = () => outPath("backlog-live.json");

/**
 * De dónde salen los issues:
 * 1. --input <archivo>: un snapshot exportado o el propio data/backlog-seed.json (para probar sin Jira).
 * 2. Jira por API REST si hay credenciales. Se guarda en out/backlog-live.json, sin tocar el snapshot.
 * Nunca cae en silencio a un snapshot viejo: sin --input ni credenciales, falla con instrucciones.
 */
export async function loadIssues(input?: string): Promise<{ issues: Issue[]; source: string }> {
  if (input) {
    const data = readJson<{ issues: (Issue | SeedIssue)[] } | Issue[]>(input);
    const list = Array.isArray(data) ? data : data.issues;
    const issues = list.map((i) =>
      "ref" in i ? { key: `${JIRA.project}-${i.ref}`, summary: i.summary, description: i.description, issuetype: i.issuetype, priority: i.priority, labels: [JIRA.label_demo] } : i,
    );
    return { issues, source: input };
  }
  if (hasJiraCreds() && !REPLAY) {
    const issues = await searchIssues(JIRA.jql_backlog);
    writeJson(LIVE_SNAPSHOT(), { exported_at: new Date().toISOString(), jql: JIRA.jql_backlog, issues });
    return { issues, source: `Jira (${issues.length} issues)` };
  }
  throw new Error(
    REPLAY
      ? "Con --replay hay que indicar la entrada guardada: --input out/backlog-snapshot.json"
      : "No hay de dónde leer el backlog. Opciones: llena JIRA_* en .env, exporta con /exportar-backlog y pasa --input out/backlog-live.json, o usa --input data/backlog-seed.json para un ensayo sin Jira.",
  );
}

export type Decision = {
  key: string;
  summary: string;
  priority_before: string;
  priority: string;
  issue_type: string;
  business_impact: number | null;
  blocks_revenue: number | null;
  ready_for_dev: number | null;
  is_duplicate: number | null;
  duplicate_of: string | null;
  needs_review: boolean;
  /** true si el modelo de verdad decidió una prioridad (no se quedó en revisión humana ni faltó en la respuesta). */
  decided: boolean;
  confidence: number | null;
  rules: string[];
  reason?: string;
};

export type BacklogRun = {
  wall_ms: number;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  parse_ok: boolean;
  decisions: Decision[];
};

export type BacklogResult = {
  side: "antes" | "despues";
  engine: string;
  goal: string;
  source: string;
  generated_at: string;
  mode: "live" | "mock" | "replay";
  claude_engine?: string;
  runs: BacklogRun[];
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

export function findBySeed(decisions: Decision[], seed: SeedIssue): Decision | undefined {
  return decisions.find((d) => norm(d.summary) === norm(seed.summary));
}

export type TrapCheck = { id: "cupon" | "duplicado" | "vago"; label: string; detected: boolean | null };

export function checkTraps(decisions: Decision[]): TrapCheck[] {
  const seed = loadSeed();
  const bySeed = (ref: string) => {
    const s = seed.find((x) => x.ref === ref);
    return s ? findBySeed(decisions, s) : undefined;
  };
  const cupon = bySeed(seed.find((s) => s.trampa === "cupon")!.ref);
  const dupSeed = seed.find((s) => s.trampa === "duplicado")!;
  const dup = bySeed(dupSeed.ref);
  const original = bySeed(dupSeed.duplicado_de!);
  const vago = bySeed(seed.find((s) => s.trampa === "vago")!.ref);
  return [
    { id: "cupon", label: "Bug de cupón a MSI subido a High o más", detected: cupon ? priorityRank(cupon.priority) <= 1 : null },
    {
      id: "duplicado",
      label: "Duplicado del carrito marcado",
      detected: dup && original ? dup.duplicate_of === original.key || original.duplicate_of === dup.key : null,
    },
    { id: "vago", label: "Ticket vago enviado a revisión humana", detected: vago ? vago.needs_review : null },
  ];
}

/**
 * Entre dos corridas con la misma entrada, sobre los tickets sembrados:
 * cuántos decididos en ambas cambiaron de prioridad, y cuántos no se decidieron en alguna (revisión humana o faltantes).
 * Un ticket que se queda sin decidir no cuenta como "consistente".
 */
export function consistency(a: Decision[], b: Decision[]): { changed: number; total: number; undecided: number } {
  let changed = 0;
  let total = 0;
  let undecided = 0;
  for (const s of loadSeed()) {
    const x = findBySeed(a, s);
    const y = findBySeed(b, s);
    if (!x?.decided || !y?.decided) {
      undecided++;
      continue;
    }
    total++;
    if (x.priority !== y.priority) changed++;
  }
  return { changed, total, undecided };
}

export function printDecisions(decisions: Decision[]): void {
  const rows = [...decisions].sort((x, y) => priorityRank(x.priority) - priorityRank(y.priority) || x.key.localeCompare(y.key, undefined, { numeric: true }));
  const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
  console.log(`${pad("Issue", 10)} ${pad("Prioridad", 16)} ${pad("Conf.", 6)} ${pad("Señales", 30)} Resumen`);
  for (const d of rows) {
    const arrow = d.priority !== d.priority_before ? `${d.priority_before}→${d.priority}` : d.priority;
    const flags = [
      d.blocks_revenue !== null && d.blocks_revenue >= 0.5 ? `ingresos ${d.blocks_revenue.toFixed(2)}` : "",
      d.duplicate_of ? `dup de ${d.duplicate_of}` : "",
      d.needs_review ? "revisión humana" : "",
    ].filter(Boolean).join(" · ");
    const conf = d.confidence === null ? "—" : d.confidence.toFixed(2);
    console.log(`${pad(d.key, 10)} ${pad(arrow, 16)} ${pad(conf, 6)} ${pad(flags, 30)} ${d.summary}`);
  }
}
