# openai-agent-ts

Assistant général construit avec l'[OpenAI Agents SDK](https://developers.openai.com/api/docs/guides/agents) en TypeScript, avec deux outils de base (calcul + date/heure) et un smoke test à lancer avant la prod.

## Installation

```bash
npm install
cp .env.example .env   # puis colle ta clé dans OPENAI_API_KEY
```

## Lancer l'agent

```bash
npm start                                   # question de démo
npm start -- "Quelle heure est-il à Paris ?"
```

## Tester avant la prod

```bash
npm run typecheck   # vérifie le typage TypeScript (aucun appel API)
npm run smoke       # lance l'agent sur 4 cas réels et vérifie qu'il répond
```

Le smoke test sort en **code 1** dès qu'un cas échoue — pratique en CI : un déploiement bloque si `npm run smoke` ne passe pas. Il consomme des tokens (vrais appels API).

## Structure

- `src/agent.ts` — définition de l'agent + outils (`calculator`, `get_current_time`)
- `src/index.ts` — point d'entrée CLI
- `src/smoke-test.ts` — contrôle « ça tourne » avant déploiement

## Configuration

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `OPENAI_API_KEY` | Clé API (obligatoire) | — |
| `OPENAI_AGENT_MODEL` | Modèle utilisé | `gpt-5.4` |

## CI (GitHub Actions)

Le workflow `.github/workflows/ci.yml` tourne automatiquement :

- **typecheck** — à chaque push et PR (aucun appel API).
- **smoke** — uniquement sur push vers `main`, avec de vrais appels API.

Pour activer le smoke en CI : dans le repo, **Settings → Secrets and variables → Actions**, ajoute le secret `OPENAI_API_KEY`. Tu peux aussi définir la variable `OPENAI_AGENT_MODEL` au même endroit pour changer de modèle. Le workflow suppose que le projet est à la **racine** du repo.

## Avant de déployer

- `.env` est dans `.gitignore` — ne jamais committer la clé.
- En prod, injecte `OPENAI_API_KEY` via les variables d'environnement du host (pas de fichier `.env`).
- Le smoke test vérifie l'absence d'erreur, **pas** la qualité des réponses. Pour mesurer la qualité, voir le guide [Evaluate agent workflows](https://developers.openai.com/api/docs/guides/agent-evals).
- Inspecte les exécutions dans le [dashboard Traces](https://platform.openai.com/traces).
