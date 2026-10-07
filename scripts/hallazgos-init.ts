// Prepara out/hallazgos.json para la revisión cruzada (se hace a mano):
// por cada hallazgo [ALTA] de Opus en el antes, marca si la revisión del después también lo encontró.
// Si el archivo ya existe, conserva lo que ya marcaste.
//   npm run hallazgos:init

import { existsSync } from "node:fs";
import { outPath, readJson, writeJson } from "./lib/env.ts";
import { type ReviewRun, reviewerLabel } from "./lib/prs.ts";

type Entry = { hallazgo: string; conservado: boolean | null };
export type Hallazgos = {
  _instrucciones: string;
  /** Qué corrida del después se usó para marcar. Si se vuelve a correr, la tarjeta lo dice. */
  despues_generated_at?: string;
  prs: { number: number; title: string; revisor_despues: string; alta_antes: Entry[]; alta_despues: string[] }[];
};

const file = outPath("hallazgos.json");
const antes = readJson<ReviewRun>(outPath("antes", "prs.json"));
const despues = existsSync(outPath("despues", "prs.json")) ? readJson<ReviewRun>(outPath("despues", "prs.json")) : undefined;
const previous = existsSync(file) ? readJson<Hallazgos>(file) : undefined;

const data: Hallazgos = {
  _instrucciones:
    "Por cada hallazgo de alta_antes, pon conservado: true si la revisión del después (out/despues/reviews/<pr>.md) señala el mismo problema, o false si no. Compáralas leyendo ambas revisiones.",
  despues_generated_at: despues?.generated_at,
  prs: antes.items
    .filter((i) => i.high_findings.length > 0)
    .map((i) => {
      const d = despues?.items.find((x) => x.number === i.number);
      const prev = previous?.prs.find((p) => p.number === i.number);
      return {
        number: i.number,
        title: i.title,
        revisor_despues: d ? reviewerLabel(d.reviewer) : "sin revisar",
        alta_antes: i.high_findings.map((h) => ({ hallazgo: h, conservado: prev?.alta_antes.find((e) => e.hallazgo === h)?.conservado ?? null })),
        alta_despues: d?.high_findings ?? [],
      };
    }),
};
writeJson(file, data);
const total = data.prs.reduce((a, p) => a + p.alta_antes.length, 0);
const pending = data.prs.reduce((a, p) => a + p.alta_antes.filter((e) => e.conservado === null).length, 0);
console.log(`${total} hallazgos [ALTA] de Opus en ${data.prs.length} PRs. Pendientes de marcar: ${pending}.`);
console.log(`Edita ${file}`);
