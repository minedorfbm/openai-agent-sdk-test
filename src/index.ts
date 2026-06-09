import "dotenv/config";
import { run } from "@openai/agents";
import { assistant, MODEL } from "./agent.js";

/**
 * Point d'entree CLI : passe ta question en argument, ou lance sans argument
 * pour utiliser la question de demo.
 *
 *   npm start -- "Quelle heure est-il a Paris ?"
 */
async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Erreur : OPENAI_API_KEY manquante. Copie .env.example en .env.");
    process.exit(1);
  }

  const question =
    process.argv.slice(2).join(" ").trim() ||
    "Combien font 12 % de 250, et quelle est la date d'aujourd'hui ?";

  console.log(`Modele : ${MODEL}`);
  console.log(`Question : ${question}\n`);

  const result = await run(assistant, question);
  console.log("Reponse :\n" + result.finalOutput);
}

main().catch((err) => {
  console.error("Echec de l'execution :", err);
  process.exit(1);
});
