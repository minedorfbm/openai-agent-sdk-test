import { readFileSync } from "node:fs";
import { Agent, tool } from "@openai/agents";
import { z } from "zod";
import { analyzeExport, parseExport } from "./pipeline.js";
import { scoreRisk } from "./scoring.js";
import { policiesForRisk, RISK_META } from "./policies.js";
import { AGENT_TYPES } from "./types.js";

export const MODEL = process.env.OPENAI_AGENT_MODEL ?? "gpt-5.4";

/**
 * Outil principal : analyse déterministe d'un export d'actions (Guardian §2).
 * Tout le calcul (détection + scoring §5 + sélection de politiques §6) est fait
 * en TS pur ; le modèle ne fait qu'orchestrer et rédiger.
 */
const analyzeExportFile = tool({
  name: "analyze_export_file",
  description:
    "Analyse un fichier d'export d'actions (action-export.schema.json) et renvoie les risk-findings scorés + politiques suggérées. À appeler dès qu'on te donne un chemin d'export.",
  parameters: z.object({
    path: z.string().describe("Chemin vers le fichier JSON d'export d'actions."),
  }),
  async execute({ path }) {
    try {
      const raw = JSON.parse(readFileSync(path, "utf8"));
      const exp = parseExport(raw);
      const result = analyzeExport(exp);
      return JSON.stringify(result);
    } catch (err) {
      return JSON.stringify({
        error: `Export illisible ou non conforme: ${(err as Error).message}`,
      });
    }
  },
});

/** Recalcule un score (what-if) à partir de facteurs — formule §5, déterministe. */
const scoreFinding = tool({
  name: "score_finding",
  description:
    "Calcule le score de risque 0–100 et la sévérité à partir des facteurs likelihood/impact/exposure/blast_radius (formule §5). Utile pour les hypothèses 'et si'.",
  parameters: z.object({
    likelihood: z.number().min(0).max(1),
    impact: z.number().min(0).max(1),
    exposure: z.number().min(0).max(1),
    blast_radius: z.number().min(1).default(1),
  }),
  async execute(f) {
    return JSON.stringify(scoreRisk(f));
  },
});

/** Liste les politiques Shield recommandées pour un risque WGS donné. */
const listPolicies = tool({
  name: "list_policies_for_risk",
  description:
    "Renvoie les politiques Shield recommandées (catalogue §6 + planchers) pour un identifiant de risque WGS (ex: WGS-R04).",
  parameters: z.object({
    taxonomy_id: z.string().describe("ID de risque WGS, ex: WGS-R01, WGS-R04."),
  }),
  async execute({ taxonomy_id }) {
    return JSON.stringify({
      risk: RISK_META[taxonomy_id] ?? null,
      policies: policiesForRisk(taxonomy_id),
    });
  },
});

export const guardian = new Agent({
  name: "Guardian Analyst (WGS)",
  model: MODEL,
  instructions: [
    "Tu es l'analyste Guardian de WatchMyAgents (boucle Watch · Guardian · Shield).",
    "Ton rôle (spec Guardian Core) : à partir d'un export d'actions, identifier les risques (taxonomie WGS-R01→R12 mappée OWASP Agentic), les présenter scorés, et proposer des politiques Shield avec objectif mesurable.",
    "",
    "Méthode OBLIGATOIRE :",
    "1. Appelle `analyze_export_file` avec le chemin fourni. NE recalcule JAMAIS les scores toi-même : ils sont déterministes et viennent de l'outil.",
    "2. Restitue les findings triés par sévérité décroissante.",
    "3. Pour chaque finding : risque (WGS-Rxx + réf OWASP), score + sévérité + confiance, la preuve (event_id), et les politiques suggérées avec leur objectif.",
    "",
    "Principes non négociables de la spec :",
    "- Tu SUGGÈRES, tu ne bloques pas : la décision d'enforcement revient à l'utilisateur (user-controlled).",
    "- Confidence-gating : un score élevé mais peu confiant (confidence basse) se présente comme « à investiguer », pas « à bloquer ».",
    "- Moindre intrusion : privilégie l'enforcement le moins intrusif atteignant l'objectif.",
    "- Les politiques `mandatory:true` sont des planchers globaux non desserrables (tighten-only).",
    "",
    "Rends un rapport clair en français : un résumé (nb d'events, findings par sévérité), puis les findings priorisés, puis les actions recommandées. Concis, factuel, actionnable.",
  ].join("\n"),
  tools: [analyzeExportFile, scoreFinding, listPolicies],
});

export const tools = { analyzeExportFile, scoreFinding, listPolicies };
