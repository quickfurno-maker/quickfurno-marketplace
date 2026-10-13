#!/usr/bin/env node
/**
 * VL-05 Staging Kubernetes overlay gate. Renders locally, NEVER deploys.
 * Prevents Kustomize strategic merge from accidentally adding a second
 * container (wrong container name), leaving the original Production runtime.
 * Requires kubectl client with integrated kustomize: fail closed if absent.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const overlay = path.join(root, 'ops/kubernetes/overlays/staging');
const STAGING_REF = 'uckafzuochmbvtiodmcl';
const PRODUCTION_REF = 'yqpgcsduqbxulrlzwzap';
const TARGETS = new Map([
  ['quickfurno-web', 'web'],
  ['quickfurno-automation-worker', 'worker'],
  ['quickfurno-conversation-transport', 'worker'],
  ['quickfurno-aarohi-acquisition', 'worker'],
]);
const assertMatches = (text, re, label) => assert.match(text, re, label);
function certifyRendered(manifest) {
  assert(!manifest.includes(PRODUCTION_REF), 'Production project reference in Staging YAML');
  assert(!/(?:^|\s)(?:www\.)?quickfurno\.in(?:\s|$)/m.test(manifest), 'Production host in Staging YAML');
  const docs = manifest.split(/^---\s*$/m);
  for (const doc of docs) {
    assert(!/^kind: (?:Ingress|HorizontalPodAutoscaler|PodDisruptionBudget)\s*$/m.test(doc), 'production ingress/autoscaling resources forbidden in quarantine overlay');
  }
  const deployments = docs.filter(doc => /^kind: Deployment\s*$/m.test(doc));
  assert.equal(deployments.length, TARGETS.size, 'expected four Staging deployments');
  const names = [];
  for (const doc of deployments) {
    const name = doc.match(/^  name: (quickfurno-[a-z-]+)\s*$/m)?.[1];
    assert(name && TARGETS.has(name), 'unknown Staging deployment');
    assert(!names.includes(name), 'duplicate Staging deployment');
    names.push(name);
    assertMatches(doc, /^  namespace: quickfurno-staging\s*$/m, name + ' namespace');
    assertMatches(doc, /^  replicas: 0\s*$/m, name + ' must remain scaled to zero');
    // Each existing container must be PATCHED, not accompanied by a new one.
    // Kustomize serializes each container as an indent-six '- env:' list item.
    const containerSection = doc.match(/^      containers:[ \t]*\r?\n([\s\S]*?)(?=^      [A-Za-z][A-Za-z]+:|$(?![\s\S]))/m)?.[1];
    assert(containerSection, name + ': no container section');
    const containers = [...containerSection.matchAll(/^      - (?:env:|image:|name:)/gm)];
    assert.equal(containers.length, 1, name + ': unexpected extra container');
    const containerNames = [...containerSection.matchAll(/^        name: ([a-z][a-z0-9-]*)\s*$/gm)];
    assert.equal(containerNames.length, 1, name + ': exactly one named container');
    assert.equal(containerNames[0][1], TARGETS.get(name), name + ': incorrect container name');
    const images = [...containerSection.matchAll(/^        image: (\S+)\s*$/gm)];
    assert.equal(images.length, 1, name + ': exactly one image');
    assertMatches(images[0][1], /^ghcr\.io\/quickfurno-maker\/quickfurno-marketplace@sha256:[a-f0-9]{64}$/, name + ': pin image digest');
    assertMatches(doc, /^        - name: QF_RUNTIME_ENV\r?\n          value: staging\s*$/m, name + ': correct runtime environment');
    assertMatches(doc, /^        - name: QF_ALLOW_STAGING_RUNTIME\r?\n          value: "?1"?\s*$/m, name + ': explicit staging allowlist');
    assertMatches(doc, /^        - name: NEXT_PUBLIC_SUPABASE_URL\r?\n          value: https:\/\/uckafzuochmbvtiodmcl\.supabase\.co\s*$/m, name + ': Staging browser project');
    if (name === 'quickfurno-automation-worker') {
      assertMatches(doc, /^        - name: QF_NATIVE_AUTOMATION_MODE\r?\n          value: shadow\s*$/m, 'native worker must remain shadow');
    }
  }
  assert.equal(names.length, TARGETS.size);
  return names.sort();
}

const manifest = execFileSync('kubectl', ['kustomize', overlay], {
  encoding: 'utf8',
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const names = certifyRendered(manifest);
let negatives = 0;
function mustReject(label, mutate) {
  assert.throws(() => certifyRendered(mutate(manifest)), undefined, label);
  negatives += 1;
}
// Regression probes, including the exact second-container bug found in VL-05.
mustReject('duplicate container', s => s.replace('        name: worker\n', '        name: worker\n      - name: rogue\n'));
mustReject('Production runtime', s => s.replace('value: staging\n', 'value: production\n'));
mustReject('wrong Supabase project', s => s.replaceAll(STAGING_REF, PRODUCTION_REF));
mustReject('worker starts actively', s => s.replace('value: shadow\n', 'value: active\n'));
mustReject('missing image pin', s => s.replace(/@sha256:[a-f0-9]{64}/, ':unverified'));
mustReject('unapproved replicas', s => s.replace('replicas: 0', 'replicas: 1'));
mustReject('production ingress', s => s + '\n---\napiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: quickfurno\n');
mustReject('web autoscaler', s => s + '\n---\napiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: quickfurno-web\n');
console.log('VL05_STAGING_OVERLAY_PASS deployments=' + names.join(','));
console.log('VL05_STAGING_OVERLAY_NEGATIVE_PASS ' + negatives + '/8');
console.log('VL05_STAGING_OVERLAY_DEPLOYMENT_NOT_AUTHORIZED: old pinned image staging provenance remains unverified');
