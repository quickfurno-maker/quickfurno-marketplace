import test from "node:test";import assert from "node:assert/strict";
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname,join,resolve} from "node:path";import {fileURLToPath} from "node:url";
import {diffPaths} from "./ab7k-evidence-lib.mjs";
import {
  PRESENTATION_ONLY_NODE_FIELDS,PROVISIONAL_LABEL,SEMANTIC_SCHEMA,adjudicateRecovery,assertSafeOutFile,behaviorProbeSql,
  compareProbes,compareSemantic,evaluateProbeExpectations,isPathInside,nodeTreeHasUserOids,normalizeNodeTree,
  parseProbeOutput,semanticCatalogSql
} from "./ab7k-semantic-lib.mjs";
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,"../../..");
const read=p=>readFileSync(resolve(here,p),"utf8");

// ------------------------------------------------------------------ fixtures
const PRIVS=["SELECT","INSERT","UPDATE","DELETE","TRUNCATE","REFERENCES","TRIGGER","MAINTAIN"];
const OWNER_ACL=PRIVS.map(p=>`postgres|postgres|${p}|true`);
const AB="vox_ab7j_staff_suspend_intents_candidate_v1",CH="vox_staff_team_messages_candidate_v1";
const none={plain:[],grantable:[]};
const rel=(over={})=>({kind:"r",owner:"postgres",persistence:"p",options:"",is_partition:false,rls:true,force_rls:true,
  acl:OWNER_ACL,priv:{anon:none,authenticated:none,service_role:none},columns:{},constraints:{},indexes:{},triggers:{},policies:{},rules:{},definition_text:null,...over});
const tree=(md5,user_oids=false)=>({md5,user_oids});
const chatConstraints=()=>({
  vox_staff_team_messages_candidate_v1_body_check:{type:"c",deferrable:false,deferred:false,validated:true,columns:["body"],ref_table:null,ref_columns:null,fk_update:"a",fk_delete:"a",fk_match:"s",index:null,expr:tree("aaa")},
  vox_chat_no_external_delivery_v1:{type:"c",deferrable:false,deferred:false,validated:true,columns:["body"],ref_table:null,ref_columns:null,fk_update:"a",fk_delete:"a",fk_match:"s",index:null,expr:tree("bbb")}});
const abConstraints=()=>({
  ab7j_distinct_staff_approvers:{type:"c",deferrable:false,deferred:false,validated:true,columns:["owner_id","reviewer_id","target_id"],ref_table:null,ref_columns:null,fk_update:"a",fk_delete:"a",fk_match:"s",index:null,expr:tree("ccc")}});
const fn=(over={})=>({kind:"f",owner:"postgres",security_definer:true,config:['search_path=""'],language:"plpgsql",volatility:"v",strict:false,leakproof:false,parallel:"u",returns:"uuid",body_md5:"m",
  acl:["postgres|postgres|EXECUTE|true","service_role|postgres|EXECUTE|false"],
  execute:{anon:{plain:false,grantable:false},authenticated:{plain:false,grantable:false},service_role:{plain:true,grantable:false}},...over});
