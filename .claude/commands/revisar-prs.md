---
description: Acto 2, después (paso 2). Revisa cada PR con el modelo que eligió Jev.
argument-hint: "[--only 17148,16722] [--replay]"
allowed-tools: Bash(npm run despues:prs:*)
---

Corre `npm run despues:prs -- $ARGUMENTS` (si no hay argumentos, sin nada extra). Puede tardar unos minutos: espera a que termine.

Responde solo con:

- Una tabla Markdown por PR: PR, revisor, tiempo, costo y número de hallazgos [ALTA] (léelos de `out/despues/prs.json`).
- Las dos líneas finales que imprimió el script (revisiones y lo que costó decidir con Jev).

Sin análisis adicional.
