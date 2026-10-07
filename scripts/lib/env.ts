import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");

const envFile = path.join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

/** DEMO_MOCK=1: respuestas simuladas de Jev y Claude. Sirve para probar la tubería sin gastar. Nunca para presentar números. */
export const MOCK = process.env.DEMO_MOCK === "1";
/** --replay o DEMO_REPLAY=1: reproduce las respuestas guardadas en out/cache sin llamar a ninguna API. */
export const REPLAY = process.env.DEMO_REPLAY === "1" || process.argv.includes("--replay");
/** Carpeta de resultados. */
export const OUT = path.resolve(ROOT, process.env.DEMO_OUT ?? "out");

export function rootPath(...parts: string[]): string {
  return path.join(ROOT, ...parts);
}

export function outPath(...parts: string[]): string {
  return path.join(OUT, ...parts);
}

export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
}

export function writeText(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Lee un flag tipo --nombre valor o --nombre=valor. */
export function arg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === `--${name}`) return argv[i + 1];
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return undefined;
}

export function flag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

/** Argumentos posicionales (lo que no empieza con --, ni es el valor de un --flag). */
export function positional(): string[] {
  const argv = process.argv.slice(2);
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      if (!a.includes("=") && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--") && VALUE_FLAGS.has(a.slice(2))) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}
const VALUE_FLAGS = new Set(["input", "runs", "model", "goal", "only", "concurrency"]);

export function modeBanner(): string {
  if (MOCK) return "[SIMULADO: DEMO_MOCK=1, no presentar estos números]";
  if (REPLAY) return "[REPLAY: respuestas guardadas en out/cache]";
  return "";
}
