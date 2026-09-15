import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const required = [
  "docs/project-memory/README.md",
  "docs/project-memory/CURRENT_STATE.md",
  "docs/project-memory/ARCHITECTURE.md",
  "docs/project-memory/BUSINESS_RULES.md",
  "docs/project-memory/DECISIONS.md",
  "docs/project-memory/OPEN_ITEMS.md",
  "docs/project-memory/DEPLOYMENTS.md",
  "docs/project-memory/INCIDENTS.md",
  "docs/project-memory/INTEGRATIONS.md",
  "docs/project-memory/MEMORY_PROTOCOL.md",
  "docs/project-memory/GRAPH_STACK.md",
  "docs/project-memory/CHATGPT_ACCESS.md",
  "docs/project-memory/GRAPHIFY_SUMMARY.md",
  "docs/project-memory/GRAPHITI_CURRENT_FACTS.md",
  "docs/project-memory/GRAPHITI_TIMELINE.md",
  "scripts/project-memory/graphiti_bridge.py",
  "scripts/project-memory/export-graphify-summary.mjs",
  "scripts/project-memory/compact-graphiti-snapshots.mjs",
  "scripts/project-memory/refresh.ps1",
  "scripts/project-memory/publish.ps1",
  "infra/project-brain/docker-compose.yml",
  "infra/project-brain/start-local.ps1",
];
const errors = [];
for (const file of required) {
  if (!existsSync(resolve(root, file))) errors.push(`missing required file: ${file}`);
}

const text = (file) => readFileSync(resolve(root, file), "utf8");
if (errors.length === 0) {
  const current = text("docs/project-memory/CURRENT_STATE.md");
  const rules = text("docs/project-memory/BUSINESS_RULES.md");
  const protocol = text("docs/project-memory/MEMORY_PROTOCOL.md");
  const readme = text("docs/project-memory/README.md");
  const chatgpt = text("docs/project-memory/CHATGPT_ACCESS.md");
  const facts = text("docs/project-memory/GRAPHITI_CURRENT_FACTS.md");
  const timeline = text("docs/project-memory/GRAPHITI_TIMELINE.md");
  const graphify = text("docs/project-memory/GRAPHIFY_SUMMARY.md");
  const gitignore = text(".gitignore");

  const checks = [
    ["source commit explicit", /Source commit:\s*`[0-9a-f]{40}`/.test(current)],
    ["Pune-only launch", /Pune only/i.test(current) && /Pune only/i.test(rules)],
    ["runtime verification", /independent/i.test(rules) && /runtime/i.test(rules)],
    ["live state highest authority", /verified live production\/database state/i.test(readme)],
    ["Graphiti contextual only", /Graphiti/i.test(protocol) && /authority/i.test(protocol)],
    ["Graphify contextual only", /Graphify/i.test(protocol) && /authority/i.test(protocol)],
    ["ChatGPT access documented", /ChatGPT/i.test(chatgpt) && /GitHub/i.test(chatgpt)],
    ["Graphiti Pune fact exported", /Pune only/i.test(facts)],
    ["Graphiti timeline exported", /QF-DEC-001 Unified Project Brain v1/i.test(timeline)],
    ["Graphify snapshot exported", /Nodes:\s*\*\*[\d,]+\*\*/i.test(graphify) && /Edges:\s*\*\*[\d,]+\*\*/i.test(graphify) && /Communities:\s*\*\*[\d,]+\*\*/i.test(graphify)],
    ["secrets forbidden", /secrets/i.test(rules) && /secrets/i.test(protocol)],
    ["Graphify output ignored", /graphify-out\//i.test(gitignore)],
    ["Graphiti runtime ignored", /infra\/project-brain\/runtime\//i.test(gitignore)],
    ["Neo4j password ignored", /\.neo4j-password/i.test(gitignore)],
  ];
  for (const [name, ok] of checks) {
    if (!ok) errors.push(`failed invariant: ${name}`);
  }
}

if (errors.length) {
  console.error("QuickFurno Project Brain verification FAILED");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`QuickFurno Project Brain verification PASS (${required.length} required files)`);
