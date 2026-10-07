---
description: Siembra en Jira (proyecto SHOP) el backlog de la demo usando el MCP de Atlassian
allowed-tools: Read, mcp__atlassian__*
---

Siembra el backlog de la demo en Jira usando el MCP de Atlassian.

1. Lee `data/backlog-seed.json`.
2. Busca con JQL `project = SHOP AND labels = demo-jev` los issues que ya existen, para no duplicar ninguno con el mismo resumen.
3. Por cada elemento de `issues` que falte, crea un issue en el proyecto `SHOP` con su `summary`, `description`, `issuetype` y `priority` tal como vienen, y la etiqueta `demo-jev`.
   - No subas `ref`, `trampa` ni `duplicado_de`: son internos y no deben verse en Jira.
   - Si el tipo `Story` no existe en el proyecto, usa `Task`.
   - Si al crear no se puede fijar la prioridad, actualízala justo después.
4. Termina con una tabla de key, tipo, prioridad y resumen, y el total creado. Nada más.
