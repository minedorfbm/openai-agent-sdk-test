# guardian-agent-ts

Agent **Guardian** (WatchMyAgents — boucle Watch · Guardian · Shield) construit sur l'[OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents) en TypeScript.

À partir d'un **export d'actions** (`action-export.schema.json`), l'agent :

1. **détecte** les risques de la taxonomie WGS (R01→R12, mappée OWASP Agentic),
2. les **score** avec la formule déterministe de la spec (§5),
3. **propose** des politiques Shield avec objectif mesurable (catalogue §6 + planchers global-baseline),
4. rend un **rapport priorisé** + des `risk-findings` conformes au schéma.

Le scoring et la détection sont du **code TypeScript pur et déterministe** (`scoring.ts`, `detectors.ts`, `pipeline.ts`) — le modèle ne fait qu'orchestrer et rédiger. Conforme à l'exigence « scoring déterministe » de la spec.

## Installation

```bash
npm install
cp .env.example .env   # puis colle ta clé dans OPENAI_API_KEY
```

## Lancer l'agent

```bash
npm start                                   # analyse la fixture de démo (exemple §13)
npm start -- chemin/vers/mon-export.json    # analyse ton propre export
```

### Mode dossier surveillé

```bash
npm run watch
```

Dépose un export `.json` dans le dossier `exports/` : il est analysé automatiquement. Pour chaque fichier :

- `exports/processed/<nom>.findings.json` — les risk-findings déterministes (toujours, sans clé API),
- `exports/processed/<nom>.report.md` — le rapport rédigé par l'agent (si `OPENAI_API_KEY` est présente),
- le fichier source est déplacé dans `exports/processed/` une fois traité.

Dossier configurable via `EXPORTS_DIR`.

## Tester

```bash
npm run typecheck   # typage TypeScript (aucun appel API)
npm run selfcheck   # cœur déterministe : scoring §5 + détecteurs, sur la fixture (aucun appel API)
npm run smoke       # agent de bout en bout sur la fixture (vrais appels API)
```

`selfcheck` est le test à privilégier : il vérifie sans clé que l'exemple §13 (injection + exfiltration PII) score bien **88 / Critical**, que R04 et R01 sont détectés, et que le plancher anti-exfiltration est proposé. Il sort en **code 1** si une assertion échoue.

## Structure

- `src/scoring.ts` — formule de score §5 + bandes de sévérité (pur)
- `src/detectors.ts` — détecteurs de règles WGS R01–R07, R11 (pur)
- `src/policies.ts` — métadonnées de risque + catalogue de politiques (IDs réels)
- `src/pipeline.ts` — ingestion → détection → scoring → findings (pur)
- `src/types.ts` — schémas zod de l'export + types de sortie `risk-finding`
- `src/agent.ts` — agent Guardian + tools (`analyze_export_file`, `score_finding`, `list_policies_for_risk`)
- `src/index.ts` — CLI
- `src/selfcheck.ts` — vérification déterministe sans API
- `src/smoke-test.ts` — smoke test agent (avec API)
- `fixtures/example-export.json` — export de démo (exemple §13)

## CI (GitHub Actions)

`.github/workflows/ci.yml` :

- **typecheck + selfcheck** — à chaque push et PR (aucun appel API).
- **smoke** — uniquement sur push vers `main`, avec de vrais appels API.

Pour le smoke en CI : **Settings → Secrets and variables → Actions**, ajoute le secret `OPENAI_API_KEY` (et, au besoin, la variable `OPENAI_AGENT_MODEL`). Le workflow suppose que le projet est à la **racine** du repo.

## Configuration

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `OPENAI_API_KEY` | Clé API (obligatoire pour `start`/`smoke`) | — |
| `OPENAI_AGENT_MODEL` | Modèle utilisé | `gpt-5.4` |

## Portée & limites

- Couvre les risques **détectables au niveau agent** sur un seul export : R01–R07, R11. Les risques de coordination/propagation (R08–R10, R12) demandent la corrélation multi-agents/multi-niveaux (Team/Fleet) — prévue par la spec mais hors de ce premier périmètre.
- Les facteurs `impact`/`exposure` sont des **heuristiques** dérivées des champs de l'export ; la calibration fine (priors par template, taux de faux positifs) est la suite logique (spec §15).
- L'agent **suggère**, ne bloque pas : la décision d'enforcement reste à l'utilisateur (principe user-controlled).
