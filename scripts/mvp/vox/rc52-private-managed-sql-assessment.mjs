#!/usr/bin/env node
// Read-only PRIVATE managed SQL evidence assessment. It never publishes SQL,
// applies a migration, infers aliases, or certifies independently verified provenance.
import {readFileSync,readdirSync,lstatSync,realpathSync} from "node:fs";
import {resolve,join,dirname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {canonicalSqlDigest} from "./rc35-migration-inventory-reconcile.mjs";
import {renderStatements,parseEvidence,DEFAULT_EVIDENCE} from "./rc40-managed-ledger-reconciler.mjs";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const SHA=/^[a-f0-9]{40}$/,VERSION=/^\d{14}$/;
const hash=s=>createHash("sha256").update(s).digest("hex");
const hashMd5=s=>createHash("md5").update(s).digest("hex");
const fail=(s)=>{throw Error("RC52_PRIVATE_CAPTURE_"+s);};
export function assessPrivateCapture({candidateSha,evidenceText,privateDir,read=readFileSync,list=readdirSync,stat=lstatSync}){
 if(!SHA.test(candidateSha||""))fail("EXACT_SHA_REQUIRED");
 if(typeof privateDir!=="string"||!privateDir.trim())fail("DIRECTORY_REQUIRED");
 const dir=resolve(privateDir);
 const canonical=realpathSync(dir),isInside=x=>
  x.toLowerCase()===root.toLowerCase()||
  x.toLowerCase().startsWith(root.toLowerCase()+sep);
 if(isInside(dir)||isInside(canonical))fail("PRIVATE_DIR_MUST_BE_OUTSIDE_REPOSITORY");
 const ev=parseEvidence(evidenceText);
 const expected=new Map(ev.managedOnly.map(e=>[e.version,e.name]));
 const filenames=list(dir).filter(f=>f!=="_verification.json").sort();
 if(stat(join(dir,"_verification.json")).isSymbolicLink())fail("VERIFICATION_SYMLINK_DENIED");
 const verification=JSON.parse(read(join(dir,"_verification.json"),"utf8"));
 if(verification.schema!=="qf.vox.rc52.staging-ledger-second-read.v1"||
    verification.readOnly!==true||verification.projectName!=="QuickFurno Staging"||
    !Array.isArray(verification.versions)||verification.versions.length!==expected.size)
  fail("SECOND_READ_MANIFEST_INVALID");
 const verifiedByVersion=new Map(verification.versions.map(v=>[v.version,v]));
 if(verifiedByVersion.size!==expected.size)fail("SECOND_READ_DUPLICATE_VERSION");
 const allowed=/^\d{14}(?:\.part\d{3})?\.json$/;
 if(filenames.some(f=>!allowed.test(f)||stat(join(dir,f)).isSymbolicLink()))fail("FILE_SET_UNTRUSTED");
 const versions=new Set(),consumedFiles=new Set(),digests=new Map(),duplicates=[],entries=[],match=new Map(ev.entries.map(e=>[e.canonicalSha256,e.file]));
 let statementsTotal=0,bytesTotal=0;
 for(const [version,name] of expected){
  const files=filenames.filter(f=>f===version+".json"||f.startsWith(version+".part"));
  if(!files.length)fail("ORIGINAL_MISSING_"+version);
  for(const f of files)consumedFiles.add(f);
  const pieces=files.map(f=>{
   const o=JSON.parse(read(join(dir,f),"utf8"));
   if(o.version!==version||o.name!==name||!Array.isArray(o.statements)||
      !o.statements.length||o.statements.some(x=>typeof x!=="string"||!x.trim()))
    fail("INVALID_VERSION_OR_STATEMENTS_"+version);
   return {file:f,...o};
  });
  let statements;
  if(pieces.length===1&&pieces[0].file===version+".json"){
   statements=pieces[0].statements;
  }else{
   let index=1;statements=[];
   for(const p of pieces){
    if(p.file!==version+".part"+String(Math.ceil(index/100)).padStart(3,"0")+".json"||
       !Number.isSafeInteger(p.from)||p.from!==index||
       !Number.isSafeInteger(p.to)||p.to!==index+p.statements.length-1)
     fail("BASELINE_SLICE_GAP_OR_OVERLAP_"+version);
    statements.push(...p.statements);index=p.to+1;
   }
  }
  if(versions.has(version))fail("DUPLICATE_VERSION");versions.add(version);
  const v=verifiedByVersion.get(version);
  if(!v||v.name!==name||v.statement_count!==statements.length||
     !/^[a-f0-9]{32}$/.test(v.raw_join_md5||"")||
     hashMd5(statements.join("\n"))!==v.raw_join_md5)
   fail("SECOND_READ_CONTENT_DRIFT_"+version);
  const rendered=renderStatements(statements);
  const digest=canonicalSqlDigest(rendered);
  // Managed history can legitimately contain re-applied identical statements.
  // Flag duplicate versions for independent adjudication; never pretend uniqueness.
  if(digests.has(digest))duplicates.push({version,sameAs:digests.get(digest)});
  else digests.set(digest,version);
  statementsTotal+=statements.length;bytesTotal+=rendered.length;
  entries.push({version,name,statementCount:statements.length,
   renderedBytes:rendered.length,canonicalSqlSha256:digest,
   exactSourceFile:match.get(digest)||null});
 }
 // Capture manifests may be rechunked without changing SQL; allow only files
 // belonging to an expected version and require exact contiguous slice proof.
 if(filenames.some(f=>!consumedFiles.has(f))||versions.size!==expected.size)
  fail("UNEXPECTED_CAPTURE_FILES");
 const exact=entries.filter(x=>x.exactSourceFile!==null);
 const uniqueExactSources=new Set(exact.map(x=>x.exactSourceFile));
 return {schema:"qf.vox.rc52.private-managed-original-assessment.v1",
  candidateSha,originalManagedVersions:expected.size,
  withOriginalSql:entries.length,sqlStatementCount:statementsTotal,
  renderedBytes:bytesTotal,exactSourceMatched:exact.length,
  sourceOnlyCount:ev.entries.length,
  duplicateCanonicalSqlVersions:duplicates,
  sourceFilesStillUnmatched:ev.entries.length-uniqueExactSources.size,
  uniqueSourceFilesExactlyMatched:uniqueExactSources.size,
  secondReadContentDigestsVerified:entries.length,
  provenance:"CONNECTED_STAGING_READ_ONLY_CAPTURE_UNINDEPENDENT",
  captureStoredPrivateOutsideRepository:true,
  rawSqlExportedToGit:false,
  independentOriginalsVerified:false,isolatedManagedRestoreCertified:false,
  dbApproval:false,appSecApproval:false,releaseGo:false,managedWrites:false,
  sqlExecuted:false,financeActivated:false,officialEodPublished:false,
  reviewEntries:entries,
  requiredNext:"Independently confirm captured migration ledger against live managed catalog and human-reviewed source alias mapping; do not assume canonical matches or enable operations."};
}
export function runCli(argv,io={log:console.log,err:console.error}){
 if(argv.length!==3||argv[0]!=="--private-dir"||!argv[1]||!SHA.test(argv[2]||"")){
  io.err("RC52_USAGE --private-dir <outside-repo-private-dir> <exact-40-char-sha>");return 1;
 }
 try{
  const result=assessPrivateCapture({candidateSha:argv[2],
   evidenceText:readFileSync(DEFAULT_EVIDENCE,"utf8"),privateDir:argv[1]});
  io.log(JSON.stringify(result,null,2));io.log("RC52_ORIGINAL_SQL_CAPTURED_RELEASE=HOLD");return 2;
 }catch(e){io.err(String(e?.message||e));return 1;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 process.exitCode=runCli(process.argv.slice(2));
