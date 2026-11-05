#!/usr/bin/env node
/**
 * A benign EICAR engine-behavior preflight, using ONLY 127.0.0.1 clamd INSTREAM.
 * No managed database, private Storage, credentials, evidence objects or uploads.
 * Observing the two correct responses does NOT certify the engine binary,
 * active signature DB, deployment topology or enable any vendor functionality.
 */
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {scanPrivateDocumentWithLocalClamav} from "../../../lib/vendors/privateClamavScanner.mjs";

const cleanControl=()=>Buffer.from("QuickFurno benign synthetic scanner control. No real vendor documents.","ascii");
// Assemble at runtime to avoid creating a standalone antivirus test-file on disk.
const infectedControl=()=>Buffer.from([
 "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-",
 "STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
].join(""),"ascii");

export async function probeLocalClamavBehavior(scan=scanPrivateDocumentWithLocalClamav){
 const clean=cleanControl(),testSignature=infectedControl();
 try{
  const benignVerdict=await scan(clean);
  const testVerdict=await scan(testSignature);
  const observed=benignVerdict==="clean"&&testVerdict==="infected";
  return {
   schema:"qf.vendor.private-clamav-local-behavior.v1",
   probeMode:"LOOPBACK_ONLY",
   cleanControl:benignVerdict,
   eicarControl:testVerdict,
   behaviorObserved:observed,
   result:observed?"LOCAL_SIGNATURE_BEHAVIOR_OBSERVED":"LOCAL_ENGINE_NOT_BEHAVIOR_CERTIFIED",
   engineBinaryAttested:false,signatureDatabaseAttested:false,
   productionTopologyVerified:false,managedStorageTouched:false,
   managedDatabaseTouched:false,realEvidenceScanned:false,
   canEnablePrivateScan:false,canEnableEvidenceReview:false,
   releaseDecision:"HOLD",
   remainingGates:[
     "INDEPENDENT_CLAMAV_DAEMON_BINARY_AND_SIGNATURE_VERSION_ATTESTATION",
     "PRIVILEGED_ENGINE_AND_PRIVATE_BUCKET_DEPLOYMENT_REVIEW",
     "MANAGED_STAGING_PRIVATE_SCAN_RECEIPT_AND_QUARANTINE_UAT",
     "OWNER_EXPLICIT_STAGING_AUTHORIZATION"
   ]
  };
 }finally{clean.fill(0);testSignature.fill(0);}
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
 if(process.argv.length!==3||process.argv[2]!=="--probe-local-loopback"){
  process.stderr.write("USAGE: node certify-vendor-clamav-local-behavior.mjs --probe-local-loopback\n");
  process.exitCode=2;
 }else{
  const result=await probeLocalClamavBehavior();
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  if(!result.behaviorObserved)process.exitCode=2;
 }
}