function sem(over={}){
  return {schema:SEMANTIC_SCHEMA,identity:{database:"d"},roles:{anon:{super:false,bypassrls:false}},memberships:[],
    schemas:{public:{owner:"postgres",acl:["postgres|postgres|USAGE|true"],usage:{anon:true,authenticated:true,service_role:true},create:{anon:false,authenticated:false,service_role:false}}},
    default_acls:[],
    relations:{[AB]:rel({constraints:abConstraints()}),[CH]:rel({acl:[...OWNER_ACL,"service_role|postgres|SELECT|false"],priv:{anon:none,authenticated:none,service_role:{plain:["SELECT"],grantable:[]}},constraints:chatConstraints()})},
    functions:{"qf_vox_ab7j_tl_approve_staff_suspend_v1(p_nonce uuid)":fn()},...over};
}
const clone=x=>JSON.parse(JSON.stringify(x));
const DENIED="ERR:42501:t:DENIED";
function goodProbes(){
  const p={};
  for(const r of ["anon","authenticated","service_role"])for(const t of ["chat","ab7j"])for(const o of ["select","insert","update","delete","truncate"])
    p[`priv/${r}/${t}/${o}`]=DENIED;
  p["priv/service_role/chat/select"]="OK";
  for(const id of ["chat/valid_hello","chat/body_500_ok","chat/body_unicode_ok","ab7j/valid_distinct"])p[id]="OK";
  for(const id of ["chat/body_501_rejected","chat/body_empty_rejected","chat/body_leading_space_rejected","chat/body_trailing_space_rejected","chat/body_tab_rejected","chat/body_newline_rejected","chat/body_del_rejected"])p[id]="ERR:23514:x:";
  p["chat/body_null_rejected"]="ERR:23502::";p["chat/dup_nonce"]="ERR:23505:k:";p["ab7j/dup_nonce"]="ERR:23505:k:";
  for(const id of ["ab7j/owner_eq_reviewer_rejected","ab7j/owner_eq_target_rejected","ab7j/reviewer_eq_target_rejected"])p[id]="ERR:23514:ab7j_distinct_staff_approvers:";
  for(const id of ["ab7j/digest_63_rejected","ab7j/digest_65_rejected","ab7j/digest_uppercase_rejected","ab7j/digest_nonhex_rejected"])p[id]="ERR:23514:c:";
  p["ab7j/digest_null_rejected"]="ERR:23502::";
  p["chat/trigger_update_blocked"]="ERR:P0001::APPEND_ONLY";p["chat/trigger_delete_blocked"]="ERR:P0001::APPEND_ONLY";
  p["exec/anon/qf_vox_f(uuid)"]=DENIED;
  return p;
}
const THREE=[`$.relations.${AB}.acl`,`$.relations.${AB}.acl_is_default`,`$.relations.${CH}.constraints`];
const adj=(o={})=>adjudicateRecovery({rawDiffPaths:THREE,semanticSource:sem(),semanticRestored:sem(),probesSource:goodProbes(),probesRestored:goodProbes(),...o});
const codes=r=>new Set(r.semanticFindings.map(f=>f.code));

// ------------------------------------------------------------------ observed RC2 case
test("observed RC2 three-path raw divergence with identical semantics is only candidate-semantic-parity-provisional",()=>{
  const r=adj();
  assert.equal(r.verdict,"PROVISIONAL_SEMANTIC_PARITY");
  assert.equal(r.label,PROVISIONAL_LABEL);assert.equal(PROVISIONAL_LABEL,"candidate-semantic-parity-provisional");
  assert.equal(r.rawStatus,"RAW_DIVERGENCE");
  assert.deepEqual(r.rawDivergentPaths.map(x=>x.path),THREE);
  assert.ok(r.rawDivergentPaths.every(x=>x.proven));
  assert.equal(r.requiresDbaInterpretation,true);
  assert.equal(r.exitCode,4);assert.notEqual(r.exitCode,0);
  assert.equal(r.exactManagedRecovery,false);assert.equal(r.goEligible,false);
  assert.match(r.managedRestoration,/^BLOCKED/);
  assert.deepEqual(Object.values(r.attestations),Array(5).fill("NOT_PROVIDED"));
  assert.match(r.note,/NOT exact recovery/);
});
test("raw diff is preserved verbatim by the strict diff, not rewritten by the semantic layer",()=>{
  const a={relations:{[AB]:{acl:OWNER_ACL,acl_is_default:false}}},b={relations:{[AB]:{acl:[],acl_is_default:true}}};
  assert.deepEqual(diffPaths(a,b),[`$.relations.${AB}.acl`,`$.relations.${AB}.acl_is_default`]);
});
test("raw parity and clean semantics is EXACT_LOCAL_RAW_PARITY but never managed recovery or GO",()=>{
  const r=adj({rawDiffPaths:[]});
  assert.equal(r.verdict,"EXACT_LOCAL_RAW_PARITY");assert.equal(r.exitCode,0);assert.equal(r.requiresDbaInterpretation,false);
  assert.equal(r.exactManagedRecovery,false);assert.equal(r.goEligible,false);assert.match(r.managedRestoration,/^BLOCKED/);
});

