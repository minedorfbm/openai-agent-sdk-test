/**
 * Métadonnées de risque (taxonomie WGS §4) et catalogue de politiques Shield
 * (§6 + planchers global-baseline + template data_rag). IDs de politiques réels,
 * repris des fichiers GUARDIAN CORE/templates.
 */
import type { RiskCategory, SuggestedPolicy } from "./types.js";

export interface RiskMeta {
  taxonomy_id: string;
  title: string;
  owasp_ref: string;
  category: RiskCategory;
}

export const RISK_META: Record<string, RiskMeta> = {
  "WGS-R01": {
    taxonomy_id: "WGS-R01",
    title: "Injection de prompt / manipulation d'intention",
    owasp_ref: "Prompt Injection · Intent Breaking & Goal Manipulation",
    category: "prompt_injection",
  },
  "WGS-R02": {
    taxonomy_id: "WGS-R02",
    title: "Agence excessive / mauvais usage d'outil",
    owasp_ref: "Tool Misuse · Excessive Agency",
    category: "excessive_agency",
  },
  "WGS-R03": {
    taxonomy_id: "WGS-R03",
    title: "Exécution de code / shell non maîtrisée",
    owasp_ref: "Tool Misuse",
    category: "tool_misuse",
  },
  "WGS-R04": {
    taxonomy_id: "WGS-R04",
    title: "Exfiltration de données",
    owasp_ref: "Sensitive Information Disclosure",
    category: "data_exfiltration",
  },
  "WGS-R05": {
    taxonomy_id: "WGS-R05",
    title: "Empoisonnement mémoire",
    owasp_ref: "Memory Poisoning",
    category: "memory_poisoning",
  },
  "WGS-R06": {
    taxonomy_id: "WGS-R06",
    title: "Compromission d'identité / privilèges",
    owasp_ref: "Identity Spoofing · Privilege Compromise",
    category: "identity_privilege",
  },
  "WGS-R07": {
    taxonomy_id: "WGS-R07",
    title: "Abus de ressources / surcharge",
    owasp_ref: "Resource Overload",
    category: "resource_abuse",
  },
  "WGS-R11": {
    taxonomy_id: "WGS-R11",
    title: "Risque chaîne d'approvisionnement / MCP",
    owasp_ref: "Agentic Supply Chain",
    category: "supply_chain",
  },
};

/**
 * Politiques recommandées par risque, ordonnées par effet/coût (plancher d'abord).
 * `mandatory: true` = plancher global non desserrable (tighten-only).
 */
export const POLICY_CATALOG: Record<string, SuggestedPolicy[]> = {
  "WGS-R01": [
    {
      policy_id: "floor.untrusted_input_quarantine",
      objective:
        "Quarantaine du contenu non vérifié : pas d'exécution d'instructions issues de contenu externe.",
      target_metric: "instructions_executees_depuis_contenu_externe",
      target_value: "0",
      enforcement: "warn",
    },
    {
      policy_id: "pol.rag.untrusted_quarantine",
      objective:
        "Tout document externe ingéré est traité comme non fiable (escalade warn→block si la boucle d'efficacité l'exige).",
      target_metric: "instructions_executees_depuis_contenu_externe",
      target_value: "0",
      enforcement: "block",
    },
  ],
  "WGS-R02": [
    {
      policy_id: "pol.tool.allowlist",
      objective:
        "Allowlist d'outils/domaines/MCP : accès hors allowlist refusé jusqu'à approbation.",
      target_metric: "acces_hors_allowlist",
      target_value: "0",
      enforcement: "require_approval",
    },
  ],
  "WGS-R03": [
    {
      policy_id: "pol.exec.sandbox",
      objective: "Toute exécution de code/shell se fait en sandbox isolée.",
      target_metric: "executions_hors_sandbox",
      target_value: "0",
      enforcement: "isolate",
    },
    {
      policy_id: "pol.exec.destructive_block",
      objective: "Les commandes destructrices/irréversibles exigent une approbation.",
      target_metric: "commandes_irreversibles_non_approuvees",
      target_value: "0",
      enforcement: "require_approval",
    },
  ],
  "WGS-R04": [
    {
      policy_id: "floor.secret_pii_egress",
      objective:
        "Anti-exfiltration (plancher) : bloquer toute sortie de secrets/PII/confidentiel vers une destination non allowlistée.",
      target_metric: "fuites_donnees_sensibles",
      target_value: "0",
      enforcement: "block",
      mandatory: true,
    },
    {
      policy_id: "pol.data.pii_egress_block",
      objective:
        "Anti-exfiltration PII au niveau agent (recouvre le plancher pour le data_rag).",
      target_metric: "fuites_pii",
      target_value: "0",
      enforcement: "block",
    },
  ],
  "WGS-R05": [
    {
      policy_id: "pol.rag.memory_write_review",
      objective:
        "Écriture en mémoire persistante validée par règle de provenance (anti-empoisonnement).",
      target_metric: "ecritures_memoire_non_tracees",
      target_value: "0",
      enforcement: "require_approval",
    },
  ],
  "WGS-R06": [
    {
      policy_id: "floor.privilege_escalation_block",
      objective: "Anti-escalade de privilèges (plancher) : permissions hors allowlist bloquées.",
      target_metric: "escalades_privileges",
      target_value: "0",
      enforcement: "block",
      mandatory: true,
    },
  ],
  "WGS-R07": [
    {
      policy_id: "floor.resource_runaway_guard",
      objective: "Garde anti-emballement : throttle sur pic de coût/tokens ou boucle profonde.",
      target_metric: "emballements_ressources",
      target_value: "0",
      enforcement: "throttle",
    },
  ],
  "WGS-R11": [
    {
      policy_id: "floor.mcp_supply_chain_allowlist",
      objective: "Allowlist MCP/dépendances (plancher) : serveur MCP hors allowlist en attente d'approbation.",
      target_metric: "appels_mcp_hors_allowlist",
      target_value: "0",
      enforcement: "require_approval",
      mandatory: true,
    },
  ],
};

export function policiesForRisk(taxonomyId: string): SuggestedPolicy[] {
  return POLICY_CATALOG[taxonomyId] ?? [];
}
