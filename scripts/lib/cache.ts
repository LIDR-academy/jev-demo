import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { MOCK, REPLAY, outPath, readJson, writeJson } from "./env.ts";

export type Cached<T> = T & { replayed: boolean };

/**
 * Toda llamada a Jev o a Claude pasa por aquí. Sin --replay llama de verdad y guarda la respuesta.
 * Con --replay devuelve la respuesta guardada, con su tiempo original, sin tocar la red.
 */
export async function cached<T extends object>(kind: "jev" | "claude", key: unknown, fn: () => Promise<T>): Promise<Cached<T>> {
  const hash = createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 24);
  const file = outPath("cache", MOCK ? `${kind}-mock` : kind, `${hash}.json`);
  if (REPLAY) {
    if (!existsSync(file)) {
      throw new Error(`No hay respuesta guardada para --replay (${kind}/${hash}). Corre primero el mismo comando sin --replay.`);
    }
    return { ...readJson<T>(file), replayed: true };
  }
  const value = await fn();
  writeJson(file, value);
  return { ...value, replayed: false };
}
