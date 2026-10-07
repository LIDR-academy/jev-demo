import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cached } from "./cache.ts";
import { now, simulateLatency } from "./clock.ts";
import { MOCK } from "./env.ts";
import { type ClaudeAlias, claudeCost, claudeModel, estimateTokens } from "./pricing.ts";

export type ClaudeEngine = "api" | "cli";

/**
 * Dos formas de llamar a Claude, la misma para el antes y el después:
 * - "api": API de Anthropic directa (ANTHROPIC_API_KEY). Números más limpios: solo los tokens del prompt.
 * - "cli": claude -p (Claude Code headless). Usa tu sesión de Claude Code; suma ~10k tokens del arnés
 *   que se cachean después de la primera llamada.
 * Por defecto "api" si hay ANTHROPIC_API_KEY, si no "cli". Se fuerza con CLAUDE_ENGINE.
 */
export const ENGINE: ClaudeEngine =
  process.env.CLAUDE_ENGINE === "cli" || process.env.CLAUDE_ENGINE === "api"
    ? process.env.CLAUDE_ENGINE
    : process.env.ANTHROPIC_API_KEY
      ? "api"
      : "cli";

export type ClaudeResult = {
  model: ClaudeAlias;
  model_id: string;
  engine: ClaudeEngine;
  text: string;
  cost_usd: number;
  duration_ms: number;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
  replayed: boolean;
};

/**
 * Corre Claude en modo headless (claude -p) con el mismo arnés para el antes y el después:
 * sin herramientas, sin MCP, con nuestro system prompt y desde una carpeta temporal
 * para que no cargue el CLAUDE.md de este repo. Así lo único que cambia entre corridas es el modelo.
 */
export async function runClaude(opts: {
  model: ClaudeAlias;
  system: string;
  prompt: string;
  mock: () => string;
  /** Separa en caché corridas repetidas con la misma entrada. */
  tag?: string;
}): Promise<ClaudeResult> {
  const m = claudeModel(opts.model);
  const engine: ClaudeEngine = MOCK ? "api" : ENGINE;
  const key = { model: m.id, engine, system: opts.system, prompt: opts.prompt, tag: opts.tag ?? "" };
  return cached("claude", key, async () => {
    const t0 = now();
    const out = MOCK ? await mockClaude(opts) : engine === "api" ? await callApi(m.id, opts.system, opts.prompt) : await spawnClaude(m.id, opts.system, opts.prompt);
    const duration_ms = now() - t0;
    const usage = {
      input_tokens: out.usage?.input_tokens ?? 0,
      output_tokens: out.usage?.output_tokens ?? 0,
      cache_read_input_tokens: out.usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: out.usage?.cache_creation_input_tokens ?? 0,
    };
    const cost_usd =
      typeof out.total_cost_usd === "number"
        ? out.total_cost_usd
        : claudeCost(opts.model, usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens, usage.output_tokens);
    return { model: opts.model, model_id: m.id, engine, text: out.result ?? "", cost_usd, duration_ms, usage };
  });
}

type HeadlessOutput = {
  result?: string;
  is_error?: boolean;
  total_cost_usd?: number;
  usage?: Partial<ClaudeResult["usage"]>;
};

async function callApi(modelId: string, system: string, prompt: string): Promise<HeadlessOutput> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("CLAUDE_ENGINE=api necesita ANTHROPIC_API_KEY en .env");
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: modelId, max_tokens: 8000, system, messages: [{ role: "user", content: prompt }] }),
    });
    if (res.ok) {
      const data = (await res.json()) as { content: { type: string; text?: string }[]; usage: HeadlessOutput["usage"] };
      // Sin total_cost_usd: el costo se calcula con config/models.json.
      return { result: data.content.filter((c) => c.type === "text").map((c) => c.text).join(""), usage: data.usage };
    }
    const text = await res.text();
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new Error(`API de Anthropic respondió ${res.status}: ${text.slice(0, 400)}`);
  }
}

let sandbox: string | undefined;

function spawnClaude(modelId: string, system: string, prompt: string): Promise<HeadlessOutput> {
  sandbox ??= mkdtempSync(path.join(tmpdir(), "jev-demo-"));
  const args = [
    "-p",
    "--model", modelId,
    "--output-format", "json",
    "--system-prompt", system,
    "--tools", "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ];
  return new Promise((resolve, reject) => {
    const child = spawn("claude", args, { cwd: sandbox, env: process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 10 * 60_000);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => reject(new Error(`No se pudo ejecutar 'claude': ${e.message}. ¿Está instalado Claude Code?`)));
    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout) as HeadlessOutput;
        if (code !== 0 || parsed.is_error) return reject(new Error(`claude -p falló (${code}): ${parsed.result ?? stderr.slice(-500)}`));
        resolve(parsed);
      } catch {
        reject(new Error(`claude -p devolvió algo que no es JSON (código ${code}): ${(stderr || stdout).slice(-500)}`));
      }
    });
    child.stdin.end(prompt);
  });
}

const MOCK_MS_PER_OUTPUT_TOKEN: Record<ClaudeAlias, number> = { haiku: 6, sonnet: 14, opus: 25 };

async function mockClaude(opts: { model: ClaudeAlias; system: string; prompt: string; mock: () => string }): Promise<HeadlessOutput> {
  const result = opts.mock();
  const input_tokens = estimateTokens(opts.system + opts.prompt);
  const output_tokens = estimateTokens(result);
  await simulateLatency(1500 + output_tokens * MOCK_MS_PER_OUTPUT_TOKEN[opts.model]);
  return { result, total_cost_usd: claudeCost(opts.model, input_tokens, output_tokens), usage: { input_tokens, output_tokens } };
}

/** Extrae el primer bloque JSON de una respuesta de texto (con o sin ```json). */
export function extractJson<T>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf("}"), candidate.lastIndexOf("]"));
  if (start < 0 || end < start) return { ok: false, error: "no hay JSON en la respuesta" };
  try {
    return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) as T };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
