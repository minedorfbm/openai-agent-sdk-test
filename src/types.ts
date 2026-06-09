/**
 * Schémas zod du contrat d'entrée Guardian (action-export.schema.json, subset
 * utilisé par les détecteurs) et types de sortie (risk-finding.schema.json).
 * On reste permissif (passthrough) : on ne valide que ce dont on a besoin.
 */
import { z } from "zod";

export const AGENT_TYPES = [
  "coding",
  "devops_infra",
  "data_rag",
  "customer_facing",
  "browser_web",
  "orchestrator",
  "workflow_backoffice",
  "personal_assistant",
  "transactional_financial",
  "generic",
] as const;

export const EVENT_TYPES = [
  "llm_call",
  "tool_call",
  "shell_exec",
  "file_access",
  "network_egress",
  "memory_read",
  "memory_write",
  "agent_handoff",
  "user_message",
  "decision",
  "policy_event",
] as const;

export const TOOL_CATEGORIES = [
  "code_exec",
  "file_io",
  "http",
  "database",
  "browser",
  "email",
  "payment",
  "secret_access",
  "search",
  "other",
] as const;

export const DATA_CLASSIFICATIONS = [
  "public",
  "internal",
  "confidential",
  "pii",
  "secret",
] as const;

const securityContext = z
  .object({
    auth_principal: z.string().optional(),
    permissions_used: z.array(z.string()).optional(),
    data_classification: z.enum(DATA_CLASSIFICATIONS).optional(),
    destination: z.string().optional(),
    destination_allowlisted: z.boolean().optional(),
    external_egress: z.boolean().optional(),
    untrusted_input_in_context: z.boolean().optional(),
  })
  .partial();

const eventSchema = z
  .object({
    event_id: z.string(),
    timestamp: z.string(),
    agent_id: z.string(),
    session_id: z.string().optional(),
    trace_id: z.string().optional(),
    span_id: z.string().optional(),
    parent_span_id: z.string().optional(),
    type: z.enum(EVENT_TYPES),
    tool: z
      .object({
        name: z.string().optional(),
        category: z.enum(TOOL_CATEGORIES).optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
        mcp_server: z.string().optional(),
      })
      .partial()
      .optional(),
    io: z
      .object({
        input_tokens: z.number().optional(),
        output_tokens: z.number().optional(),
        cost_usd: z.number().optional(),
        prompt_digest: z.string().optional(),
        output_digest: z.string().optional(),
      })
      .partial()
      .optional(),
    result: z.object({
      status: z.enum(["success", "error", "blocked", "timeout", "denied"]),
      duration_ms: z.number().optional(),
      error_code: z.string().optional(),
    }),
    security_context: securityContext.optional(),
    signals: z
      .object({
        drift_score: z.number().optional(),
        loop_depth: z.number().optional(),
        anomaly_flags: z.array(z.string()).optional(),
      })
      .partial()
      .optional(),
  })
  .passthrough();

const agentSchema = z
  .object({
    agent_id: z.string(),
    agent_type: z.enum(AGENT_TYPES),
    modifiers: z
      .array(z.enum(["autonomy", "untrusted_input", "data_sensitivity", "regulated"]))
      .optional(),
    model: z.string().optional(),
    autonomy_level: z
      .enum(["suggest", "act_with_approval", "autonomous"])
      .optional(),
  })
  .passthrough();

export const actionExportSchema = z
  .object({
    schema_version: z.literal("1.0"),
    export: z
      .object({
        export_id: z.string(),
        generated_at: z.string(),
        source: z.string().optional(),
        time_window: z.object({ start: z.string(), end: z.string() }),
        redaction_level: z
          .enum(["none", "pii_masked", "params_hashed", "full"])
          .optional(),
      })
      .passthrough(),
    fractal_context: z
      .object({
        tenant_id: z.string(),
        fleet_id: z.string(),
        teams: z.array(z.unknown()).optional(),
        agents: z.array(agentSchema).optional(),
      })
      .passthrough(),
    events: z.array(eventSchema),
  })
  .passthrough();

export type ActionExport = z.infer<typeof actionExportSchema>;
export type AgentEvent = z.infer<typeof eventSchema>;
export type AgentInfo = z.infer<typeof agentSchema>;

// --- Sortie : risk-finding (subset conforme à risk-finding.schema.json) ---

export type RiskCategory =
  | "prompt_injection"
  | "excessive_agency"
  | "tool_misuse"
  | "data_exfiltration"
  | "memory_poisoning"
  | "identity_privilege"
  | "resource_abuse"
  | "cascading_failure"
  | "supply_chain"
  | "human_trust"
  | "drift_misalignment";

export interface SuggestedPolicy {
  policy_id: string;
  objective: string;
  target_metric?: string;
  target_value?: string;
  enforcement:
    | "monitor"
    | "warn"
    | "throttle"
    | "require_approval"
    | "block"
    | "isolate";
  mandatory?: boolean;
}

export interface Evidence {
  event_id: string;
  signal: string;
  observation: string;
}

export interface RiskFinding {
  finding_id: string;
  detected_at: string;
  fractal_level: "agent" | "team" | "fleet" | "global";
  scope_ref: {
    agent_id?: string;
    team_id?: string;
    fleet_id?: string;
    tenant_id?: string;
  };
  risk: {
    taxonomy_id: string;
    owasp_ref?: string;
    title: string;
    category: RiskCategory;
  };
  score: {
    value: number;
    severity: "info" | "low" | "medium" | "high" | "critical";
    confidence: number;
    factors: {
      likelihood: number;
      impact: number;
      exposure: number;
      blast_radius: number;
    };
  };
  evidence: Evidence[];
  suggested_policies: SuggestedPolicy[];
  status: "open" | "suggested" | "accepted" | "deployed" | "rejected" | "resolved";
}
