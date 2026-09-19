import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const memoryDir = resolve(root, "docs/project-memory");
const timelinePath = resolve(memoryDir, "GRAPHITI_TIMELINE.md");
const factsPath = resolve(memoryDir, "GRAPHITI_CURRENT_FACTS.md");
const groupId = "quickfurno-marketplace";
const generated = new Date().toISOString();

function jsonBlocks(text) {
  return [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((match) => JSON.parse(match[1]));
}

const timelineBlocks = jsonBlocks(readFileSync(timelinePath, "utf8"));
const episodes = timelineBlocks[0]?.episodes ?? [];
const timeline = [
  "# Graphiti Timeline Snapshot",
  "",
  `Generated: ${generated}`,
  `Group: \`${groupId}\``,
  "",
  "Reviewed temporal episodes exported from the local Graphiti service. Canonical docs and independently verified live state remain higher authority.",
  "",
  "## Episodes",
  "",
];
for (const episode of episodes) {
  const when = episode.valid_at ?? episode.created_at ?? "unknown-time";
  const content = String(episode.content ?? "").replace(/\s+/g, " ").trim();
  timeline.push(`- **${episode.name}** — ${when} — ${content}`);
}
writeFileSync(timelinePath, `${timeline.join("\n")}\n`, "utf8");

const factBlocks = jsonBlocks(readFileSync(factsPath, "utf8"));
const factMap = new Map();
for (const block of factBlocks) {
  for (const fact of block.facts ?? []) {
    const statement = String(fact.fact ?? "").replace(/\s+/g, " ").trim();
    if (statement && !factMap.has(statement)) factMap.set(statement, fact);
  }
}
const facts = [...factMap.values()].sort((a, b) =>
  String(b.valid_at ?? b.created_at ?? "").localeCompare(String(a.valid_at ?? a.created_at ?? "")),
);
const current = [
  "# Graphiti Current Facts Snapshot",
  "",
  `Generated: ${generated}`,
  `Group: \`${groupId}\``,
  "",
  "Deduplicated search-derived temporal facts for ChatGPT retrieval. These are derived memory, not operational authority.",
  "",
  "## Facts",
  "",
];
for (const fact of facts) {
  const when = fact.valid_at ?? fact.created_at ?? "unknown-time";
  const relation = fact.name ? ` [${fact.name}]` : "";
  current.push(`- ${when}${relation} — ${fact.fact}`);
}
writeFileSync(factsPath, `${current.join("\n")}\n`, "utf8");

console.log(
  `GRAPHITI_SNAPSHOT_COMPACT=PASS (${episodes.length} episodes, ${facts.length} deduplicated facts)`,
);