// ------------------------------------------------------------------ privilege widening still fails
test("explicit-vs-default ACL is equal only when the expanded effective ACL is equal",()=>{
  assert.deepEqual(compareSemantic(sem(),sem()),[]);
});
test("privilege widening hidden behind the same three raw paths FAILS (anon SELECT on AB7J)",()=>{
  const rs=sem();
  rs.relations[AB].acl=[...OWNER_ACL,"anon|postgres|SELECT|false"];
  rs.relations[AB].priv.anon={plain:["SELECT"],grantable:[]};
  const q=goodProbes();q[`priv/anon/ab7j/select`]="OK";
  const r=adj({semanticRestored:rs,probesRestored:q});
  assert.equal(r.verdict,"SEMANTIC_DIVERGENCE");assert.equal(r.exitCode,3);assert.equal(r.securityRegression,true);
  for(const c of ["ACL_WIDENED","PRIV_WIDENED","PROBE_WIDENED"])assert.ok(codes(r).has(c),c);
  assert.notEqual(r.label,PROVISIONAL_LABEL);
  assert.equal(r.rawDivergentPaths.find(x=>x.path.endsWith(".acl")).proven,false);
});
test("PUBLIC grant, WITH GRANT OPTION and column-level ACL widening are all detected",()=>{
  const rs=sem();
  rs.relations[CH].acl=[...OWNER_ACL,"PUBLIC|postgres|SELECT|false"];
  rs.relations[CH].priv.authenticated={plain:[],grantable:["SELECT"]};
  rs.relations[CH].columns={body:{type:"text",notnull:true,identity:"",generated:"",default:null,acl:["anon|postgres|SELECT|false"]}};
  const ss=sem();ss.relations[CH].columns={body:{type:"text",notnull:true,identity:"",generated:"",default:null,acl:null}};
  const c=codes(adj({semanticSource:ss,semanticRestored:rs}));
  assert.ok(c.has("ACL_WIDENED"));assert.ok(c.has("PRIV_WIDENED"));assert.ok(c.has("COLUMN_ACL_WIDENED"));
});
test("grantor-only change and narrowing are non-parity (not silently accepted)",()=>{
  const rs=sem();rs.relations[AB].acl=OWNER_ACL.map(x=>x.replace("|postgres|","|service_role|"));
  assert.ok(codes(adj({semanticRestored:rs})).has("ACL_GRANTOR_CHANGED"));
  const rn=sem();rn.relations[CH].acl=OWNER_ACL;rn.relations[CH].priv.service_role=none;
  const c=codes(adj({semanticRestored:rn}));assert.ok(c.has("ACL_NARROWED"));assert.ok(c.has("PRIV_NARROWED"));
});
test("function EXECUTE widening, owner change, search_path drop and body change FAIL",()=>{
  const rs=sem();const k=Object.keys(rs.functions)[0];
  rs.functions[k]=fn({owner:"service_role",config:[],body_md5:"other",
    acl:["PUBLIC|postgres|EXECUTE|false","postgres|postgres|EXECUTE|true"],
    execute:{anon:{plain:true,grantable:false},authenticated:{plain:true,grantable:false},service_role:{plain:true,grantable:false}}});
  const r=adj({semanticRestored:rs});
  for(const c of ["FUNCTION_EXECUTE_WIDENED","OWNER_CHANGED","FUNCTION_CHANGED","ACL_WIDENED"])assert.ok(codes(r).has(c),c);
  assert.equal(r.securityRegression,true);
});
test("RLS weakening, new anon policy, browser-role owner, schema CREATE, default ACL and role attribute changes FAIL",()=>{
  const rs=sem();
  rs.relations[AB].force_rls=false;rs.relations[CH].rls=false;
  rs.relations[CH].policies={p:{cmd:"r",permissive:true,roles:["anon"],using:tree("t"),check:null}};
  rs.relations[AB].owner="authenticated";
  rs.schemas.public.create.anon=true;
  rs.default_acls=["postgres|public|r|anon/postgres/SELECT/false"];
  rs.roles.anon={super:false,bypassrls:true};
  const c=codes(adj({semanticRestored:rs}));
  for(const x of ["RLS_WEAKENED","POLICY_ADDED","OWNER_CHANGED","SCHEMA_ACCESS_WIDENED","DEFAULT_ACL_CHANGED","ROLE_ATTRIBUTE_CHANGED"])assert.ok(c.has(x),x);
});

