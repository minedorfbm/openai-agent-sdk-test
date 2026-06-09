import "dotenv/config";
import { run } from "@openai/agents";
import { assistant, MODEL } from "./agent.js";

/**
 * Smoke test : lance l'agent sur plusieurs entrees et verifie qu'il repond
 * sans erreur. Ce n'est PAS un test de qualite des reponses, juste un controle
 * "ca tourne" a faire avant un deploiement en prod.
 *
 *   npm run smoke
 *
 * Sortie : code 0 si tout passe, code 1 si au moins un cas echoue.
 */

interface Case {
  name: string;
  input: string;
  /** Verifications optionnelles sur la reponse finale. */
  expect?: (output: string) => boolean;
}

const cases: Case[] = [
  {
    name: "Reponse simple",
    input: "Dis bonjour en une phrase.",
  },
  {
    name: "Outil calculator",
    input: "Combien font 12 % de 250 ?",
    expect: (o) => o.includes("30"),
  },
  {
    name: "Outil get_current_time",
    input: "Quelle est la date d'aujourd'hui ?",
  },
  {
    name: "Langue : anglais",
    input: "Reply in English: what is 2 + 2?",
    expect: (o) => o.includes("4"),
  },
];

const TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout apres ${ms} ms`)), ms),
    ),
  ]);
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Erreur : OPENAI_API_KEY manquante. Copie .env.example en .env.");
    process.exit(1);
  }

  console.log(`Smoke test — modele ${MODEL} — ${cases.length} cas\n`);

  let failures = 0;

  for (const c of cases) {
    const started = Date.now();
    try {
      const result = await withTimeout(run(assistant, c.input), TIMEOUT_MS);
      const output = (result.finalOutput ?? "").trim();
      const ms = Date.now() - started;

      if (output.length === 0) {
        failures++;
        console.log(`FAIL  ${c.name} (${ms} ms) — reponse vide`);
        continue;
      }
      if (c.expect && !c.expect(output)) {
        failures++;
        console.log(
          `FAIL  ${c.name} (${ms} ms) — verification non satisfaite\n      reponse: ${output.slice(0, 120)}`,
        );
        continue;
      }
      console.log(`PASS  ${c.name} (${ms} ms) — ${output.slice(0, 80).replace(/\n/g, " ")}`);
    } catch (err) {
      failures++;
      const ms = Date.now() - started;
      console.log(`FAIL  ${c.name} (${ms} ms) — ${(err as Error).message}`);
    }
  }

  console.log(`\n${cases.length - failures}/${cases.length} cas reussis.`);
  if (failures > 0) {
    console.error("Smoke test ECHOUE — ne pas deployer.");
    process.exit(1);
  }
  console.log("Smoke test OK.");
}

main().catch((err) => {
  console.error("Erreur inattendue :", err);
  process.exit(1);
});
