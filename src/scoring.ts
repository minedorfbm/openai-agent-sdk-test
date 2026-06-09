/**
 * Scoring déterministe du Guardian Core (Guardian Core spec §5).
 *
 * Volontairement pur (aucune dépendance, aucun appel réseau / LLM) pour être
 * exactement reproductible et testable unitairement — conforme à l'exigence
 * « scoring déterministe » de la spec.
 *
 *   risk_raw   = likelihood × impact × exposure            ∈ [0,1]
 *   amplifier  = 1 + k × log2(blast_radius)                blast_radius ≥ 1, k = 0.15
 *   risk_score = clamp(0, 100, 100 × risk_raw × amplifier)
 */

export const AMPLIFIER_K = 0.15;

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export interface ScoreFactors {
  /** Probabilité que le risque soit réel (vs faux positif). 0–1. */
  likelihood: number;
  /** Gravité si réalisé (classification, irréversibilité). 0–1. */
  impact: number;
  /** Surface offerte (autonomie, egress, untrusted input, privilèges). 0–1. */
  exposure: number;
  /** Nb d'entités potentiellement affectées au niveau d'analyse. ≥ 1. */
  blast_radius: number;
}

export interface ScoreResult {
  value: number; // 0–100, arrondi à l'entier
  severity: Severity;
  factors: ScoreFactors;
}

const clamp = (min: number, max: number, x: number) =>
  Math.min(max, Math.max(min, x));

const clamp01 = (x: number) => clamp(0, 1, x);

/** Bandes de sévérité (spec §5.3). */
export function severityOf(value: number): Severity {
  if (value >= 85) return "critical";
  if (value >= 65) return "high";
  if (value >= 40) return "medium";
  if (value >= 15) return "low";
  return "info";
}

/** Calcule le score de risque 0–100 à partir des facteurs (spec §5.1). */
export function scoreRisk(factors: ScoreFactors): ScoreResult {
  const likelihood = clamp01(factors.likelihood);
  const impact = clamp01(factors.impact);
  const exposure = clamp01(factors.exposure);
  const blast_radius = Math.max(1, factors.blast_radius);

  const riskRaw = likelihood * impact * exposure;
  const amplifier = 1 + AMPLIFIER_K * Math.log2(blast_radius);
  const raw = clamp(0, 100, 100 * riskRaw * amplifier);
  const value = Math.round(raw);

  return {
    value,
    severity: severityOf(value),
    factors: { likelihood, impact, exposure, blast_radius },
  };
}

/**
 * Posture d'enforcement par défaut suggérée par la bande de sévérité (§5.3).
 * Indicatif : la politique réelle vient du catalogue (policies.ts), mais ceci
 * aide l'agent à expliquer pourquoi telle réponse est proposée.
 */
export function defaultPosture(severity: Severity): string {
  switch (severity) {
    case "critical":
      return "enforcement fort (block/isolate) + alerte immédiate";
    case "high":
      return "require_approval / throttle + alerte";
    case "medium":
      return "warn + monitoring renforcé";
    case "low":
      return "monitor";
    case "info":
      return "journalisé, agrégé";
  }
}
