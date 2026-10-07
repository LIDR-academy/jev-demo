import { readJson, rootPath } from "./env.ts";

// API REST de Jira Cloud v3. Se usa para lo que tiene que ser rápido (escribir 28 decisiones)
// y para reset/siembra de respaldo. La siembra principal y la creación desde el correo van por el MCP.

export type JiraConfig = { project: string; label_demo: string; label_soporte: string; labels_jev: string[]; jql_backlog: string };
export const JIRA = readJson<JiraConfig>(rootPath("config", "jira.json"));

export type Issue = {
  key: string;
  summary: string;
  description: string;
  issuetype: string;
  priority: string;
  labels: string[];
};

export function hasJiraCreds(): boolean {
  return Boolean(process.env.JIRA_SITE && process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
}

async function jira<T>(method: string, pathname: string, body?: unknown): Promise<T> {
  if (!hasJiraCreds()) throw new Error("Faltan JIRA_SITE, JIRA_EMAIL o JIRA_API_TOKEN en .env");
  const site = process.env.JIRA_SITE!.replace(/\/$/, "");
  const auth = Buffer.from(`${process.env.JIRA_EMAIL}:${process.env.JIRA_API_TOKEN}`).toString("base64");
  const res = await fetch(`${site}${pathname}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Jira ${method} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 400)}`);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---------- ADF (Atlassian Document Format) ----------

type AdfNode = { type: string; text?: string; content?: AdfNode[] };

export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return typeof node === "string" ? node : "";
  const n = node as AdfNode;
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  const inner = (n.content ?? []).map(adfToText);
  const block = ["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(n.type);
  return inner.join(n.type === "bulletList" || n.type === "orderedList" ? "\n" : "") + (block ? "\n" : "");
}

export function textToAdf(text: string): unknown {
  const paragraphs = text.split(/\n{2,}/).map((p) => ({
    type: "paragraph",
    content: p.split("\n").flatMap((line, i) => {
      const nodes: object[] = [];
      if (i > 0) nodes.push({ type: "hardBreak" });
      if (line) nodes.push({ type: "text", text: line });
      return nodes;
    }),
  }));
  return { type: "doc", version: 1, content: paragraphs };
}

// ---------- Operaciones ----------

type SearchResponse = {
  issues: { key: string; fields: { summary: string; description: unknown; issuetype?: { name: string }; priority?: { name: string }; labels?: string[] } }[];
  nextPageToken?: string;
  isLast?: boolean;
};

export async function searchIssues(jql: string): Promise<Issue[]> {
  const out: Issue[] = [];
  let token: string | undefined;
  do {
    const params = new URLSearchParams({ jql, maxResults: "100", fields: "summary,description,issuetype,priority,labels" });
    if (token) params.set("nextPageToken", token);
    const page = await jira<SearchResponse>("GET", `/rest/api/3/search/jql?${params}`);
    for (const i of page.issues) {
      out.push({
        key: i.key,
        summary: i.fields.summary,
        description: adfToText(i.fields.description).trim(),
        issuetype: i.fields.issuetype?.name ?? "",
        priority: i.fields.priority?.name ?? "",
        labels: i.fields.labels ?? [],
      });
    }
    token = page.isLast ? undefined : page.nextPageToken;
  } while (token);
  return out;
}

export async function createIssue(i: { summary: string; description: string; issuetype: string; priority: string; labels: string[] }): Promise<string> {
  const res = await jira<{ key: string }>("POST", "/rest/api/3/issue", {
    fields: {
      project: { key: JIRA.project },
      summary: i.summary,
      description: textToAdf(i.description),
      issuetype: { name: i.issuetype },
      priority: { name: i.priority },
      labels: i.labels,
    },
  });
  return res.key;
}

export async function updateIssue(key: string, change: { priority?: string; addLabels?: string[]; removeLabels?: string[] }): Promise<void> {
  const labelOps = [
    ...(change.removeLabels ?? []).map((l) => ({ remove: l })),
    ...(change.addLabels ?? []).map((l) => ({ add: l })),
  ];
  await jira("PUT", `/rest/api/3/issue/${key}`, {
    fields: change.priority ? { priority: { name: change.priority } } : {},
    update: labelOps.length ? { labels: labelOps } : {},
  });
}

export async function addComment(key: string, text: string): Promise<void> {
  await jira("POST", `/rest/api/3/issue/${key}/comment`, { body: textToAdf(text) });
}

export async function deleteJevComments(key: string): Promise<number> {
  const res = await jira<{ comments: { id: string; body: unknown }[] }>("GET", `/rest/api/3/issue/${key}/comment?maxResults=100`);
  const mine = res.comments.filter((c) => adfToText(c.body).startsWith(JEV_COMMENT_MARK));
  for (const c of mine) await jira("DELETE", `/rest/api/3/issue/${key}/comment/${c.id}`);
  return mine.length;
}

export async function deleteIssue(key: string): Promise<void> {
  await jira("DELETE", `/rest/api/3/issue/${key}`);
}

export const JEV_COMMENT_MARK = "[Jev]";
