/**
 * Pipeline Guardian déterministe (spec §2) : ingestion → détection → scoring →
 * proposition de politiques. Produit des risk-findings conformes au schéma.
 * Pur et testable sans API.
 */
import { actionExportSchema, type ActionExport, type AgentInfo, type RiskFinding } from "./types.js";
import { detectEvent, type Candidate } from "./detectors.js";
import { scoreRisk } from "./scoring.js";
import { RISK_META, policiesForRisk } from "./policies.js";

export interface AnalysisResult {
  summary: {
    export_id: string;
    tenant_id: string;
    fleet_id: string;
    events_analyzed: number;
    findings: number;
    by_severity: Record<string, number>;
  };
  findings: RiskFinding[];
}

/** Valide un export brut contre le schéma (rejette schema_version inconnue). */
export function parseExport(raw: unknown): ActionExport {
  return actionExportSchema.parse(raw);
}

function agentIndex(exp: ActionExport): Map<string, AgentInfo> {
  const m = new Map<string, AgentInfo>();
  for (const a of exp.fractal_context.agents ?? []) m.set(a.agent_id, a);
  return m;
}

/** Analyse complète d'un export → findings scorés + politiques suggérées. */
export function analyzeExport(exp: ActionExport): AnalysisResult {
  const agents = agentIndex(exp);

  // 1+2. Détection : collecte des candidats par (agent_id, taxonomy_id).
  const best = new Map<string, Candidate>();
  for (const ev of exp.events) {
    const agent = agents.get(ev.agent_id);
    for (const c of detectEvent(ev, agent)) {
      const key = `${c.agent_id}::${c.taxonomy_id}`;
      const prev = best.get(key);
      const cScore = c.factors.likelihood * c.factors.impact * c.factors.exposure;
      if (!prev) {
        best.set(key, c);
      } else {
        const pScore = prev.factors.likelihood * prev.factors.impact * prev.factors.exposure;
        // garde le plus fort, fusionne les preuves
        if (cScore > pScore) {
          best.set(key, { ...c, evidence: [...prev.evidence, ...c.evidence] });
        } else {
          prev.evidence.push(...c.evidence);
        }
      }
    }
  }

  // 3+4. Scoring + proposition de politiques → risk-findings.
  const detectedAt = new Date().toISOString();
  const findings: RiskFinding[] = [];
  let i = 0;
  for (const [, c] of best) {
    const scored = scoreRisk({ ...c.factors, blast_radius: 1 }); // niveau agent
    const meta = RISK_META[c.taxonomy_id];
    findings.push({
      finding_id: `f-${exp.export.export_id.slice(0, 8)}-${String(++i).padStart(3, "0")}`,
      detected_at: detectedAt,
      fractal_level: "agent",
      scope_ref: {
        agent_id: c.agent_id,
        fleet_id: exp.fractal_context.fleet_id,
        tenant_id: exp.fractal_context.tenant_id,
      },
      risk: {
        taxonomy_id: c.taxonomy_id,
        owasp_ref: meta?.owasp_ref,
        title: meta?.title ?? c.taxonomy_id,
        category: meta?.category ?? "drift_misalignment",
      },
      score: {
        value: scored.value,
        severity: scored.severity,
        confidence: c.confidence,
        factors: scored.factors,
      },
      evidence: c.evidence,
      suggested_policies: policiesForRisk(c.taxonomy_id),
      status: "suggested",
    });
  }

  // tri par sévérité décroissante (score) pour un rapport priorisé
  findings.sort((a, b) => b.score.value - a.score.value);

  const by_severity: Record<string, number> = {};
  for (const f of findings) by_severity[f.score.severity] = (by_severity[f.score.severity] ?? 0) + 1;

  return {
    summary: {
      export_id: exp.export.export_id,
      tenant_id: exp.fractal_context.tenant_id,
      fleet_id: exp.fractal_context.fleet_id,
      events_analyzed: exp.events.length,
      findings: findings.length,
      by_severity,
    },
    findings,
  };
}
