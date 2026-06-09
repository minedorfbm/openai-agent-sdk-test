/**
 * Détecteurs de règles déterministes (Guardian Core §2 étape 2, taxonomie §4).
 * Couvre les risques détectables au niveau agent sur un seul export :
 * R01, R02, R03, R04, R05, R06, R07, R11.
 *
 * Pur : chaque détecteur lit les champs de l'export et émet un candidat de
 * finding avec ses facteurs de scoring. Aucun appel réseau / LLM.
 */
import type { AgentEvent, AgentInfo, Evidence } from "./types.js";
import type { ScoreFactors } from "./scoring.js";

export interface Candidate {
  taxonomy_id: string;
  /** facteurs sans blast_radius (ajouté au scoring, =1 au niveau agent). */
  factors: Omit<ScoreFactors, "blast_radius">;
  confidence: number;
  evidence: Evidence[];
  agent_id: string;
}

const SENSITIVE_TOOL = new Set(["payment", "secret_access", "code_exec"]);
const SENSITIVE_CLASS = new Set(["pii", "confidential", "secret"]);
const DESTRUCTIVE = /\b(rm\s+-rf|drop\s+(table|database)|delete\s+from|truncate|mkfs|shutdown|format\s|del\s+\/|:\(\)\{)/i;

/** Exposition (surface offerte) dérivée de l'autonomie + signaux de l'event. */
function exposureFor(agent: AgentInfo | undefined, ev: AgentEvent): number {
  const auton =
    agent?.autonomy_level === "autonomous"
      ? 0.7
      : agent?.autonomy_level === "act_with_approval"
        ? 0.5
        : 0.3;
  let e = auton;
  const sc = ev.security_context ?? {};
  if (sc.external_egress) e += 0.15;
  if (sc.untrusted_input_in_context) e += 0.1;
  if (ev.tool?.category && SENSITIVE_TOOL.has(ev.tool.category)) e += 0.05;
  return Math.min(1, e);
}

function impactForClass(c?: string): number {
  switch (c) {
    case "secret":
      return 0.95;
    case "pii":
      return 0.98;
    case "confidential":
      return 0.85;
    case "internal":
      return 0.5;
    default:
      return 0.3;
  }
}

function isSensitiveAction(ev: AgentEvent): boolean {
  const sc = ev.security_context ?? {};
  return (
    ev.type === "network_egress" ||
    sc.external_egress === true ||
    (ev.tool?.category != null && SENSITIVE_TOOL.has(ev.tool.category)) ||
    ev.type === "shell_exec" ||
    ev.type === "memory_write"
  );
}

type DetectorFn = (ev: AgentEvent, agent?: AgentInfo) => Candidate | null;

/** WGS-R04 — Exfiltration de données. */
const detectR04: DetectorFn = (ev, agent) => {
  const sc = ev.security_context ?? {};
  const isEgress = ev.type === "network_egress" || sc.external_egress === true;
  if (!isEgress) return null;
  if (!sc.data_classification || !SENSITIVE_CLASS.has(sc.data_classification)) return null;
  if (sc.destination_allowlisted !== false) return null; // doit être explicitement non allowlisté
  return {
    taxonomy_id: "WGS-R04",
    agent_id: ev.agent_id,
    factors: {
      likelihood: 0.95, // règle déterministe : l'egress a eu lieu vers destination non allowlistée
      impact: impactForClass(sc.data_classification),
      exposure: exposureFor(agent, ev),
    },
    confidence: 0.9,
    evidence: [
      {
        event_id: ev.event_id,
        signal: "data_classification∈{pii,confidential,secret} + external_egress + destination_allowlisted=false",
        observation: `Sortie ${sc.data_classification} vers ${sc.destination ?? "destination inconnue"} (non allowlistée).`,
      },
    ],
  };
};

/** WGS-R01 — Injection de prompt / manipulation d'intention. */
const detectR01: DetectorFn = (ev, agent) => {
  const sc = ev.security_context ?? {};
  const flags = ev.signals?.anomaly_flags ?? [];
  const knownBad = flags.some((f) => /known_bad_signature|known_cve|injection/i.test(f));
  if (!sc.untrusted_input_in_context && !knownBad) return null;
  const sensitive = isSensitiveAction(ev);
  return {
    taxonomy_id: "WGS-R01",
    agent_id: ev.agent_id,
    factors: {
      likelihood: knownBad ? 0.95 : sensitive ? 0.85 : 0.6,
      impact: 0.7,
      exposure: exposureFor(agent, ev),
    },
    confidence: knownBad ? 0.95 : sensitive ? 0.8 : 0.6,
    evidence: [
      {
        event_id: ev.event_id,
        signal: knownBad ? "anomaly_flags=known_bad/injection" : "untrusted_input_in_context=true",
        observation: knownBad
          ? "Signature connue d'injection/CVE détectée dans le contexte."
          : sensitive
            ? "Contenu externe non vérifié dans le contexte, suivi d'une action sensible."
            : "Contenu externe non vérifié présent dans le contexte.",
      },
    ],
  };
};

/** WGS-R03 — Exécution de code / shell non maîtrisée. */
const detectR03: DetectorFn = (ev, agent) => {
  const isExec = ev.type === "shell_exec" || ev.tool?.category === "code_exec";
  if (!isExec) return null;
  const params = JSON.stringify(ev.tool?.parameters ?? {});
  const destructive = DESTRUCTIVE.test(params) || DESTRUCTIVE.test(ev.tool?.name ?? "");
  return {
    taxonomy_id: "WGS-R03",
    agent_id: ev.agent_id,
    factors: {
      likelihood: 0.9,
      impact: destructive ? 0.95 : 0.6,
      exposure: exposureFor(agent, ev),
    },
    confidence: destructive ? 0.9 : 0.7,
    evidence: [
      {
        event_id: ev.event_id,
        signal: destructive ? "shell/code_exec + commande destructrice" : "shell/code_exec",
        observation: destructive
          ? `Commande potentiellement irréversible détectée (${ev.tool?.name ?? "shell"}).`
          : `Exécution de code/shell (${ev.tool?.name ?? "shell"}).`,
      },
    ],
  };
};

/** WGS-R02 — Agence excessive / mauvais usage d'outil (payment, secret_access). */
const detectR02: DetectorFn = (ev, agent) => {
  const cat = ev.tool?.category;
  if (cat !== "payment" && cat !== "secret_access") return null;
  return {
    taxonomy_id: "WGS-R02",
    agent_id: ev.agent_id,
    factors: {
      likelihood: 0.7,
      impact: 0.9,
      exposure: exposureFor(agent, ev),
    },
    confidence: 0.65,
    evidence: [
      {
        event_id: ev.event_id,
        signal: `tool.category=${cat}`,
        observation: `Usage d'un outil sensible (${ev.tool?.name ?? cat}) — vérifier qu'il est dans le profil de la tâche.`,
      },
    ],
  };
};

/** WGS-R05 — Empoisonnement mémoire. */
const detectR05: DetectorFn = (ev, agent) => {
  if (ev.type !== "memory_write") return null;
  if (ev.security_context?.untrusted_input_in_context !== true) return null;
  return {
    taxonomy_id: "WGS-R05",
    agent_id: ev.agent_id,
    factors: { likelihood: 0.85, impact: 0.7, exposure: exposureFor(agent, ev) },
    confidence: 0.8,
    evidence: [
      {
        event_id: ev.event_id,
        signal: "memory_write + untrusted_input_in_context=true",
        observation: "Écriture mémoire alimentée par du contenu non vérifié (provenance à exiger).",
      },
    ],
  };
};

/** WGS-R06 — Compromission d'identité / privilèges. */
const detectR06: DetectorFn = (ev, agent) => {
  const flags = ev.signals?.anomaly_flags ?? [];
  const hit = flags.some((f) => /priv|escalat|credential|spoof/i.test(f));
  if (!hit) return null;
  return {
    taxonomy_id: "WGS-R06",
    agent_id: ev.agent_id,
    factors: { likelihood: 0.8, impact: 0.9, exposure: exposureFor(agent, ev) },
    confidence: 0.75,
    evidence: [
      {
        event_id: ev.event_id,
        signal: `anomaly_flags=${flags.join(",")}`,
        observation: "Signal d'escalade de privilèges / réutilisation de credential.",
      },
    ],
  };
};

/** WGS-R07 — Abus de ressources / surcharge. */
const detectR07: DetectorFn = (ev, agent) => {
  const loop = ev.signals?.loop_depth ?? 0;
  const cost = ev.io?.cost_usd ?? 0;
  if (loop <= 12 && cost <= 5) return null;
  return {
    taxonomy_id: "WGS-R07",
    agent_id: ev.agent_id,
    factors: { likelihood: 0.9, impact: 0.4, exposure: Math.min(1, exposureFor(agent, ev)) },
    confidence: 0.85,
    evidence: [
      {
        event_id: ev.event_id,
        signal: loop > 12 ? `loop_depth=${loop}` : `cost_usd=${cost}`,
        observation: "Emballement de ressources (boucle profonde ou pic de coût).",
      },
    ],
  };
};

/** WGS-R11 — Chaîne d'approvisionnement / MCP non vérifié. */
const detectR11: DetectorFn = (ev, agent) => {
  const mcp = ev.tool?.mcp_server;
  if (!mcp) return null;
  return {
    taxonomy_id: "WGS-R11",
    agent_id: ev.agent_id,
    factors: { likelihood: 0.5, impact: 0.7, exposure: exposureFor(agent, ev) },
    confidence: 0.5,
    evidence: [
      {
        event_id: ev.event_id,
        signal: `tool.mcp_server=${mcp}`,
        observation: `Serveur MCP invoqué (${mcp}) — à vérifier contre l'allowlist supply-chain.`,
      },
    ],
  };
};

export const DETECTORS: DetectorFn[] = [
  detectR04,
  detectR01,
  detectR03,
  detectR02,
  detectR05,
  detectR06,
  detectR07,
  detectR11,
];

/** Lance tous les détecteurs sur un event. */
export function detectEvent(ev: AgentEvent, agent?: AgentInfo): Candidate[] {
  const out: Candidate[] = [];
  for (const d of DETECTORS) {
    const c = d(ev, agent);
    if (c) out.push(c);
  }
  return out;
}
