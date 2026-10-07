import { readJson, rootPath } from "./env.ts";

export type ClaudeAlias = "haiku" | "sonnet" | "opus";

type ModelPrice = { id: string; label: string; input_per_mtok: number; output_per_mtok: number };
type Models = {
  claude: Record<ClaudeAlias, ModelPrice>;
  jev: { model: string; input_per_mtok: number; output_per_mtok: number };
};

export const MODELS = readJson<Models>(rootPath("config", "models.json"));

export function claudeModel(alias: ClaudeAlias): ModelPrice {
  const m = MODELS.claude[alias];
  if (!m) throw new Error(`Modelo desconocido: ${alias}. Usa haiku, sonnet u opus.`);
  return m;
}

export function isClaudeAlias(x: string): x is ClaudeAlias {
  return x === "haiku" || x === "sonnet" || x === "opus";
}

export function claudeCost(alias: ClaudeAlias, inputTokens: number, outputTokens: number): number {
  const m = claudeModel(alias);
  return (inputTokens * m.input_per_mtok + outputTokens * m.output_per_mtok) / 1e6;
}

export function jevCost(inputTokens: number, outputTokens = 0): number {
  return (inputTokens * MODELS.jev.input_per_mtok + outputTokens * MODELS.jev.output_per_mtok) / 1e6;
}

/** Estimación gruesa para el modo simulado: ~4 caracteres por token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