// ------------------------------------------------------------------ constraint weakening still fails
test("constraint paren-only deparse change passes only because the normalized parse tree digest is equal",()=>{
  const a="{OPEXPR :opno 523 :args ({VAR :varno 1 :varattno 6 :location 12} {CONST :consttype 23 :constvalue 4 [ 244 1 0 0 ] :location 30}) :location 20}";
  const b="{OPEXPR :opno 523 :args ({VAR :varno 1 :varattno 6 :location 99} {CONST :consttype 23 :constvalue 4 [ 244 1 0 0 ] :location 120}) :location 98}";
  assert.equal(normalizeNodeTree(a),normalizeNodeTree(b));
});
test("normalization strips only documented presentation fields; operator, constant and column changes survive",()=>{
  const base="{OPEXPR :opno 523 :args ({VAR :varattno 6 :varnosyn 1 :varattnosyn 6 :location 1} {CONST :consttype 23 :constvalue 4 [ 244 1 0 0 ] :location 2}) :location 0}";
  assert.deepEqual([...PRESENTATION_ONLY_NODE_FIELDS].sort(),["coerceformat","convertformat","funcformat","location","relabelformat","varattnosyn","varnosyn"]);
  assert.notEqual(normalizeNodeTree(base),normalizeNodeTree(base.replace("opno 523","opno 525")));          // <= vs <
  assert.notEqual(normalizeNodeTree(base),normalizeNodeTree(base.replace("[ 244 1 0 0 ]","[ 136 19 0 0 ]"))); // 500 vs 5000
  assert.notEqual(normalizeNodeTree(base),normalizeNodeTree(base.replace("varattno 6","varattno 5")));
  assert.equal(nodeTreeHasUserOids("{FUNCEXPR :funcid 20001 :location 0}"),true);
  assert.equal(nodeTreeHasUserOids("{FUNCEXPR :funcid 1396 :location 0}"),false);
  const sql=semanticCatalogSql(root);
  for(const f of PRESENTATION_ONLY_NODE_FIELDS)assert.ok(sql.includes(f),`SQL strips ${f}`);
});
test("weakened CHECK expression (500 -> 5000) hidden behind the constraints raw path FAILS",()=>{
  const rs=sem();rs.relations[CH].constraints.vox_staff_team_messages_candidate_v1_body_check.expr=tree("weaker");
  const q=goodProbes();q["chat/body_501_rejected"]="OK";
  const r=adj({semanticRestored:rs,probesRestored:q});
  assert.equal(r.verdict,"SEMANTIC_DIVERGENCE");assert.equal(r.securityRegression,true);
  assert.ok(codes(r).has("CONSTRAINT_EXPR_CHANGED"));assert.ok(codes(r).has("PROBE_WEAKENED"));
  assert.equal(r.rawDivergentPaths.find(x=>x.path.endsWith(".constraints")).proven,false);
});
test("dropped constraint, changed FK action, deferrable flip, NOT VALID and column change FAIL",()=>{
  const rs=sem();delete rs.relations[AB].constraints.ab7j_distinct_staff_approvers;
  rs.relations[CH].constraints.vox_chat_no_external_delivery_v1={...rs.relations[CH].constraints.vox_chat_no_external_delivery_v1,validated:false,deferrable:true,fk_delete:"c",columns:["id"]};
  const r=adj({semanticRestored:rs});
  assert.ok(codes(r).has("CONSTRAINT_REMOVED"));
  assert.ok(r.semanticFindings.filter(f=>f.code==="CONSTRAINT_CHANGED").length>=4);
  assert.equal(r.securityRegression,true);
});
test("trigger removed/disabled, unique index dropped and index predicate change FAIL",()=>{
  const ss=sem();
  ss.relations[CH].triggers={qf_vox_team_chat_immutability_v1:{enabled:"O",type:27,function:"public.f",columns:[],deferrable:false,initdeferred:false,nargs:0,args_md5:"x",old_table:"",new_table:"",when:null}};
  ss.relations[CH].indexes={chat_nonce_key:{am:"btree",unique:true,primary:false,valid:true,ready:true,nulls_not_distinct:"false",nkeyatts:1,natts:1,include:[],options:"",keys:[{col:"message_nonce",opclass:"uuid_ops",collation:"",option:0}],exprs:null,predicate:null}};
  const a=clone(ss),b=clone(ss);
  delete b.relations[CH].triggers.qf_vox_team_chat_immutability_v1;
  b.relations[CH].indexes.chat_nonce_key.unique=false;
  const c=codes(adj({semanticSource:a,semanticRestored:b}));
  assert.ok(c.has("TRIGGER_REMOVED"));assert.ok(c.has("INDEX_CHANGED"));
  const d=clone(ss);d.relations[CH].triggers.qf_vox_team_chat_immutability_v1.enabled="D";
  assert.ok(codes(adj({semanticSource:a,semanticRestored:d})).has("TRIGGER_CHANGED"));
});
test("non-portable expression trees cannot be proven by digest and block provisional parity",()=>{
  const a=sem(),b=sem();
  a.relations[CH].constraints.vox_chat_no_external_delivery_v1.expr=tree("u",true);
  b.relations[CH].constraints.vox_chat_no_external_delivery_v1.expr=tree("u",true);
  const r=adj({semanticSource:a,semanticRestored:b});
  assert.ok(codes(r).has("EXPR_NONPORTABLE_NEEDS_BEHAVIOR_PROOF"));
  assert.notEqual(r.verdict,"PROVISIONAL_SEMANTIC_PARITY");
});

