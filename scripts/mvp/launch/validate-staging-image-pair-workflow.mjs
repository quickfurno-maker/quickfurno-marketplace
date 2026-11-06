/**
 * Static no-deploy contract for the isolated Staging Core+VOX image publisher.
 * Makes no network requests and never approves a deployment.
 */
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const WORKFLOW=resolve(ROOT,".github/workflows/qf-p4-staging-image-pair.yml");
const EXPECTED_STAGING="https://uckafzuochmbvtiodmcl.supabase.co";
const SHA="[0-9a-f]{40}";

function has(s,x){return s.includes(x)}
export function auditStagingImagePairWorkflow(s){
  const faults=[];
  const test=(key,yes)=>{if(!yes)faults.push(key)};
  const on=s.match(/^on:\r?\n([\s\S]*?)^permissions:/m)?.[1]??"";
  const source=s.match(/^  source-policy:\r?\n([\s\S]*?)^  publish-staging-images:/m)?.[1]??"";
  const publish=s.match(/^  publish-staging-images:\r?\n([\s\S]*)$/m)?.[1]??"";
  test("MANUAL_DISPATCH_MISSING",has(on,"workflow_dispatch:")&&has(on,"publish_staging_pair:"));
  test("NO_AUTOMATIC_PUBLISH_TRIGGER",!(/^\s{2}(?:push|pull_request_target|workflow_run|schedule|repository_dispatch):/m.test(on)));
  test("NO_DEFAULT_PUBLISH",has(on,"default: false"));
  test("NO_WRITE_PERMISSION_FOR_SOURCE_JOB",has(s,"permissions:\n  contents: read")&&!has(source,"packages: write")&&!has(source,"id-token: write"));
  test("MANUAL_PUBLISH_REQUIRED",has(publish,"github.event_name == 'workflow_dispatch'")&&has(publish,"inputs.publish_staging_pair == true"));
  test("PROTECTED_MAIN_REQUIRED",has(publish,"github.ref == 'refs/heads/main'")&&has(publish,"test \"$GITHUB_REF\" = \"refs/heads/main\""));
  test("HUMAN_CONFIRMATION_REQUIRED",has(publish,"inputs.typed_confirmation == 'PUBLISH_STAGING_PAIR_ONLY'"));
  test("EXPLICIT_REPO_SWITCH_REQUIRED",has(publish,"vars.QF_STAGING_IMAGE_PUBLISH_APPROVED == 'true'"));
  test("STAGING_ENV_REQUIRED",/^\s{4}environment: staging$/m.test(publish));
  test("PINNED_MAIN_SOURCE_REQUIRED",has(publish,"ref: \"\${{ github.sha }}\"")&&has(publish,'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"'));
  test("STAGING_URL_EXACT",has(publish,EXPECTED_STAGING)&&has(publish,'test "$STAGING_URL" = "https://uckafzuochmbvtiodmcl.supabase.co"'));
  test("STAGING_PUBLIC_KEY_CHECK_REQUIRED",has(publish,"STAGING_PUBLIC_KEY")&&has(publish,'claims.role!=="anon"')&&has(publish,'claims.ref!=="uckafzuochmbvtiodmcl"'));
  test("SEPARATE_STAGING_REGISTRY_NAMES",has(publish,"ghcr.io/quickfurno-maker/quickfurno-staging-core")&&has(publish,"ghcr.io/quickfurno-maker/quickfurno-staging-vox"));
  test("EXACT_SOURCE_IMAGE_LABELS",has(publish,"--build-arg GIT_SHA=")&&has(publish,"org.opencontainers.image.revision"));
  test("BOTH_IMAGE_VULN_POLICIES",has(publish,"enforce-trivy-report.mjs core-trivy.json")&&has(publish,"enforce-trivy-report.mjs vox-trivy.json"));
  test("BOTH_IMAGE_SBOMS",has(publish,"core-sbom.spdx.json")&&has(publish,"vox-sbom.spdx.json"));
  test("IMMUTABLE_REGISTRY_REFS_REQUIRED",has(publish,"core_digest=")&&has(publish,"vox_digest=")&&has(publish,"@sha256:"));
  test("BOTH_COSIGN_SIGNATURES",has(publish,"for ref in \"$CORE_REF\" \"$VOX_REF\"; do")&&has(publish,"cosign sign --yes")&&has(publish,"cosign verify --certificate-identity"));
  test("OPAQUE_PUBLIC_KEY_FAIL_CLOSED",has(publish,'if(key.startsWith("sb_publishable_"))process.exit(78)'));
  test("PUBLISH_MUST_MATCH_BUILD_IMAGE_IDS",has(publish,"core-build-image-id.txt")&&has(publish,"vox-build-image-id.txt")&&has(publish,'$(cat core-build-image-id.txt)')&&has(publish,'$(cat vox-build-image-id.txt)'));
  test("VERIFY_BOTH_REGISTRY_ATTESTATIONS",has(publish,'gh attestation verify "oci://$CORE_REF"')&&has(publish,'gh attestation verify "oci://$VOX_REF"'));
  test("AUTHENTICATED_ATTESTATION_VERIFY",has(publish,'GH_TOKEN: "${{ github.token }}"'));
  test("BOTH_ATTESTATIONS",has(publish,"steps.registry.outputs.core_digest")&&has(publish,"steps.registry.outputs.vox_digest")&&(publish.match(/actions\/attest-build-provenance@/g)||[]).length===2);
  test("NO_DEPLOY_COMMANDS",!(/^\s*(?:sudo\s+)?(?:ssh|scp|kubectl|helm|rsync|docker\s+(?:run|compose|stack|service))\b/m.test(publish)));
  test("NO_SERVICE_SECRETS",!(/SUPABASE_SERVICE_ROLE_KEY|QF_RUNTIME_ENV=production|QF_PRODUCTION_/i.test(publish)));
  test("NO_ARTIFACT_QUOTA_DEPENDENCY",!has(publish,"actions/upload-artifact@"));
  const uses=[...s.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)].map(x=>x[1]);
  test("ALL_EXTERNAL_ACTIONS_PINNED",uses.length>=8&&uses.every(x=>new RegExp("@"+SHA+"$").test(x)));
  return Object.freeze({policy:"qf.p4.staging-image-pair.no-deploy.v1",valid:faults.length===0,releaseAuthorized:false,deploys:false,sourcePolicyChecksOnly:true,failures:faults});
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
  const result=auditStagingImagePairWorkflow(readFileSync(WORKFLOW,"utf8"));
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  if(!result.valid)process.exitCode=2;
}
