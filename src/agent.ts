import { Agent, tool } from "@openai/agents";
import { z } from "zod";

/**
 * Modele utilise par l'agent. Surchargeable via la variable d'env
 * OPENAI_AGENT_MODEL pour pouvoir changer sans toucher au code.
 */
export const MODEL = process.env.OPENAI_AGENT_MODEL ?? "gpt-5.4";

/** Outil : renvoie la date/heure courante au format ISO. */
const getCurrentTime = tool({
  name: "get_current_time",
  description:
    "Renvoie la date et l'heure actuelles (ISO 8601). A utiliser pour toute question sur 'aujourd'hui', 'maintenant', l'heure ou la date.",
  parameters: z.object({
    timezone: z
      .string()
      .describe("Fuseau IANA, ex: 'Europe/Paris'. 'UTC' par defaut.")
      .default("UTC"),
  }),
  async execute({ timezone }) {
    try {
      const now = new Date();
      const formatted = new Intl.DateTimeFormat("fr-FR", {
        timeZone: timezone,
        dateStyle: "full",
        timeStyle: "long",
      }).format(now);
      return JSON.stringify({ iso: now.toISOString(), timezone, formatted });
    } catch {
      return JSON.stringify({
        iso: new Date().toISOString(),
        timezone: "UTC",
        note: `Fuseau '${timezone}' invalide, UTC utilise.`,
      });
    }
  },
});

/** Outil : evalue une expression arithmetique simple, sans eval(). */
const calculator = tool({
  name: "calculator",
  description:
    "Evalue une expression arithmetique (nombres, + - * / ( ) et decimales). A utiliser pour tout calcul.",
  parameters: z.object({
    expression: z
      .string()
      .describe("Expression a calculer, ex: '2 * (3 + 4.5)'"),
  }),
  async execute({ expression }) {
    if (!/^[\d\s+\-*/().]+$/.test(expression)) {
      return JSON.stringify({
        error: "Expression non autorisee : seuls chiffres et + - * / ( ) sont permis.",
      });
    }
    try {
      // Pas de eval() : on parse via Function sur une chaine deja validee par la regex.
      const result = Function(`"use strict"; return (${expression});`)();
      if (typeof result !== "number" || !Number.isFinite(result)) {
        return JSON.stringify({ error: "Resultat invalide." });
      }
      return JSON.stringify({ expression, result });
    } catch {
      return JSON.stringify({ error: "Expression mal formee." });
    }
  },
});

/** Agent assistant general avec quelques outils de base. */
export const assistant = new Agent({
  name: "Assistant general",
  model: MODEL,
  instructions: [
    "Tu es un assistant general utile, precis et concis.",
    "Reponds dans la langue de l'utilisateur.",
    "Utilise l'outil calculator pour tout calcul plutot que de calculer de tete.",
    "Utilise get_current_time pour toute question sur la date ou l'heure.",
    "Si tu ne sais pas, dis-le clairement plutot que d'inventer.",
  ].join("\n"),
  tools: [getCurrentTime, calculator],
});

export const tools = { getCurrentTime, calculator };