// ------------------------------------------------------------------ behavior probes
test("probe expectations: anon/authenticated must be denied everywhere, constraints must reject exactly as written",()=>{
  assert.deepEqual(evaluateProbeExpectations(goodProbes()),[]);
  const q=goodProbes();q["priv/anon/chat/select"]="OK";q["priv/authenticated/ab7j/truncate"]="OK";q["chat/body_tab_rejected"]="OK";q["ab7j/owner_eq_target_rejected"]="ERR:23514:other:";
  const f=evaluateProbeExpectations(q);
  assert.equal(f.length,4,f.join("\n"));
  assert.ok(evaluateProbeExpectations({}).every(x=>/MISSING_PROBE/.test(x)));
});
test("service_role DML on chat is cross-compared but NOT asserted (candidate SQL only grants SELECT; default privileges may remain)",()=>{
  const q=goodProbes();q["priv/service_role/chat/insert"]="ERR:23502::";
  assert.deepEqual(evaluateProbeExpectations(q),[]);
  const q2=goodProbes();q2["priv/service_role/ab7j/select"]="OK";
  assert.equal(evaluateProbeExpectations(q2).length,1);
});
test("probe flips classify denied->allowed as widening and rejected->accepted as weakening",()=>{
  const a=goodProbes(),b=goodProbes();
  b["priv/anon/chat/insert"]="OK";b["exec/anon/qf_vox_f(uuid)"]="OK";b["chat/body_empty_rejected"]="OK";b["chat/valid_hello"]="ERR:23514::";
  const m=Object.fromEntries(compareProbes(a,b).map(f=>[f.path,f.code]));
  assert.equal(m["probe.priv/anon/chat/insert"],"PROBE_WIDENED");assert.equal(m["probe.exec/anon/qf_vox_f(uuid)"],"PROBE_WIDENED");
  assert.equal(m["probe.chat/body_empty_rejected"],"PROBE_WEAKENED");assert.equal(m["probe.chat/valid_hello"],"PROBE_OUTCOME_DIFFERS");
});
test("probes alone can fail an otherwise identical semantic snapshot; a failing SOURCE expectation also fails",()=>{
  const q=goodProbes();q["priv/anon/chat/select"]="OK";
  const r=adj({probesRestored:q});assert.equal(r.verdict,"SEMANTIC_DIVERGENCE");assert.ok(codes(r).has("PROBE_WIDENED"));
  const s=goodProbes();s["priv/anon/chat/select"]="OK";
  const r2=adj({probesSource:s,probesRestored:s});assert.equal(r2.verdict,"SEMANTIC_DIVERGENCE");assert.ok(r2.probeExpectationFailures.length>0);
});
test("missing semantic snapshot or probes is INCOMPLETE_EVIDENCE, never provisional",()=>{
  for(const o of [{semanticRestored:undefined},{probesSource:undefined},{probesRestored:undefined}]){
    const r=adj(o);assert.equal(r.verdict,"INCOMPLETE_EVIDENCE");assert.equal(r.exitCode,3);
  }
});
test("raw divergence without independent proof is RAW_DIVERGENCE_UNEXPLAINED (no whitelist)",()=>{
  for(const extra of [`$.relations.${AB}.owner`,`$.relations.${AB}.columns`,`$.relations.${AB}.effective`,`$.functions.qf_vox_ab7j_tl_approve_staff_suspend_v1(p_nonce uuid).body_md5`,`$.roles`,`$.default_acls`]){
    const r=adj({rawDiffPaths:[...THREE,extra]});
    assert.equal(r.verdict,"RAW_DIVERGENCE_UNEXPLAINED",extra);assert.equal(r.exitCode,3);
    assert.equal(r.rawDivergentPaths.find(x=>x.path===extra).proven,false);
  }
  const absent=adj({rawDiffPaths:[`$.relations.vox_never_snapshotted.acl`]});
  assert.equal(absent.verdict,"RAW_DIVERGENCE_UNEXPLAINED");
});
test("semantic snapshot of the wrong schema is rejected",()=>{
  const f=compareSemantic({schema:"x"},sem());assert.equal(f[0].code,"SEMANTIC_SNAPSHOT_SCHEMA_INVALID");
});
test("probe output parser rejects malformed and duplicate lines and sorts deterministically",()=>{
  assert.deepEqual(parseProbeOutput("b/x|OK\r\na/y|ERR:1::\r\n"),{"a/y":"ERR:1::","b/x":"OK"});
  assert.throws(()=>parseProbeOutput("nopipe"),/MALFORMED/);
  assert.throws(()=>parseProbeOutput("a|OK\na|OK"),/DUPLICATE/);
});

