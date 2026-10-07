import { createHash } from "node:crypto";
import { cached } from "./cache.ts";
import { now, simulateLatency } from "./clock.ts";
import { MOCK } from "./env.ts";
import { MODELS, estimateTokens, jevCost } from "./pricing.ts";

// Forma documentada en https://docs.typesafe.ai/api

export type NoulQuestion = { type: "noul"; instructions: unknown; criteria?: { true?: unknown; false?: unknown } };
export type ChoiceQuestion = { type: "choice"; instructions: unknown; criteria: Record<string, unknown> };
export type ScoreQuestion = { type: "score"; instructions: unknown; criteria: unknown[] };
export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
export type Questions = Record<string, Question>;

export type NoulAnswer = { type: "noul"; noul: number };
export type ChoiceAnswer = { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number };
export type ScoreAnswer = { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };
export type Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer;

export type JevResult = {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
  ms: number;
  cost_usd: number;
  replayed: boolean;
};

const BASE_URL = process.env.TYPESAFE_BASE_URL ?? "https://api.typesafe.ai/v1/systemone";
const MODEL = process.env.TYPESAFE_MODEL ?? MODELS.jev.model;

/** `tag` separa en caché corridas repetidas con la misma entrada (corrida 1, corrida 2…). */
export async function askJev(state: unknown, questions: Questions, tag = ""): Promise<JevResult> {
  const body = { state, model: MODEL, questions };
  return cached("jev", { body, tag }, async () => {
    const t0 = now();
    const raw = MOCK ? await mockJev(state, questions) : await callJev(body);
    const ms = now() - t0;
    return {
      model: raw.model,
      answers: raw.answers,
      usage: raw.usage,
      ms,
      cost_usd: jevCost(raw.usage.input_tokens, raw.usage.output_tokens),
    };
  });
}

type RawResponse = { model: string; answers: Record<string, Answer>; usage: { input_tokens: number; output_tokens: number } };

async function callJev(body: unknown): Promise<RawResponse> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("Falta TYPESAFE_API_KEY en .env (o usa DEMO_MOCK=1 para una prueba simulada).");
  let lastError = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as RawResponse;
    const text = await res.text();
    lastError = `Jev respondió ${res.status}: ${text.slice(0, 500)}`;
    if (res.status !== 429 && res.status !== 529 && res.status < 500) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt));
  }
  throw new Error(lastError);
}

// ---------- Simulación (DEMO_MOCK=1) ----------

function unit(seed: string): number {
  return parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16) / 0xffffffff;
}

async function mockJev(state: unknown, questions: Questions): Promise<RawResponse> {
  const text = JSON.stringify(state);
  await simulateLatency(300 + unit(text) * 300);
  const answers: Record<string, Answer> = {};
  for (const [id, q] of Object.entries(questions)) {
    const seed = id + text;
    if (q.type === "noul") {
      answers[id] = { type: "noul", noul: Number(unit(seed).toFixed(2)) };
    } else if (q.type === "choice") {
      const options = Object.keys(q.criteria);
      const weights = options.map((o) => unit(seed + o) ** 3);
      const total = weights.reduce((a, b) => a + b, 0);
      const probabilities = Object.fromEntries(options.map((o, i) => [o, Number((weights[i] / total).toFixed(2))]));
      const choice = options[weights.indexOf(Math.max(...weights))];
      answers[id] = { type: "choice", choice, probabilities, confidence: Number(Math.max(...Object.values(probabilities)).toFixed(2)) };
    } else {
      const levels = q.criteria.length;
      const top = Math.floor(unit(seed) * levels);
      const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === top ? 0.8 : Number((0.2 / (levels - 1)).toFixed(3))]));
      const legend = Object.fromEntries(q.criteria.map((c, i) => [String(i), String(c)]));
      answers[id] = { type: "score", score: top, legend, probabilities, confidence: 0.75 };
    }
  }
  return {
    model: "jev-mock",
    answers,
    usage: { input_tokens: estimateTokens(text + JSON.stringify(questions)), output_tokens: 20 * Object.keys(questions).length },
  };
}

// ---------- Ayudantes para leer respuestas ----------

export function noul(r: JevResult, id: string): number {
  const a = r.answers[id];
  if (!a || a.type !== "noul") throw new Error(`Falta la respuesta noul '${id}'`);
  return a.noul;
}

export function choice(r: JevResult, id: string): ChoiceAnswer {
  const a = r.answers[id];
  if (!a || a.type !== "choice") throw new Error(`Falta la respuesta choice '${id}'`);
  return a;
}

export function score(r: JevResult, id: string): ScoreAnswer {
  const a = r.answers[id];
  if (!a || a.type !== "score") throw new Error(`Falta la respuesta score '${id}'`);
  return a;
}
