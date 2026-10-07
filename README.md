# Jev decide, Claude trabaja

Dos decisiones del día a día, cada una con su antes y su después medidos con las mismas métricas (tiempo, costo, consistencia):

| Acto | Antes | Después |
| --- | --- | --- |
| 1. Qué hacer primero | Sonnet prioriza el backlog de Jira con un prompt | Jev responde 7 preguntas tipadas por ticket |
| 2. Quién lo hace | 12 PRs reales de `medusajs/medusa` revisados todos con Opus | Cada PR revisado con el modelo que elige Jev |

Jev (TypeSafe AI) es un modelo System One: en lugar de texto, responde preguntas tipadas (Choice, Score, Noul) con probabilidades calibradas. Claude solo trabaja donde hace falta, con el modelo que hace falta.

## Requisitos

- **Node 22.18 o más nuevo.** Ejecuta TypeScript directo: no hace falta `npm install`. Revisa con `node --version`.
- **Claude Code** con sesión iniciada.
- **Llave de Jev** (`TYPESAFE_API_KEY`).
- **`ANTHROPIC_API_KEY`** (recomendado): ver [Cómo se mide](#cómo-se-mide).
- **Jira Cloud** con un proyecto de software `SHOP`, con los tipos Bug, Story y Task y el campo de prioridad. Opcional: sin Jira puedes correr todo el Acto 1 sobre `data/backlog-seed.json`.
- **Token de API de Jira** (opcional): para escribir en Jira desde los scripts. Se crea en <https://id.atlassian.com/manage-profile/security/api-tokens>.

## Configuración

```bash
cp .env.example .env    # llena TYPESAFE_API_KEY y, si las tienes, ANTHROPIC_API_KEY y JIRA_*
npm run smoke           # prueba de punta a punta simulada: no gasta ni toca Jira
```

El MCP de Atlassian ya está en `.mcp.json`. Al abrir Claude Code en este repo, acepta el servidor y autentícate con `/mcp` → `atlassian`.

## Acto 1: priorizar el backlog

Sin Jira, cambia `out/backlog-snapshot.json` por `data/backlog-seed.json` y usa `npm run priorizar -- --input data/backlog-seed.json` en lugar de `/priorizar-backlog`.

| # | Dónde | Comando | Qué hace |
| --- | --- | --- | --- |
| 1 | Claude Code | `/sembrar-backlog` | Crea 25 issues en `SHOP` con la etiqueta `demo-jev` (o `npm run jira:seed`) |
| 2 | Claude Code | *"Crea issues en el proyecto SHOP a partir de este correo de soporte: @data/correo-soporte.txt"* | 3 issues más desde un correo |
| 3 | Terminal | `npm run jira:snapshot` | Congela el backlog en `out/backlog-snapshot.json`: la misma entrada para antes y después |
| 4 | Terminal | `npm run antes:backlog -- --input out/backlog-snapshot.json` | **Antes**: 2 corridas de Sonnet |
| 5 | Claude Code | `/priorizar-backlog` | **Después**: Jev prioriza y escribe prioridad, etiquetas y comentario en Jira |
| 6 | Terminal | `npm run compare -- backlog` | Tarjeta antes y después |
| 7 | Terminal | `npm run jira:reset` | Deja el backlog como al inicio (o `/reset-backlog`) |

**Qué esperar.** El backlog trae tres trampas a propósito (campo `trampa` en `data/backlog-seed.json`, que nunca se sube a Jira ni se le manda a ningún modelo): el bug de cupones marcado como Low debería subir a High o más, el duplicado del carrito debería quedar marcado y el ticket vago debería ir a revisión humana.

**Prueba otro objetivo.** Corre `npm run priorizar -- --giro` (usa `_objetivo_para_el_giro` de `config/sprint.json`) o `--goal "tu objetivo"`, y mira cómo se reordena el backlog sin tocar las preguntas.

## Acto 2: elegir quién revisa cada PR

| # | Dónde | Comando | Qué hace |
| --- | --- | --- | --- |
| 1 | Terminal | `npm run antes:prs` | **Antes**: los 12 PRs revisados con Opus |
| 2 | Claude Code | `/rutear-prs` | Jev elige el modelo de cada PR |
| 3 | Claude Code | `/revisar-prs` | **Después**: cada PR revisado con el modelo elegido |
| 4 | Terminal | `npm run hallazgos:init` | Crea `out/hallazgos.json`: marca a mano qué hallazgos `[ALTA]` de Opus encontró también el después |
| 5 | Terminal | `npm run compare -- prs` | Tarjeta antes y después |

Compara una revisión contra otra en `out/antes/reviews/<pr>.md` y `out/despues/reviews/<pr>.md`. La columna `esperado` de `config/prs-seleccion.json` dice qué revisor tendría sentido para cada PR.

`npm run compare -- all` imprime las dos tarjetas.

## Dónde mirar

- `questions/backlog.json` y `questions/pr-routing.json`: las preguntas a Jev. Es lo que cambiarías para tu caso.
- `scripts/priorizar.ts` y `scripts/route.ts`: las reglas en código sobre las probabilidades de Jev (por ejemplo, lo que bloquea ingresos nunca queda por debajo de High).
- `config/thresholds.json`: los umbrales de esas reglas.
- `prompts/`: el prompt del antes y el de revisión (idéntico en antes y después).

## Cómo se mide

- **Mismo arnés en los dos lados.** El antes y el después llaman a Claude igual, con el mismo prompt de revisión. Solo cambia quién decide.
- **Motor de Claude.** Con `ANTHROPIC_API_KEY` se usa la API directa y el costo sale de los tokens y de `config/models.json`. Sin llave se usa `claude -p` con tu sesión de Claude Code, que suma unos 10 mil tokens propios (cacheados después de la primera llamada). Se fuerza con `CLAUDE_ENGINE=api` o `CLAUDE_ENGINE=cli`. Si el antes y el después usaron motores distintos, la tarjeta lo advierte.
- **Costo de Jev.** Tokens de entrada a $0.042 por millón; la salida es gratis.
- **Precios.** En `config/models.json`, verificados el 6 de octubre de 2026. Revísalos antes de correr.
- **Consistencia.** De los 25 tickets sembrados, cuántos cambian de prioridad entre dos corridas con la misma entrada. Los que quedan sin decidir (revisión humana u omitidos) se muestran aparte.
- **Hallazgos conservados.** Un hallazgo `[ALTA]` de Opus cuenta como conservado si la revisión del después señala el mismo problema. Mientras no lo marques en `out/hallazgos.json`, la tarjeta dice "pendiente".
- **Caché.** Toda llamada a Jev y a Claude se guarda en `out/cache/`. Cualquier script acepta `--replay` para repetir lo guardado sin red.
- **Modo simulado.** `DEMO_MOCK=1` (lo usa `npm run smoke`) responde con datos inventados para probar la tubería; la tarjeta lo advierte en amarillo.

## Estructura

```
.claude/commands/   slash commands
config/             modelos y precios, objetivo del sprint, umbrales, Jira, selección de PRs
data/               backlog sembrado, correo de soporte, los 12 PRs con su diff
prompts/            prompt del antes (backlog) y de revisión
questions/          preguntas a Jev
scripts/            los scripts; scripts/lib/ tiene los clientes de Jev, Claude y Jira
out/                resultados y caché (no se sube al repo)
```

`data/prs.json` ya trae los 12 PRs. `npm run prs:fetch` los refresca desde GitHub (requiere `gh`).

## Problemas comunes

- **`Unknown file extension ".ts"`:** tu Node es anterior a 22.18. Actualízalo o corre `npx tsx scripts/<archivo>.ts`.
- **Jira responde 400 al crear:** el proyecto no tiene ese tipo de issue o el campo de prioridad no está en la pantalla de creación. Usa un proyecto company-managed.
- **Jev responde 422:** una pregunta está mal formada; el mensaje dice cuál campo.
- **Jev responde 429:** el script reintenta solo. Si persiste, baja `concurrencia` en `config/thresholds.json`.
- **`No hay respuesta guardada para --replay`:** ese comando nunca se corrió sin `--replay` con la misma entrada.
