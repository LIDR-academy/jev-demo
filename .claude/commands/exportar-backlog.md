---
description: Exporta el backlog de Jira a un archivo vía MCP (respaldo si no hay credenciales REST)
argument-hint: "[ruta, por defecto out/backlog-live.json]"
allowed-tools: Read, Write, mcp__atlassian__*
---

Exporta el backlog de la demo con el MCP de Atlassian. Úsalo solo si no hay credenciales REST en `.env`.

Ruta de salida: "$ARGUMENTS"; si está vacío, `out/backlog-live.json`. Para comparar antes y después se usa `out/backlog-snapshot.json` (la entrada común del antes y el después).

1. Lee `config/jira.json` y usa su `jql_backlog`.
2. Trae todos los issues que devuelva, con resumen, descripción en texto plano, tipo, prioridad y etiquetas.
3. Escribe la ruta de salida con esta forma exacta:

```json
{
  "exported_at": "<fecha ISO>",
  "jql": "<la JQL usada>",
  "issues": [
    { "key": "SHOP-1", "summary": "...", "description": "...", "issuetype": "Bug", "priority": "Medium", "labels": ["demo-jev"] }
  ]
}
```

4. Responde solo con cuántos issues exportaste.
