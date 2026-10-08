#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

const [
  supply,
  promote,
  rollback,
  controller,
  switcher,
  wrapper,
  bootstrap,
  compose,
  schema,
  docs,
] = await Promise.all([
  read('.github/workflows/scale-container-supply-chain.yml'),
  read('.github/workflows/phase15-promote.yml'),
  read('.github/workflows/phase15-rollback.yml'),
  read('ops/phase15/blue-green.sh'),
  read('ops/phase15/nginx-switch.sh'),
  read('ops/phase15/qf-phase15-release.wrapper'),
  read('ops/phase15/bootstrap-production-host.sh'),
  read('ops/container/compose.production.yml'),
  read('contracts/qf-release-phase15-v1.schema.json'),
  read('docs/operations/phase15-immutable-cicd-bluegreen.md'),
]);

const workflowsDir = new URL('.github/workflows/', root);
const workflowNames = (await readdir(workflowsDir)).filter((name) => /\.ya?ml$/u.test(name));
const workflowTexts = await Promise.all(
  workflowNames.map(async (name) => [name, await read('.github/workflows/' + name)]),
);

const checks = [];
const add = (name, ok) => checks.push([name, Boolean(ok)]);

const mutableActions = [];
for (const [name, text] of workflowTexts) {
  for (const line of text.split(/\r?\n/u)) {
    const match = line.match(/^\s*uses:\s*([^\s]+)@([^\s#]+)/u);
    if (
      match &&
      !match[1].startsWith('./') &&
      !/^[a-f0-9]{40}$/u.test(match[2])
    ) {
      mutableActions.push(name + ': ' + line.trim());
    }
  }
}

add('every third-party GitHub Action is pinned to a 40-hex commit SHA', mutableActions.length === 0);
add(
  'manual publication is main-only and cannot publish an arbitrary branch',
  supply.includes("github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'") &&
    !supply.includes("github.event_name == 'workflow_dispatch' && inputs.publish == true)"),
);
add(
  'release artifacts are digest-only and mutable latest is never published',
  supply.includes('published-image-ref.txt') &&
    !/ghcr\.io\/[^\s"'\x60]+:latest\b/iu.test(supply) &&
    !/docker\s+tag[^\n]*:latest\b/iu.test(supply),
);
add(
  'release carries SBOM, Sigstore signature, custom release attestation and GitHub provenance',
  supply.includes('spdx-json') &&
    supply.includes('cosign sign') &&
    supply.includes('https://quickfurno.in/attestations/qf.release.phase15.v1') &&
    supply.includes('actions/attest-build-provenance@'),
);
add(
  'promotion verifies signature, release attestation and GitHub provenance before apply',
  promote.includes('cosign verify ') &&
    promote.includes('cosign verify-attestation') &&
    promote.includes('gh attestation verify') &&
    promote.includes('phase15-release.mjs validate') &&
    promote.includes('--promotable'),
);
add(
  'promotion binds signed manifest to requested source SHA and exact image digest',
  promote.includes('--arg sha "$SOURCE_SHA"') &&
    promote.includes('--arg ref "$IMAGE_REF"') &&
    promote.includes('.sourceSha == $sha') &&
    promote.includes('.role == "quickfurno-runtime"') &&
    promote.includes('.ref == $ref'),
);
add(
  'production apply is double gated by cutover flag and protected environment',
  promote.includes("vars.PHASE15_PRODUCTION_CUTOVER_ENABLED == 'true'") &&
    promote.includes('environment: production') &&
    promote.includes('PROMOTE_EXACT_DIGEST'),
);
add(
  'production runner invokes only the constrained root-owned wrapper',
  promote.includes('sudo -n /usr/local/sbin/qf-phase15-release stage') &&
    promote.includes('sudo -n /usr/local/sbin/qf-phase15-release promote') &&
    !promote.includes('sudo -n bash') &&
    !promote.includes('ssh '),
);
add(
  'rollback is human gated and restores only previous signed release state',
  rollback.includes('environment: production') &&
    rollback.includes('ROLLBACK_TO_PREVIOUS_SIGNED_RELEASE') &&
    rollback.includes('sudo -n /usr/local/sbin/qf-phase15-release rollback'),
);
add(
  'inactive web is staged and proven before traffic switch',
  controller.includes('compose_for "$target" "$MANIFEST" up -d web') &&
    controller.includes('wait_web_healthy "$target" "$MANIFEST"') &&
    controller.indexOf('wait_web_healthy "$target" "$STAGED_MANIFEST"') <
      controller.indexOf('switch_traffic "$target" "$STAGED_MANIFEST"'),
);
add(
  'workers activate only after public traffic smoke succeeds',
  controller.indexOf('public_smoke') < controller.indexOf('activate_workers "$target" "$STAGED_MANIFEST"'),
);
add(
  'failed promotion restores previous traffic target',
  controller.includes('switch_traffic "$active" "$CURRENT_MANIFEST" || true') &&
    controller.includes('PHASE15_PROMOTION_SMOKE_FAILED'),
);
add(
  'worker activation failure restores previous traffic and worker generation',
  controller.includes('PHASE15_WORKER_ACTIVATION_FAILED') &&
    controller.includes('stop_workers "$target" "$STAGED_MANIFEST" || true') &&
    controller.includes('activate_workers "$active" "$CURRENT_MANIFEST" || true'),
);
add(
  'previous web generation remains available for deterministic rollback',
  controller.includes('previous web remains warm for rollback') &&
    !controller.includes('docker system prune') &&
    !controller.includes('docker image prune'),
);
add(
  'Nginx switch is atomic and restores prior include on test or reload failure',
  switcher.includes('mv -f "$TMP" "$TARGET"') &&
    switcher.includes('"$NGINX" -t') &&
    switcher.includes('restore') &&
    switcher.includes('"$NGINX" -s reload'),
);
add(
  'root wrapper refuses writable or non-root release-control code',
  wrapper.includes('stat -c') &&
    wrapper.includes('must be root-owned') &&
    wrapper.includes('group/world writable') &&
    wrapper.includes("CONTROL_ROOT='/srv/quickfurno/release-control'") &&
    wrapper.includes('CONTROLLER="$CONTROL_ROOT/ops/phase15/blue-green.sh"'),
);
add(
  'host bootstrap preserves legacy traffic and installs fail-closed release controls',
  bootstrap.includes('TRAFFIC_UNCHANGED upstream=127.0.0.1:3000') &&
    bootstrap.includes('QF_PHASE15_BOOTSTRAP_READY') &&
    bootstrap.includes('phase15-active-upstream.conf') &&
    bootstrap.includes('NGINX_SITE_ENTRY="/etc/nginx/sites-enabled/quickfurno"') &&
    bootstrap.includes('readlink -f "$NGINX_SITE_ENTRY"') &&
    bootstrap.includes('/etc/nginx/sites-available/*') &&
    bootstrap.includes('QuickFurno Nginx site must be root-owned') &&
    bootstrap.includes('legacy-pm2 bootstrap') &&
    bootstrap.includes('rollback_nginx') &&
    bootstrap.includes('/etc/quickfurno/production.env') &&
    bootstrap.includes('/srv/quickfurno/release-control') &&
    bootstrap.includes('visudo -cf') &&
    bootstrap.includes('docker compose -f "$CONTROL_ROOT/ops/container/compose.production.yml" config --quiet') &&
    !bootstrap.includes('docker system prune') &&
    !bootstrap.includes('docker image prune'),
);
add(
  'AGNI case signing key uses a file-backed secret only in eligible runtimes',
  compose.includes('agni-case-private-key:') &&
    compose.includes('file: /etc/quickfurno/secrets/quickfurno-core-agni-private.pem') &&
    compose.includes('target: quickfurno-core-agni-private.pem') &&
    (compose.match(/source: agni-case-private-key/gu) ?? []).length === 2 &&
    !compose.includes('/run/quickfurno-secrets') &&
    bootstrap.includes('/etc/quickfurno/secrets'),
);
add(
  'release contract requires human approval and forbids automatic production apply',
  schema.includes('"requireHumanApproval": { "const": true }') &&
    schema.includes('"automaticProductionApply": { "const": false }') &&
    schema.includes('"strategy": { "const": "BLUE_GREEN" }'),
);
add(
  'Phase 14 database changes remain source-only in this phase',
  supply.includes('--db-policy SOURCE_ONLY') &&
    docs.includes('Phase-14 migrations remain **SOURCE_ONLY**') &&
    !controller.match(/supabase\s+db\s+push|prisma\s+migrate|db:migrate/iu),
);
add(
  'AGNI/OpenAI remain outside deployment authority',
  docs.includes('AGNI/OpenAI do not receive deployment-host credentials'),
);

if (mutableActions.length) {
  console.error('Mutable action references:');
  for (const item of mutableActions) console.error('  ' + item);
}

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
}
if (failed.length) {
  console.error('QuickFurno Phase 15 contract failed: ' + failed.length + ' check(s)');
  process.exit(1);
}
console.log('QuickFurno Phase 15 contract PASS (' + checks.length + '/' + checks.length + ')');
