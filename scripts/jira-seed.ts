// Siembra de respaldo por API REST. La siembra principal es /sembrar-backlog en Claude Code (vía MCP).
//   npm run jira:seed

import { loadSeed } from "./lib/backlog.ts";
import { JIRA, createIssue, searchIssues } from "./lib/jira.ts";

async function main() {
  const existing = await searchIssues(`project = ${JIRA.project} AND labels = ${JIRA.label_demo}`);
  const have = new Set(existing.map((i) => i.summary.trim().toLowerCase()));
  let created = 0;
  for (const s of loadSeed()) {
    if (have.has(s.summary.trim().toLowerCase())) continue;
    const key = await createIssue({ summary: s.summary, description: s.description, issuetype: s.issuetype, priority: s.priority, labels: [JIRA.label_demo] });
    console.log(`${key}  ${s.summary}`);
    created++;
  }
  console.log(`\nCreados ${created}. Ya existían ${existing.length}.`);
}

main().catch((e) => {
  console.error(`Error: ${(e as Error).message}`);
  process.exit(1);
});
