/**
 * Vérification DÉTERMINISTE du cœur Guardian — AUCUN appel API.
 * Teste le scoring (§5), les bandes de sévérité, et le pipeline complet sur la
 * fixture (exemple §13 : injection + exfiltration PII).
 *
 *   npm run selfcheck
 *
 * Sort en code 1 si une assertion échoue. À lancer en CI sans clé API.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreRisk, severityOf } from "./scoring.js";
import { analyzeExport, parseExport } from "./pipeline.js";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
  }
}

// 1. Scoring : exemple §13 → ~88 Critical.
const s = scoreRisk({ likelihood: 0.95, impact: 0.98, exposure: 0.95, blast_radius: 1 });
check("scoring §13 = 88", s.value === 88, `obtenu ${s.value}`);
check("scoring §13 severity critical", s.severity === "critical", s.severity);

// 2. Amplification fractale : blast_radius augmente le score (monotone), borné à 100.
const a1 = scoreRisk({ likelihood: 0.8, impact: 0.8, exposure: 0.8, blast_radius: 1 }).value;
const a8 = scoreRisk({ likelihood: 0.8, impact: 0.8, exposure: 0.8, blast_radius: 8 }).value;
check("blast_radius amplifie", a8 > a1, `${a1} -> ${a8}`);
check("score borné à 100", scoreRisk({ likelihood: 1, impact: 1, exposure: 1, blast_radius: 1000 }).value === 100);

// 3. Bandes de sévérité aux frontières.
check("band 85=critical", severityOf(85) === "critical");
check("band 84=high", severityOf(84) === "high");
check("band 64=medium", severityOf(64) === "medium");
check("band 39=low", severityOf(39) === "low");
check("band 14=info", severityOf(14) === "info");

// 4. Pipeline sur la fixture.
const path = resolve("fixtures/example-export.json");
const exp = parseExport(JSON.parse(readFileSync(path, "utf8")));
const res = analyzeExport(exp);

check("3 events analysés", res.summary.events_analyzed === 3, String(res.summary.events_analyzed));

const r04 = res.findings.find((f) => f.risk.taxonomy_id === "WGS-R04");
check("R04 détecté (exfiltration PII)", !!r04);
check("R04 score = 88", r04?.score.value === 88, String(r04?.score.value));
check("R04 severity critical", r04?.score.severity === "critical", r04?.score.severity);
check(
  "R04 propose un plancher block mandatory",
  !!r04?.suggested_policies.some((p) => p.mandatory && p.enforcement === "block"),
);
check("R04 porte une preuve (event_id)", (r04?.evidence.length ?? 0) > 0);

const r01 = res.findings.find((f) => f.risk.taxonomy_id === "WGS-R01");
check("R01 détecté (injection)", !!r01);

// 5. Findings triés par score décroissant.
const sorted = res.findings.every(
  (f, i, arr) => i === 0 || arr[i - 1].score.value >= f.score.value,
);
check("findings triés par sévérité", sorted);

console.log(`\n${failures === 0 ? "Selfcheck OK" : `Selfcheck ÉCHOUÉ (${failures})`}.`);
process.exit(failures === 0 ? 0 : 1);
