import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const RETIRED_N8N_WORKFLOWS = Object.freeze({
  "QF-MVP-50-01-Core-Job-Dispatcher.workflow.json": Object.freeze({
    commit: "a568d526461b3ac85c5245fcf5ccb97171f541bc",
    sha256: "9bc49e424a55fd93e24141172a185d58f60e6b5e7f4110f99ef4184174a4be47",
  }),
  "QF-MVP-50-01-Core-Job-Dispatcher.50.2B-selfhost-env.workflow.json": Object.freeze({
    commit: "c18bb49c2463447a6eeddec4372c050d0142dc45",
    sha256: "93f75377da159f6f64c5c816178df4e982e240cecee108d626e266dedcc4705c",
  }),
});

export function readRetiredWorkflow(fileName, encoding = "utf8") {
  const evidence = RETIRED_N8N_WORKFLOWS[fileName];
  if (!evidence) throw new Error(`UNKNOWN_RETIRED_N8N_WORKFLOW:${fileName}`);
  const spec = `${evidence.commit}:automation/n8n/${fileName}`;
  return execFileSync("git", ["show", spec], { cwd: ROOT, encoding });
}