// ------------------------------------------------------------------ generated SQL safety
test("semantic catalog SQL is catalog-only, read-only framed, and uses acldefault for NULL ACL expansion",()=>{
  const sql=semanticCatalogSql(root);
  assert.match(sql,/^begin read only;/);assert.match(sql.trim(),/rollback;$/);
  assert.match(sql,/acldefault\(/);assert.match(sql,/aclexplode\(/);
  const code=sql.replace(/'(?:[^']|'')*'/g,"''").toLowerCase();
  assert.doesNotMatch(code,/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate|copy|do|call|commit|vacuum)\b/);
  assert.doesNotMatch(sql,/acl_is_default/); // raw null-vs-explicit flag must never leak into the semantic compare
});
test("behavior probe SQL: non-superuser SET LOCAL ROLE, replica-mode constraint isolation, always rolled back, nothing persistent",()=>{
  const sql=behaviorProbeSql(root);
  assert.match(sql,/^begin;/);assert.match(sql.trim(),/rollback;$/);
  assert.match(sql,/set local role %I/);
  assert.match(sql,/session_replication_role/);
  for(const role of ["anon","authenticated","service_role"])assert.ok(sql.includes(`'${role}'`));
  for(const id of ["priv/anon/ab7j/truncate","priv/service_role/chat/select","ab7j/owner_eq_target_rejected","chat/trigger_update_blocked"])assert.ok(sql.includes(id),id);
  assert.doesNotMatch(sql,/\bcommit\b|\bcopy\b|dblink|pg_read_file|lo_import|alter system|create role|drop (table|database|schema|role)|^\\/im);
  assert.equal((sql.match(/\bbegin;/g)||[]).length,1);
});

