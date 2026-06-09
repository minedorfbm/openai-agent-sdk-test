import "dotenv/config";
import { resolve } from "node:path";
import { run } from "@openai/agents";
import { guardian, MODEL } from "./agent.js";

/**
 * Smoke test de l'agent Guardian (vrais appels API). Vérifie que l'agent
 * analyse la fixture et restitue les risques attendus. Sort en code 1 si échec.
 *
 *   npm run smoke
 *
 * NB : le cœur déterministe est testé sans API par `npm run selfcheck`.
 */
const TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout après ${ms} ms`)), ms),
    ),
  ]);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Erreur : OPENAI_API_KEY manquante. Copie .env.example en .env.");
    process.exit(1);
  }

  console.log(`Smoke test Guardian — modèle ${MODEL}\n`);
  const path = resolve("fixtures/example-export.json");
  const started = Date.now();

  try {
    const result = await withTimeout(
      run(guardian, `Analyse l'export situé ici : ${path}. Produis le rapport Guardian.`),
      TIMEOUT_MS,
    );
    const out = (result.finalOutput ?? "").trim();
    const ms = Date.now() - started;

    if (out.length === 0) {
      console.log(`FAIL  rapport vide (${ms} ms)`);
      process.exit(1);
    }

    // L'agent doit retrouver l'exfiltration PII (R04) — le risque critique de la fixture.
    const lower = out.toLowerCase();
    const mentionsR04 =
      lower.includes("r04") || lower.includes("exfiltrat") || lower.includes("collect.example");
    const mentionsCritical = lower.includes("critical") || lower.includes("critique") || out.includes("88");

    console.log(`PASS  rapport produit (${ms} ms, ${out.length} car.)`);
    console.log(`${mentionsR04 ? "PASS" : "FAIL"}  mentionne l'exfiltration / R04`);
    console.log(`${mentionsCritical ? "PASS" : "FAIL"}  signale la sévérité critique`);
    console.log("\n--- extrait du rapport ---\n" + out.slice(0, 600));

    if (!mentionsR04 || !mentionsCritical) {
      console.error("\nSmoke test ÉCHOUÉ — l'agent n'a pas restitué le risque critique attendu.");
      process.exit(1);
    }
    console.log("\nSmoke test OK.");
  } catch (err) {
    console.log(`FAIL  ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Erreur inattendue :", err);
  process.exit(1);
});
