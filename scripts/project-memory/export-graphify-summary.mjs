import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const reportPath = resolve(root, "graphify-out/GRAPH_REPORT.md");
const outputPath = resolve(root, "docs/project-memory/GRAPHIFY_SUMMARY.md");
const report = readFileSync(reportPath, "utf8");

const summary = report.match(/-\s*([\d,]+) nodes · ([\d,]+) edges · ([\d,]+) communities/i);
const corpus = report.match(/-\s*([\d,]+) files · ~([\d,]+) words/i);
const commit = report.match(/Built from commit:\s*`([^`]+)`/i);
if (!summary || !corpus || !commit) {
  throw new Error("Unable to parse Graphify report summary");
}

const [nodes, edges, communities] = summary.slice(1);
const [files, words] = corpus.slice(1);
const generated = new Date().toISOString();
const content = `# Graphify Repository Intelligence Snapshot

Generated: ${generated}
Built from commit: \`${commit[1]}\`
Mode: local deterministic repository extraction; generated graph artifacts remain ignored from Git.

## Current graph

- Nodes: **${nodes}**
- Edges: **${edges}**
- Communities: **${communities}**
- Corpus files: **${files}**
- Approximate corpus words: **${words}**
`;
const tail = `
## Use from ChatGPT

Use this snapshot for repository scale and architecture context. For exact implementation claims, inspect the current source files and Git history. For temporal decisions, use the Graphiti snapshots and canonical project-memory documents.

Graphify is derived repository intelligence and never overrides independently verified runtime state, current deployed code, or reviewed canonical business decisions.
`;

writeFileSync(outputPath, content + tail, "utf8");
console.log(`GRAPHIFY_SUMMARY_EXPORT=PASS (${nodes} nodes, ${edges} edges, ${communities} communities)`);
