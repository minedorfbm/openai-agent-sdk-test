import "dotenv/config";
import { watch, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { join, resolve, basename, extname } from "node:path";
import { run } from "@openai/agents";
import { guardian, MODEL } from "./agent.js";
import { analyzeExport, parseExport } from "./pipeline.js";

/**
 * Mode dossier surveillé : dépose un export JSON dans `exports/`, il est analysé
 * automatiquement.
 *
 *   npm run watch
 *
 * Pour chaque fichier .json déposé :
 *  - validation + pipeline déterministe → `exports/processed/<nom>.findings.json`
 *  - si OPENAI_API_KEY est présente : rapport rédigé → `exports/processed/<nom>.report.md`
 *  - le fichier source est déplacé dans `exports/processed/` (marqué traité).
 *
 * Dossier configurable via EXPORTS_DIR (défaut: ./exports).
 */
const EXPORTS_DIR = resolve(process.env.EXPORTS_DIR ?? "exports");
const PROCESSED_DIR = join(EXPORTS_DIR, "processed");

const inFlight = new Set<string>();

function ensureDirs() {
  if (!existsSync(EXPORTS_DIR)) mkdirSync(EXPORTS_DIR, { recursive: true });
  if (!existsSync(PROCESSED_DIR)) mkdirSync(PROCESSED_DIR, { recursive: true });
}

async function processFile(name: string) {
  const src = join(EXPORTS_DIR, name);
  if (inFlight.has(name) || !existsSync(src)) return;
  inFlight.add(name);

  const stamp = new Date().toISOString();
  const stem = basename(name, ".json");
  try {
    const raw = JSON.parse(readFileSync(src, "utf8"));
    const exp = parseExport(raw); // rejette schema_version inconnue
    const result = analyzeExport(exp);

    // 1) findings déterministes (toujours, sans API)
    writeFileSync(
      join(PROCESSED_DIR, `${stem}.findings.json`),
      JSON.stringify(result, null, 2),
    );

    const sev = Object.entries(result.summary.by_severity)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    console.log(
      `[${stamp}] ${name} → ${result.summary.findings} finding(s) [${sev || "aucun"}], ${result.summary.events_analyzed} events`,
    );

    // 2) rapport rédigé par l'agent (si clé dispo)
    if (process.env.OPENAI_API_KEY) {
      const r = await run(
        guardian,
        `Analyse l'export situé ici : ${src}. Produis le rapport Guardian.`,
      );
      writeFileSync(join(PROCESSED_DIR, `${stem}.report.md`), r.finalOutput ?? "");
      console.log(`           rapport → processed/${stem}.report.md`);
    } else {
      console.log("           (OPENAI_API_KEY absente : findings JSON seulement, pas de rapport rédigé)");
    }

    // 3) marque le fichier comme traité
    renameSync(src, join(PROCESSED_DIR, name));
  } catch (err) {
    console.error(`[${stamp}] ${name} → ERREUR : ${(err as Error).message}`);
    // on déplace quand même pour ne pas boucler sur un fichier invalide
    try {
      renameSync(src, join(PROCESSED_DIR, `${stem}.invalid.json`));
    } catch {
      /* ignore */
    }
  } finally {
    inFlight.delete(name);
  }
}

function isExportFile(name: string) {
  return extname(name).toLowerCase() === ".json";
}

async function main() {
  ensureDirs();
  console.log(`Guardian watcher — modèle ${MODEL}`);
  console.log(`Surveille : ${EXPORTS_DIR}`);
  console.log(`Résultats : ${PROCESSED_DIR}\n`);

  // Traite les fichiers déjà présents au démarrage.
  for (const name of readdirSync(EXPORTS_DIR)) {
    if (isExportFile(name)) await processFile(name);
  }

  // Surveille les nouveaux dépôts (debounce pour laisser l'écriture se finir).
  const timers = new Map<string, NodeJS.Timeout>();
  watch(EXPORTS_DIR, (_event, filename) => {
    if (!filename || !isExportFile(filename)) return;
    const name = filename.toString();
    clearTimeout(timers.get(name));
    timers.set(
      name,
      setTimeout(() => {
        timers.delete(name);
        void processFile(name);
      }, 400),
    );
  });

  console.log("En attente de nouveaux exports… (Ctrl-C pour arrêter)");
}

main().catch((err) => {
  console.error("Watcher arrêté :", err);
  process.exit(1);
});
