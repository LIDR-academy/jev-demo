---
description: Acto 2, después (paso 1). Jev decide con qué modelo se revisa cada PR.
allowed-tools: Bash(npm run route:*)
---

Corre `npm run route` (agrega `--replay` si te lo pido: "$ARGUMENTS").

Responde solo con:

- La tabla de PRs como tabla Markdown: PR, revisor, confianza, riesgo, sensible y título. Marca con * los que subió la regla de piso y con ⚑ los de zona gris, igual que el script.
- Las "Reglas aplicadas en código", tal cual.
- La línea final con el conteo por revisor y lo que costó Jev.

Sin análisis adicional.
