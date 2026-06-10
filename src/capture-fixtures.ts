// Capture de fixtures réelles d'events @openai/agents pour le SDK WatchMyAgents.
//
// Goal : produire 5 fichiers JSON capturant la forme RÉELLE des arguments
// passés aux listeners lifecycle de la SDK, qu'on copie ensuite dans
// `watchmyagents/test/fixtures/openai-agents-events/` pour remplacer les
// fixtures synthetic du test suite WMA.
//
// Stratégie :
//   Phase 1 — un vrai run Guardian (l'agent réel de ce repo) → fire
//             agent_start, agent_tool_start, agent_tool_end, agent_end
//   Phase 2 — mini setup à 2 agents avec handoff → fire agent_handoff
//
// Run :
//   npm run capture-fixtures
//   → produit fixtures/openai-events/agent_*.json
//
// Pré-requis : OPENAI_API_KEY dans .env, comme pour `npm run smoke`.

import "dotenv/config";
import { Agent, run, handoff, tool } from "@openai/agents";
import { z } from "zod";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { guardian } from "./agent.js";

const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "openai-events",
);

// ── Sérialisation safe ─────────────────────────────────────────────────
// Les args passés aux listeners contiennent souvent des class instances
// (Agent, Tool, RunContext) avec des refs cycliques ou des méthodes. On
// les convertit en plain objects pour pouvoir les JSON.stringify-er.

function safeSerialize(v: unknown, seen = new WeakSet<object>()): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === "function") return `[function ${v.name || "<anon>"}]`;
  if (typeof v !== "object") return v;

  // Cyclic ref guard
  const obj = v as object;
  if (seen.has(obj)) return "[circular]";
  seen.add(obj);

  if (Array.isArray(v)) return v.map((x) => safeSerialize(x, seen));

  // Errors get a flattened representation
  if (v instanceof Error) {
    return { __type: "Error", name: v.name, message: v.message };
  }

  // Regular object — walk own keys only
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    // Skip private/symbol-keyed internals that won't serialize anyway
    if (k.startsWith("_")) continue;
    out[k] = safeSerialize(val, seen);
  }
  // Preserve class name so the fixture is self-describing
  const ctor = (v as { constructor?: { name?: string } }).constructor;
  if (ctor?.name && ctor.name !== "Object") {
    out.__type = ctor.name;
  }
  return out;
}

// ── État de capture (premier événement de chaque type gagne) ───────────

const captured: Record<string, boolean> = {};

async function captureEvent(event: string, args: unknown[]) {
  if (captured[event]) return;
  captured[event] = true;

  const payload = {
    event,
    args: args.map((a) => safeSerialize(a)),
    meta: {
      node_version: process.version,
      captured_at: new Date().toISOString(),
      capture_script: "src/capture-fixtures.ts",
      source_repo: "minedorfbm/openai-agent-sdk-test",
      // sdk_version est patché en fin de run, voir main().
    },
  };
  const path = join(OUT_DIR, `${event}.json`);
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`[capture] ${event}.json (${args.length} args)`);
}

// ── Récupération de la version SDK installée ──────────────────────────

