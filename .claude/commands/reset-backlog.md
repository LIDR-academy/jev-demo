---
description: Deja el backlog de Jira como al inicio de la demo
allowed-tools: Bash(npm run jira:reset), Read, mcp__atlassian__*
---

Deja el backlog de la demo como al inicio.

1. Corre `npm run jira:reset`. Si termina bien, responde con su última línea y nada más.
2. Solo si falla por falta de credenciales REST, hazlo con el MCP de Atlassian:
   - Issues con etiqueta `demo-soporte`: bórralos; si el MCP no permite borrar, pásalos a Done.
   - Demás issues con etiqueta `demo-jev`: regresa la prioridad a la que tienen en `data/backlog-seed.json` (busca por resumen) y quita las etiquetas `jev-priorizado`, `jev-bloquea-ingresos`, `jev-duplicado` y `needs-human-review`.
   - Los comentarios que empiezan con `[Jev]` bórralos si el MCP lo permite; si no, avísame cuántos quedaron.
3. Responde con un resumen de una línea.
