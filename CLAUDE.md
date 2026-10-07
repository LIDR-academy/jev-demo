# Demo Jev: antes y después

Repo para replicar "Jev decide, Claude trabaja". Jev (TypeSafe AI) es un modelo System One que responde preguntas tipadas (Choice, Score, Noul) con probabilidades calibradas en lugar de texto. Hay dos actos, cada uno con un antes y un después medidos con las mismas métricas:

- Acto 1, qué hacer primero: priorizar el backlog de Jira (proyecto `SHOP`). Antes: Sonnet con un prompt. Después: Jev con 7 preguntas por issue.
- Acto 2, quién lo hace: revisar 12 PRs reales de `medusajs/medusa`. Antes: todos con Opus. Después: cada PR con el modelo que elige Jev.

## Reglas

- Responde siempre en español y corto.
- Nunca imprimas ni muestres el contenido de `.env` ni ninguna API key. No corras `cat .env`, `env` ni `printenv`.
- No modifiques `out/antes/`: es la línea base con la que se compara.
- Todo issue que crees en Jira en el proyecto `SHOP` lleva la etiqueta `demo-jev`. Si viene de un correo de soporte, también `demo-soporte`, tipo `Bug` salvo que sea claramente otra cosa, y prioridad `Medium`. Un issue por queja, con resumen corto en español y la queja del cliente en la descripción.
- Nunca subas a Jira los campos `ref`, `trampa` ni `duplicado_de` de `data/backlog-seed.json`: son internos.
- Cuando un script imprima una tabla, muéstrala tal cual en Markdown, sin agregar análisis.

## Comandos

- `npm run priorizar -- --write`: Jev prioriza el backlog de Jira y escribe prioridad, etiquetas y comentario.
- `npm run route`: Jev elige el revisor de cada PR.
- `npm run despues:prs`: revisa cada PR con el modelo elegido.
- `npm run compare -- backlog|prs|all`: tarjeta de antes y después.
- Cualquier script acepta `--replay` para reproducir lo guardado en `out/cache/` sin red.

Slash commands en `.claude/commands/`: `/sembrar-backlog`, `/exportar-backlog`, `/reset-backlog`, `/priorizar-backlog`, `/rutear-prs`, `/revisar-prs`.

## Estructura

- `config/`: modelos y precios, objetivo del sprint, umbrales, Jira, selección de PRs.
- `questions/`: preguntas a Jev (instrucciones en inglés, que es donde Jev rinde mejor).
- `prompts/`: prompts del antes y de revisión (idéntico en antes y después).
- `data/`: backlog sembrado, correo de soporte, los 12 PRs con su diff.
- `scripts/`: TypeScript que Node 22.18+ ejecuta directo, sin compilar ni instalar dependencias.
- `out/`: resultados y caché de respuestas (para `--replay`).
