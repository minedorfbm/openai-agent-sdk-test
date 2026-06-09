import "dotenv/config";
import { resolve } from "node:path";
import { run } from "@openai/agents";
import { guardian, MODEL } from "./agent.js";

/**
 * CLI : analyse un export d'actions avec l'agent Guardian.
 *
 *   npm start -- fixtures/example-export.json
 *
 * Sans argument, utilise la fixture de démo (exemple §13 : injection + exfil PII).
 */
async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Erreur : OPENAI_API_KEY manquante. Copie .env.example en .env.");
    process.exit(1);
  }

  const path = resolve(process.argv[2] ?? "fixtures/example-export.json");

  console.log(`Modèle : ${MODEL}`);
  console.log(`Export : ${path}\n`);

  const result = await run(
    guardian,
    `Analyse l'export d'actions situé ici : ${path}. Produis le rapport Guardian.`,
  );
  console.log(result.finalOutput);
}

main().catch((err) => {
  console.error("Échec de l'analyse :", err);
  process.exit(1);
});
