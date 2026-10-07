---
description: Acto 1, después. Jev prioriza el backlog de Jira y escribe el resultado.
argument-hint: "[objetivo del sprint, opcional]"
allowed-tools: Bash(npm run priorizar:*), Read, mcp__atlassian__*
---

Prioriza el backlog de la demo con Jev y escribe el resultado en Jira.

1. Corre `npm run priorizar -- --write`. Si me pasaste un objetivo del sprint ("$ARGUMENTS" no está vacío), agrega `--goal "$ARGUMENTS"`.
2. Si la salida dice que no hay de dónde leer el backlog (no hay credenciales REST), ejecuta los pasos de `/exportar-backlog` con la ruta `out/backlog-live.json` y vuelve a correr con `--input out/backlog-live.json`.
3. Si la salida dice "No escribo en Jira", lee `out/despues/backlog-decisions.json` y aplica cada decisión con el MCP de Atlassian:
   - Cambia la prioridad solo si `priority` es distinta de `priority_before`.
   - Agrega las etiquetas de `labels` y quita las demás que empiecen con `jev-` o sean `needs-human-review`.
   - Agrega `comment` como comentario.
4. Responde solo con:
   - Una línea con las corridas, el tiempo y el costo, tal como las imprimió el script.
   - Una tabla Markdown con los 8 issues de mayor prioridad: issue, prioridad (antes → después), confianza y señales.
   - Las líneas de "Trampas" y "Consistencia" tal como las imprimió el script.

Sin análisis adicional.
