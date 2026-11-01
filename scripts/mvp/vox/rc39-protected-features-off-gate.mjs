// RC39 fail-closed CI gate. Source-only: reads files in this checkout, opens no
// network or database connection and needs no secrets.
//   1. Every VOX protected feature flag in the committed env templates is OFF.
//   2. No unreviewed direct PostgreSQL pool/client in runtime source or runtime deps.
//   3. The RC38 signed-EOD reader stays uninstalled (route answers 503).
//   4. VOX workflows stay source-only: no secrets, protected environments,
//      deploy/migration commands, remote DB URLs or write permissions.
import {readFileSync,readdirSync,statSync} from "node:fs";
import {resolve,dirname,relative,join} from "node:path";
import {fileURLToPath} from "node:url";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");

export const ENV_TEMPLATES=[".env.example","apps/vox-web/.env.example"];
export const RUNTIME_DIRS=["app","apps/vox-web","services","lib","contracts","components"];
export const PACKAGE_FILES=["package.json","apps/vox-web/package.json"];
export const RC38_DB_SOURCE="services/vox/rc38SignedEodReviewDb.ts";
export const RC17_WORKFLOW=".github/workflows/vox-rc17-six-tracks-hold.yml";
// Reviewed direct-PostgreSQL runtime files. Deliberately empty: adding an entry
// needs a separate owner-approved review of the role, pool and Data API contract.
export const REVIEWED_DIRECT_PG_RUNTIME_FILES=[];

const FLAG_KEY=/^(?:VOX|RC\d+)_[A-Z0-9_]*(?:_ENABLED|_MODE|_PREVIEW)$/;
const OFF_VALUES=new Set(["","disabled","off","false","0"]);

