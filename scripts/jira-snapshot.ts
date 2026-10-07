// Exporta el backlog actual de Jira a out/backlog-snapshot.json (la misma entrada para el antes y el después).
//   npm run jira:snapshot

import { SNAPSHOT } from "./lib/backlog.ts";
import { writeJson } from "./lib/env.ts";
import { JIRA, searchIssues } from "./lib/jira.ts";

async function main() {
  const issues = await searchIssues(JIRA.jql_backlog);
  writeJson(SNAPSHOT(), { exported_at: new Date().toISOString(), jql: JIRA.jql_backlog, issues });
  console.log(`${issues.length} issues guardados en ${SNAPSHOT()}`);
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