async function loadSdkVersion(): Promise<string> {
  try {
    // Chemin résolu depuis node_modules — robuste aux symlinks pnpm
    const url = (import.meta as { resolve?: (s: string) => string }).resolve?.(
      "@openai/agents/package.json",
    );
    if (!url) return "unknown";
    const path = fileURLToPath(url);
    const json = JSON.parse(await readFile(path, "utf8"));
    return json.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ── Phase 1 : run réel Guardian → capture 4 events ─────────────────────

async function phase1_guardianRun() {
  console.log(`\n=== Phase 1 : run Guardian (réel) ===`);
  console.log(`Modèle : ${process.env.OPENAI_AGENT_MODEL ?? "gpt-5.4"}`);

  // Attache les listeners AU NIVEAU AGENT — c'est le pattern AgentHooks
  // dispatché par @openai/agents quand on utilise run() (convenience)
  // plutôt que new Runner().
  guardian.on("agent_start", (...args) => void captureEvent("agent_start", args));
  guardian.on("agent_end", (...args) => void captureEvent("agent_end", args));
  guardian.on("agent_tool_start", (...args) => void captureEvent("agent_tool_start", args));
  guardian.on("agent_tool_end", (...args) => void captureEvent("agent_tool_end", args));

  const exportPath = resolve("fixtures/example-export.json");
  if (!existsSync(exportPath)) {
    throw new Error(
      `Fixture introuvable : ${exportPath}. Lance npm run capture-fixtures depuis la racine du repo.`,
    );
  }

  console.log(`Export : ${exportPath}\n`);

  const result = await run(
    guardian,
    `Analyse l'export d'actions situé ici : ${exportPath}. Produis un rapport Guardian concis.`,
  );

  console.log("\n[phase 1] rapport (extrait):");
  console.log(((result.finalOutput as string) ?? "").slice(0, 200) + "…");
}

// ── Phase 2 : mini setup à 2 agents → capture agent_handoff ────────────

const escalationBot = new Agent({
  name: "fixture_capture_escalation",
  model: process.env.OPENAI_AGENT_MODEL ?? "gpt-5.4",
  instructions: "Tu confirmes la prise en charge en français : « Escalade reçue, je traite. »",
  tools: [],
});

const triageTool = tool({
  name: "noop_triage",
  description: "Marque le ticket comme triage. À appeler une seule fois avant le handoff.",
  parameters: z.object({ reason: z.string() }),
  async execute({ reason }) {
    return JSON.stringify({ ok: true, reason });
  },
});

const triageBot = new Agent({
  name: "fixture_capture_triage",
  model: process.env.OPENAI_AGENT_MODEL ?? "gpt-5.4",
  instructions: [
    "Tu reçois une réclamation client. Méthode :",
    "1. Appelle noop_triage(reason) avec un court motif.",
    "2. Fais ensuite obligatoirement un handoff vers fixture_capture_escalation.",
  ].join("\n"),
  tools: [triageTool],
  handoffs: [handoff(escalationBot)],
});

async function phase2_handoffRun() {
  console.log(`\n=== Phase 2 : handoff (mini setup) ===`);

  // Attache listener pour TOUS les events sur le triageBot — agent_handoff
  // est l'objectif principal, les 4 autres servent de filet de sécurité
  // si Phase 1 a raté un event (model trip).
  triageBot.on("agent_handoff", (...args) => void captureEvent("agent_handoff", args));
  triageBot.on("agent_start", (...args) => void captureEvent("agent_start", args));
  triageBot.on("agent_end", (...args) => void captureEvent("agent_end", args));
  triageBot.on("agent_tool_start", (...args) => void captureEvent("agent_tool_start", args));
  triageBot.on("agent_tool_end", (...args) => void captureEvent("agent_tool_end", args));

  const result = await run(
    triageBot,
    "Plainte: l'app me déconnecte toutes les 5 minutes depuis ce matin. C'est inacceptable, je veux parler à un superviseur immédiatement.",
  );

  console.log("\n[phase 2] rapport (extrait):");
  console.log(((result.finalOutput as string) ?? "").slice(0, 200) + "…");
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Erreur : OPENAI_API_KEY manquante. Copie .env.example en .env.");
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const sdkVersion = await loadSdkVersion();
  console.log(`[capture] OUT_DIR     : ${OUT_DIR}`);
  console.log(`[capture] SDK version : ${sdkVersion}`);
  console.log(`[capture] Node        : ${process.version}`);

  await phase1_guardianRun();

  const phase1Needed = ["agent_start", "agent_tool_start", "agent_tool_end", "agent_end"];
  const phase1Missing = phase1Needed.filter((e) => !captured[e]);
  if (phase1Missing.length > 0) {
    console.warn(
      `\n[capture] WARN : Phase 1 a raté ${phase1Missing.join(", ")} — Phase 2 va essayer en filet.`,
    );
  }

  await phase2_handoffRun();

  // Patch sdk_version dans toutes les fixtures écrites
  for (const evt of ["agent_start", "agent_end", "agent_handoff", "agent_tool_start", "agent_tool_end"]) {
    if (!captured[evt]) continue;
    const path = join(OUT_DIR, `${evt}.json`);
    const json = JSON.parse(await readFile(path, "utf8"));
    json.meta.sdk_version = sdkVersion;
    await writeFile(path, JSON.stringify(json, null, 2) + "\n", "utf8");
  }

  // Récap final
  console.log(`\n=== Récap ===`);
  const all = ["agent_start", "agent_end", "agent_handoff", "agent_tool_start", "agent_tool_end"];
  for (const e of all) {
    console.log(`  ${captured[e] ? "✓" : "✗"} ${e}.json`);
  }

  const missing = all.filter((e) => !captured[e]);
  if (missing.length > 0) {
    console.error(`\n[capture] ${missing.length} event(s) manquant(s). Re-run ou ajuste les prompts.`);
    process.exit(2);
  }

  console.log(`\n[capture] OK — 5 fixtures dans ${OUT_DIR}`);
  console.log(`[capture] Étape suivante : copie dans le SDK WMA :`);
  console.log(`  cp ${OUT_DIR}/*.json /Users/minedorfbm/Desktop/REPOSITORIES/watchmyagents-1/test/fixtures/openai-agents-events/`);
}

main().catch((err) => {
  console.error("[capture] échec:", err);
  process.exit(1);
});