export function checkEnvTemplate(name,text){
 const bad=[];
 text.split(/\r?\n/).forEach((line,i)=>{
  const m=/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if(!m||!FLAG_KEY.test(m[1]))return;
  const v=m[2].replace(/^(['"])(.*)\1$/,"$2").toLowerCase();
  if(!OFF_VALUES.has(v))bad.push(`${name}:${i+1} ${m[1]}=${m[2]} must be disabled`);
 });
 return bad;
}

const stripComments=s=>s.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"");
const PG_PATTERNS=[
 [/\bfrom\s*["'](?:pg|pg-pool|postgres|pg-native)["']/,"static import of a PostgreSQL driver"],
 [/\brequire\s*\(\s*["'](?:pg|pg-pool|postgres|pg-native)["']\s*\)/,"require of a PostgreSQL driver"],
 [/\bimport\s*\(\s*(?:\/\*[\s\S]*?\*\/\s*)?["'](?:pg|pg-pool|postgres|pg-native)["']/,"dynamic import of a PostgreSQL driver"],
 [/\b(?:specifier|moduleName|driver)\s*=\s*["'](?:pg|pg-pool|postgres|pg-native)["']/,"indirect PostgreSQL driver specifier"],
 [/\bnew\s+(?:pg\.|Pg\.)?Pool\s*\(/,"direct PostgreSQL pool"],
 [/\bnew\s+(?:pg\.)?Client\s*\(\s*\{[^}]*connectionString/,"direct PostgreSQL client"],
];
export function checkRuntimeSourceForDirectPg(file,text){
 if(REVIEWED_DIRECT_PG_RUNTIME_FILES.includes(file))return [];
 const src=stripComments(text);
 return PG_PATTERNS.filter(([re])=>re.test(src)).map(([,why])=>`${file}: ${why}`);
}

export function checkPackageJson(file,text){
 const pkg=JSON.parse(text);
 const bad=[];
 for(const section of ["dependencies","optionalDependencies","peerDependencies"])
  for(const dep of ["pg","pg-pool","pg-native","postgres"])
   if(pkg[section]&&dep in pkg[section])bad.push(`${file}: ${dep} must not be a runtime ${section} entry`);
 return bad;
}

export function checkRc38Reader(text){
 const src=stripComments(text);
 const bad=[];
 if(!/export\s+const\s+RC38_SIGNED_EOD_REVIEW_READER_INSTALLED\s*=\s*false\b/.test(src))
  bad.push(`${RC38_DB_SOURCE}: RC38_SIGNED_EOD_REVIEW_READER_INSTALLED must be exactly false`);
 const fn=/function\s+rc38SignedEodReviewDbSource\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(src);
 if(!fn||fn[1].replace(/\s+/g,"")!=="returnnull;")
  bad.push(`${RC38_DB_SOURCE}: rc38SignedEodReviewDbSource must unconditionally return null`);
 if(/process\.env/.test(src))bad.push(`${RC38_DB_SOURCE}: must not read environment to build a reader`);
 return bad;
}

const WORKFLOW_RULES=[
 [/\$\{\{\s*secrets\./i,"references a repository secret"],
 [/^\s*environment\s*:/m,"uses a protected deployment environment"],
 [/\bpull_request_target\b/,"uses pull_request_target"],
 [/^\s*(?:contents|id-token|deployments|packages|actions|pull-requests|statuses)\s*:\s*write\b/m,"requests write permission"],
 [/\bsupabase\s+(?:db\s+(?:push|reset|remote|pull)|link|login|functions\s+deploy|migration\s+up|projects|secrets|branches)\b/,"runs a Supabase CLI command that can touch a managed project"],
 [/\b(?:vercel|netlify|flyctl|wrangler|kubectl|helm|terraform)\s+(?:deploy|apply|--prod|publish|install|upgrade)\b/,"runs a deploy command"],
 [/\bpsql\b[^\n]*(?:supabase\.(?:co|com)|pooler\.supabase)/i,"opens psql to a managed Supabase host"],
 [/postgres(?:ql)?:\/\/[^\s'"]*@(?!(?:localhost|127\.0\.0\.1|\[::1\]|postgres|db)(?:[:\/'"\s]|$))[^\s'"]+/i,"contains a non-loopback Postgres URL"],
 [/\b[a-z0-9]{20}\.supabase\.co\b/i,"references a managed Supabase project host"],
 [/\bSUPABASE_(?:ACCESS_TOKEN|SERVICE_ROLE_KEY|DB_PASSWORD)\b/,"references a managed Supabase credential"],
];
export function checkWorkflow(file,text){
 // `test -z "${NAME:-}"` asserts a credential is absent; it is the opposite of use.
 const body=text.replace(/^\s*#.*$/gm,"").replace(/^\s*test\s+-z\s+"\$\{[A-Z_]+:-\}"\s*$/gm,"");
 return WORKFLOW_RULES.filter(([re])=>re.test(body)).map(([,why])=>`${file}: ${why}`);
}

export function checkGateWiring(text){
 const bad=[];
 if(!text.includes("scripts/mvp/vox/rc39-*.test.mjs"))bad.push(`${RC17_WORKFLOW}: rc39 regression tests are not wired`);
 if(!text.includes("node scripts/mvp/vox/rc39-protected-features-off-gate.mjs"))
  bad.push(`${RC17_WORKFLOW}: rc39 gate step is not wired`);
 if(!text.includes("'scripts/mvp/vox/rc39-protected-features-off-gate.mjs'"))
  bad.push(`${RC17_WORKFLOW}: rc39 gate is not a pull_request path trigger`);
 return bad;
}

function walk(dir,out=[]){
 let entries;
 try{entries=readdirSync(dir)}catch{return out}
 for(const e of entries){
  if(e==="node_modules"||e===".next"||e==="test-results")continue;
  const p=join(dir,e);
  if(statSync(p).isDirectory())walk(p,out);
  else if(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(e)&&!/\.(?:test|spec)\./.test(e))out.push(p);
 }
 return out;
}
const rel=p=>relative(root,p).split("\\").join("/");

export function runGate(base=root){
 const read=p=>readFileSync(resolve(base,p),"utf8");
 const failures=[];
 for(const f of ENV_TEMPLATES)failures.push(...checkEnvTemplate(f,read(f)));
 for(const d of RUNTIME_DIRS)
  for(const f of walk(resolve(base,d)))
   failures.push(...checkRuntimeSourceForDirectPg(relative(base,f).split("\\").join("/"),readFileSync(f,"utf8")));
 for(const f of PACKAGE_FILES)failures.push(...checkPackageJson(f,read(f)));
 failures.push(...checkRc38Reader(read(RC38_DB_SOURCE)));
 const wfDir=resolve(base,".github/workflows");
 for(const f of readdirSync(wfDir).filter(n=>/^vox-.*\.ya?ml$/.test(n)))
  failures.push(...checkWorkflow(`.github/workflows/${f}`,readFileSync(join(wfDir,f),"utf8")));
 failures.push(...checkGateWiring(read(RC17_WORKFLOW)));
 return failures;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const failures=runGate();
 if(failures.length){
  console.error("RC39 protected-features-off gate FAILED:\n"+failures.map(f=>" - "+f).join("\n"));
  process.exit(1);
 }
 console.log("RC39 protected-features-off gate passed: flags OFF, no direct pg pool, RC38 reader uninstalled, VOX workflows source-only.");
}
