#!/usr/bin/env node
import { readFileSync } from "node:fs";

const read=(p)=>readFileSync(new URL("../../"+p, import.meta.url),"utf8");
const c=JSON.parse(read("contracts/qfj-phase19-kubernetes-v1.json"));
const base=read("ops/kubernetes/base/all.yaml");
const cert=read("ops/kubernetes/overlays/certification/kustomization.yaml");
const staging=read("ops/kubernetes/overlays/staging/kustomization.yaml");
const prod=read("ops/kubernetes/overlays/production/kustomization.yaml");
const job=read("ops/kubernetes/overlays/certification/artifact-check-job.yaml");
const workflow=read(".github/workflows/phase19-kubernetes-readiness.yml");
const checks=[]; const add=(name,ok)=>checks.push([name,Boolean(ok)]);

add("canonical Phase19 contract",c.contract==="qfj.phase19.kubernetes.v1"&&c.version===1&&!c.productionKubernetesOperated);
add("current production digest is pinned",base.includes(c.images.quickfurno.image));
add("Kustomize packaging exists",cert.includes("../../base")&&staging.includes("../../base")&&prod.includes("../../base"));
add("web startup/readiness/liveness are distinct",base.includes("startupProbe:")&&base.includes("path: /readyz")&&(base.match(/path: \/livez/g)?.length??0)>=2);
add("non-root read-only runtime is locked",base.includes("runAsNonRoot: true")&&base.includes("readOnlyRootFilesystem: true")&&base.includes("allowPrivilegeEscalation: false")&&base.includes('drop: ["ALL"]')&&base.includes("RuntimeDefault"));
add("service account tokens are disabled",base.includes("automountServiceAccountToken: false"));
add("graceful termination is explicit",base.includes("terminationGracePeriodSeconds: 30"));
add("PDB cannot deadlock rollout",base.includes("kind: PodDisruptionBudget")&&base.includes("maxUnavailable: 1"));
add("bounded HPA matches contract",base.includes("kind: HorizontalPodAutoscaler")&&base.includes("minReplicas: 2")&&base.includes("maxReplicas: 4")&&base.includes("value: 1")&&base.includes("periodSeconds: 60"));
add("topology spread and anti-affinity exist",base.includes("topologySpreadConstraints:")&&base.includes("podAntiAffinity:"));
add("default deny plus explicit DNS/HTTPS egress",base.includes("name: default-deny")&&base.includes("allow-dns-and-https-egress")&&base.includes("port: 53")&&base.includes("port: 443"));
add("no persistent business volume",!base.includes("persistentVolumeClaim")&&!base.includes("hostPath:"));
add("config and secrets use supported runtime injection",base.includes("configMapRef:")&&base.includes("secretKeyRef:")&&base.includes("name: quickfurno-runtime-secrets")&&base.includes("key: service-role-key")&&!base.includes("SUPABASE_SERVICE_ROLE_KEY_FILE")&&!base.includes("/run/qf-secrets"));
add("certification disables effect workers but checks shared artifact",cert.includes("quickfurno-automation-worker")&&cert.includes("value: 0")&&job.includes(c.images.quickfurno.image));
add("staging and production overlays contain no generated secrets",!staging.includes("secretGenerator")&&!prod.includes("secretGenerator"));
add("Kind and API-server dry-run are CI gates",workflow.includes(c.kubernetes.kindNodeImage)&&workflow.includes("--dry-run=server")&&workflow.includes("kubectl kustomize"));
add("CI deploys certification overlay only",workflow.includes("overlays/certification")&&!workflow.includes("apply -k ops/kubernetes/overlays/production"));
add("no production Kubernetes operation",c.nonGoals.productionCluster===true&&!workflow.includes("namespace quickfurno-production"));

for(const [n,ok] of checks) console.log((ok?"PASS":"FAIL")+" "+n);
const failed=checks.filter(([,ok])=>!ok);
if(failed.length){console.error("QuickFurno Phase19 failed: "+failed.length);process.exit(1);}
console.log("QuickFurno Phase19 Kubernetes contract PASS ("+checks.length+"/"+checks.length+")");
