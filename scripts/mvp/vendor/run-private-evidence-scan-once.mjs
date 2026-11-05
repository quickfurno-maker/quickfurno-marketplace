/**
 * ONE-SHOT, manual Staging-only scanner. NOT an API, cron job or background
 * service. No execution without separate Owner deployment/provisioning approval.
 * Uses the private Supabase object bucket plus the local loopback ClamAV daemon.
 * No file contents, object paths, phone details or scanner signatures logged.
 *
 * EXTERNAL STAGING IS ON HOLD IN DRAFT PR #484. Do not run against managed
 * environments without the Owner's separate permission and a tested backup.
 */
import {createHash} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {
  MAX_PRIVATE_SCAN_BYTES,validatePrivateScanCandidate,
  scanPrivateDocumentWithLocalClamav,
} from "../../../lib/vendors/privateClamavScanner.mjs";

const STAGING_PROJECT_REF="uckafzuochmbvtiodmcl";
const BUCKET="qf-vendor-verification-private";
const BUILD="ClamAV_local_engine_v1";
function permitted(){
 try{
  const uri=new URL(process.env.NEXT_PUBLIC_SUPABASE_URL??"");
  return process.argv.length===3 &&
   process.argv[2]==="--execute-approved-staging-once" &&
   process.env.QF_VENDOR_PRIVATE_SCAN_MODE==="staging" &&
   process.env.QF_VENDOR_CLAMAV_ENGINE_CERTIFIED==="staging" &&
   process.env.QF_VENDOR_PRIVATE_BUCKET_CERTIFIED==="staging" &&
   process.env.QF_VENDOR_PRIVATE_SCAN_ONCE_APPROVED==="explicitly_authorized" &&
   process.env.QF_VENDOR_SCAN_PROJECT_REF===STAGING_PROJECT_REF &&
   uri.protocol==="https:" &&
   uri.hostname===STAGING_PROJECT_REF+".supabase.co" &&
   uri.username===""&&uri.password===""&&uri.pathname==="/"&&
   typeof process.env.SUPABASE_SERVICE_ROLE_KEY==="string" &&
   process.env.SUPABASE_SERVICE_ROLE_KEY.length>40;
 }catch{return false;}
}
async function run(){
 if(!permitted()){
  process.stderr.write("PRIVATE_SCAN_DISABLED: explicit approved Staging-only gates required\n");
  process.exitCode=3;
  return;
 }
 const db=createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,
  {auth:{persistSession:false,autoRefreshToken:false}},
 );
 const bucket=await db.storage.getBucket(BUCKET);
 if(bucket.error||!bucket.data||bucket.data.public!==false)
  throw new Error("PRIVATE_BUCKET_UNSAFE_OR_MISSING");
 const {data,error}=await db.rpc("qf_vendor_private_scan_queue");
 if(error||!Array.isArray(data)||data.length>4||
    data.some(item=>!validatePrivateScanCandidate(item)))
  throw new Error("PRIVATE_SCAN_QUEUE_UNTRUSTED");
 let clean=0,rejected=0,pending=0;
 for(const item of data){
  const download=await db.storage.from(BUCKET).download(item.storageKey);
  if(download.error||!download.data){
   pending++;
   continue;
  }
  if(download.data.size<8||download.data.size>MAX_PRIVATE_SCAN_BYTES){
   pending++;
   continue;
  }
  const bytes=Buffer.from(await download.data.arrayBuffer());
  if(bytes.length!==download.data.size||
     createHash("sha256").update(bytes).digest("hex")!==item.sha256){
   pending++;
   continue;
  }
  const verdict=await scanPrivateDocumentWithLocalClamav(bytes);
  bytes.fill(0);
  if(verdict!=="clean"&&verdict!=="infected"){
   pending++;
   continue; // daemon missing/errors/unknown response NEVER imply clean
  }
  const stored=await db.rpc("qf_vendor_record_private_scan",{
   p_evidence_id:item.evidenceId,
   p_expected_sha256:item.sha256,
   p_verdict:verdict,
   p_scanner_build:BUILD,
  });
  if(stored.error||stored.data!==(verdict==="clean"?"clean":"rejected")){
   pending++;
   continue; // case changed/revoked or concurrent worker won
  }
  if(verdict==="clean")clean++;
  else rejected++;
 }
 process.stdout.write(JSON.stringify({
   mode:"staging_once_only",kind:"PRIVATE_VENDOR_SCAN_SUMMARY",
   candidates:data.length,clean,rejected,pending,
   automaticEvidenceApproval:false,automaticVendorActivation:false,
 })+"\n");
}
run().catch(()=>{
 process.stderr.write("PRIVATE_SCAN_FAILED_CLOSED: no automatic re-run or fallback\n");
 process.exitCode=1;
});
