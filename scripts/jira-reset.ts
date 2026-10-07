// Deja el backlog como al inicio: prioridades originales, sin etiquetas ni comentarios de Jev,
// y borra los issues creados desde el correo de soporte (etiqueta demo-soporte).
//   npm run jira:reset

import { loadSeed } from "./lib/backlog.ts";
import { mapPool } from "./lib/clock.ts";
import { JIRA, deleteIssue, deleteJevComments, searchIssues, updateIssue } from "./lib/jira.ts";

async function main() {
  const issues = await searchIssues(`project = ${JIRA.project} AND labels = ${JIRA.label_demo}`);
  const seed = loadSeed();
  const norm = (s: string) => s.trim().toLowerCase();

  const soporte = issues.filter((i) => i.labels.includes(JIRA.label_soporte));
  for (const i of soporte) {
    await deleteIssue(i.key);
    console.log(`Borrado ${i.key} (del correo de soporte)`);
  }

  const rest = issues.filter((i) => !i.labels.includes(JIRA.label_soporte));
  let comments = 0;
  await mapPool(rest, 5, async (i) => {
    const s = seed.find((x) => norm(x.summary) === norm(i.summary));
    await updateIssue(i.key, {
      priority: s && s.priority !== i.priority ? s.priority : undefined,
      removeLabels: JIRA.labels_jev.filter((l) => i.labels.includes(l)),
    });
    const n = await deleteJevComments(i.key);
    comments += n;
  });
  console.log(`Restaurados ${rest.length} issues, borrados ${comments} comentarios de Jev y ${soporte.length} issues de soporte.`);
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
