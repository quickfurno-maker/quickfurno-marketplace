import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  AUTOMATION_STUDIO_WORKFLOW_KEYS,
  cloneAutomationStudioDefinition,
  simulateAutomationStudioDefinition,
  validateAutomationStudioDefinition,
} from "../../../lib/automation/studioContract.ts";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

for (const key of AUTOMATION_STUDIO_WORKFLOW_KEYS) {
  test(`default ${key} validates`, () => {
    assert.deepEqual(validateAutomationStudioDefinition(cloneAutomationStudioDefinition(key)), { ok: true });
  });
}
test("locked Core node cannot be removed", () => {
  const definition = cloneAutomationStudioDefinition("client_journey");
  definition.nodes = definition.nodes.filter((node) => node.id !== "client-credit");
  const result = validateAutomationStudioDefinition(definition);
  assert.equal(result.ok, false);
});

test("locked Core node cannot be modified", () => {
  const definition = cloneAutomationStudioDefinition("client_journey");
  definition.nodes.find((node) => node.id === "client-match").label = "Skip MatchCore";
  const result = validateAutomationStudioDefinition(definition);
  assert.equal(result.ok, false);
});

test("critical Core path cannot be bypassed", () => {
  const definition = cloneAutomationStudioDefinition("client_journey");
  definition.edges.push({ id: "bypass", from: "client-quality", to: "client-assign" });
  const result = validateAutomationStudioDefinition(definition);
  assert.equal(result.ok, false);
});

test("unapproved WhatsApp action is rejected", () => {
  const definition = cloneAutomationStudioDefinition("recovery");
  definition.nodes.push({ id: "bad-wa", kind: "whatsapp", label: "Bad Send", description: "No certified action", authority: "editable_policy", enabled: true, x: 20, y: 520, actionType: "vendor.lead_offer" });
  definition.edges.push({ id: "bad-edge", from: "recovery-stop", to: "bad-wa" });
  const result = validateAutomationStudioDefinition(definition);
  assert.equal(result.ok, false);
});
test("editable branch requires Yes and No paths", () => {
  const definition = cloneAutomationStudioDefinition("vendor_journey");
  definition.nodes.push({ id: "custom-branch", kind: "branch", label: "Custom Branch", description: "Safe policy branch", authority: "editable_policy", enabled: true, x: 300, y: 560 });
  definition.edges.push({ id: "branch-in", from: "vendor-credit", to: "custom-branch" });
  definition.edges.push({ id: "branch-yes", from: "custom-branch", to: "vendor-stop", outcome: "yes", label: "Yes" });
  const result = validateAutomationStudioDefinition(definition);
  assert.equal(result.ok, false);
});

test("cycles are rejected", () => {
  const definition = cloneAutomationStudioDefinition("orphan_cleanup");
  definition.edges.push({ id: "cycle", from: "orphan-stop", to: "orphan-select" });
  const result = validateAutomationStudioDefinition(definition);
  assert.equal(result.ok, false);
});

test("simulation remains non-mutating by contract", () => {
  const result = simulateAutomationStudioDefinition(cloneAutomationStudioDefinition("client_journey"));
  assert.equal(result.ok, true);
  assert.ok(result.notes.some((note) => note.includes("no database mutation")));
});

test("Studio is bound to the native engine runtime", () => {
  const source = fs.readFileSync(path.resolve("services/automationStudioService.ts"), "utf8");
  assert.match(source, /readNativeAutomationRuntimeSnapshot/);
  assert.match(source, /nativeEngine/);
  assert.doesNotMatch(source, /getAutomationTransportRuntimeConfig/);
});

test("Studio UI exposes native engine rather than n8n", () => {
  const source = fs.readFileSync(path.resolve("components/admin/AutomationStudio.tsx"), "utf8");
  assert.match(source, /QuickFurno Native Engine/);
  assert.doesNotMatch(source, /n8n/i);
});

console.log(`QF Automation Studio guard: ${passed}/${passed} PASS`);
