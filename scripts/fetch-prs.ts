// Refresca data/prs.json desde GitHub con la descripción y los labels reales de cada PR.
// Requiere GitHub CLI (gh) autenticado. data/prs.json ya viene armado desde los commits del repo,
// así que este paso es opcional.
//   npm run prs:fetch

import { execFileSync } from "node:child_process";
import { readJson, rootPath, writeJson } from "./lib/env.ts";
import type { PR } from "./lib/prs.ts";

const sel = readJson<{ repo: string; prs: { number: number }[] }>(rootPath("config", "prs-seleccion.json"));

function gh(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
}

const prs: PR[] = [];
for (const { number } of sel.prs) {
  const meta = JSON.parse(gh(["pr", "view", String(number), "-R", sel.repo, "--json", "number,url,title,body,labels,additions,deletions,files"])) as {
    number: number;
    url: string;
    title: string;
    body: string;
    labels: { name: string }[];
    additions: number;
    deletions: number;
    files: { path: string; additions: number; deletions: number }[];
  };
  const diff = gh(["pr", "diff", String(number), "-R", sel.repo]);
  prs.push({
    number: meta.number,
    url: meta.url,
    title: meta.title,
    body: meta.body ?? "",
    labels: meta.labels.map((l) => l.name),
    additions: meta.additions,
    deletions: meta.deletions,
    files: meta.files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    diff,
  });
  console.log(`#${number} ${meta.title} (+${meta.additions} −${meta.deletions})`);
}
writeJson(rootPath("data", "prs.json"), { repo: sel.repo, source: "GitHub (gh pr view / gh pr diff)", prs });
console.log(`\n${prs.length} PRs guardados en data/prs.json`);