// ------------------------------------------------------------------ local write / network audit
test("assertSafeOutFile confines writes to the temp dir and refuses traversal, UNC, existing files, missing and non-temp dirs",()=>{
  const d=mkdtempSync(join(tmpdir(),"ab7k-sem-test-"));
  try{
    const ok=join(d,"out.json");
    assert.equal(assertSafeOutFile(ok),resolve(ok));
    assert.throws(()=>assertSafeOutFile(`${d}/../x.json`),/TRAVERSAL/);
    assert.throws(()=>assertSafeOutFile("\\\\host\\share\\x.json"),/UNC/);
    assert.throws(()=>assertSafeOutFile(resolve(root,"escape.json")),/OUTSIDE_TEMP/);
    assert.throws(()=>assertSafeOutFile(join(d,"missing","x.json")),/OUT_DIR_MISSING/);
    writeFileSync(ok,"x");assert.throws(()=>assertSafeOutFile(ok),/OUT_FILE_EXISTS/);
    mkdirSync(join(d,"sub"));
    assert.equal(assertSafeOutFile(join(d,"sub","a.json"),{tempRoot:d}),resolve(d,"sub","a.json"));
    assert.equal(isPathInside(d,join(d,"a")),true);assert.equal(isPathInside(d,d),false);assert.equal(isPathInside(d,resolve(d,"..")),false);
    assert.throws(()=>assertSafeOutFile(""),/REQUIRED/);
  }finally{rmSync(d,{recursive:true,force:true})}
});
test("semantic Node modules open no network/process/db channels and write only via assertSafeOutFile",()=>{
  for(const f of ["ab7k-semantic-lib.mjs","ab7k-semantic-evidence.mjs"]){
    const t=read(f);
    assert.doesNotMatch(t,/node:(net|http|https|http2|dgram|dns|tls|child_process|worker_threads|cluster)|\bfetch\(|XMLHttpRequest|WebSocket|process\.env|\bpg\b from/,f);
  }
  const cli=read("ab7k-semantic-evidence.mjs");
  assert.equal((cli.match(/writeFileSync\(/g)||[]).length,1);
  assert.match(cli,/writeFileSync\(assertSafeOutFile\(/);
  assert.doesNotMatch(read("ab7k-semantic-lib.mjs"),/writeFileSync|appendFileSync|createWriteStream|mkdirSync|rmSync/);
});
const code=ps=>read(ps).split(/\r?\n/).filter(l=>!/^\s*#/.test(l));
const FORBIDDEN=/Invoke-WebRequest|Invoke-RestMethod|\bcurl\b|\bwget\b|\bStart-BitsTransfer\b|Net\.WebClient|Net\.Sockets|\bgit\s|\bnpm\s|\bnpx\s|Set-ExecutionPolicy|Remove-Item|Invoke-Expression|\biex\b|docker\s+(pull|login|push|save|load|build|commit|network\s+(create|connect))|--privileged|--network\s+host|--net\s+host|--volume|--mount|--publish|--device|--cap-add|--pid\s+host|docker\.sock|New-NetFirewall|Add-MpPreference|reg\s+add|schtasks|Start-Process|Register-ScheduledTask/i;
for(const ps of ["validate-voxAB7K-recovery-semantic-pg17.ps1","validate-voxAB7K-recovery-harness-pg17.ps1"]){
  test(`${ps}: no network clients, no privileged/host/bind docker flags, no process/persistence writes`,()=>{
    for(const l of code(ps))assert.doesNotMatch(l,FORBIDDEN,`${ps}: ${l.trim()}`);
    for(const l of code(ps).filter(x=>/docker\s+run/.test(x))){
      assert.match(l,/--network none/);assert.match(l,/--pull never/);
      assert.doesNotMatch(l,/\s-v\s|\s-p\s/);
    }
    assert.equal(code(ps).filter(x=>/docker\s+run/.test(x)).length,1);
  });
  test(`${ps}: output confined to a fresh temp directory and only self-created containers are removed`,()=>{
    const t=code(ps).join("\n");
    assert.match(t,/OUTDIR_OUTSIDE_TEMP/);assert.match(t,/OUTDIR_ALREADY_EXISTS/);assert.match(t,/OUTDIR_TRAVERSAL/);assert.match(t,/OUTDIR_UNC/);
    assert.match(t,/DOCKER_HOST_NOT_LOCAL/);assert.match(t,/IMAGE_NOT_PRESENT_LOCALLY/);
    assert.match(t,/\$created\.Add\(\$c\)/);
    assert.match(t,/foreach\(\$c in \$created\)\{docker rm -f -v \$c/);
    assert.doesNotMatch(t,/\$all\b/);
    const rms=code(ps).filter(x=>/docker\s+rm/.test(x));
    assert.equal(rms.length,1);
    assert.match(t,/NETWORK_NOT_NONE/);
  });
}
test("new harness: every host write targets $OutDir; nothing writes into the repo tree",()=>{
  const lines=code("validate-voxAB7K-recovery-semantic-pg17.ps1");
  for(const l of lines.filter(x=>/WriteAllText|Set-Content|Out-File|Add-Content|New-Item|docker\s+cp/.test(x)))
    assert.match(l,/\$OutDir/,l.trim());
  for(const l of lines.filter(x=>/--out\s/.test(x)))assert.match(l,/Join-Path \$OutDir/,l.trim());
  assert.doesNotMatch(lines.join("\n"),/Join-Path \$root[^\n]*(WriteAllText|Set-Content|--out)/);
});
test("old harness: every Snapshot() output path is under $OutDir",()=>{
  for(const l of code("validate-voxAB7K-recovery-harness-pg17.ps1").filter(x=>/^\s*Snapshot \$/.test(x)))assert.match(l,/\(Join-Path \$OutDir/,l.trim());
});
test("new harness runs the negative control and the strict raw compare; exit semantics are explicit",()=>{
  const t=read("validate-voxAB7K-recovery-semantic-pg17.ps1");
  assert.match(t,/ab7k_mutant/);assert.match(t,/ACL_WIDENED/);assert.match(t,/CONSTRAINT_EXPR_CHANGED/);assert.match(t,/\$exit=if\(-not \$controlOk\)\{5\}else\{\$primary\}/);
  assert.match(t,/compare --a .*source\.snapshot\.json/);
  assert.match(t,/SET LOCAL ROLE|set local role|Probes \$rst/i);
  assert.match(t,/AB7K_MANAGED_RESTORATION=BLOCKED/);
  assert.doesNotMatch(t,/AB7K_MANAGED_RESTORATION=(PASS|OK|GO)/);
});

// ------------------------------------------------------------------ RC3 packet honesty
test("RC3 packet keeps managed restoration BLOCKED, preserves RAW_DIVERGENCE, and fabricates no evidence or signoff",()=>{
  const t=readFileSync(resolve(root,"docs/vox/VOX-AB7K-RC3-RECOVERY-SEMANTIC-20261030.md"),"utf8");
  assert.match(t,/RAW_DIVERGENCE/);assert.match(t,/candidate-semantic-parity-provisional/);
  assert.match(t,/BLOCKED/);assert.match(t,/NOT EXECUTED/i);
  assert.match(t,/no (human|qualified)[^\n]*sign/i);
  assert.doesNotMatch(t,/managed restoration[^\n]*\b(PASS|verified|certified|complete)\b/i);
  assert.doesNotMatch(t,/PITR[^\n]*\b(verified|proven|restored)\b/i);
});
