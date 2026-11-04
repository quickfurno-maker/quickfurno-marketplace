/**
 * ClamAV clamd INSTREAM client for privately stored vendor office/category
 * proof. Strict LOOPBACK transport only, no public URL or external HTTP.
 * A local ClamAV daemon is an independently installed and signed-off
 * dependency, NOT activated by bundling this file. Scanner uncertainty
 * must leave private evidence pending, never mark it clean.
 */
import {createConnection} from "node:net";

export const MAX_PRIVATE_SCAN_BYTES=5*1024*1024;
const MAX_RESPONSE_BYTES=512;
const INSTREAM=Buffer.from("zINSTREAM\0","ascii");
const LOOPBACK="127.0.0.1";

export function validatePrivateScanCandidate(candidate){
 if(!candidate||typeof candidate!=="object"||Array.isArray(candidate))return false;
 const keys=["caseId","caseVersion","evidenceId","sha256","storageKey","vendorId"];
 const actual=Object.keys(candidate).sort();
 if(actual.join(",")!==keys.join(","))return false;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
 if(!uuid.test(candidate.caseId)||!uuid.test(candidate.evidenceId)||
    !uuid.test(candidate.vendorId)||!Number.isSafeInteger(candidate.caseVersion)||
    candidate.caseVersion<1 || candidate.caseVersion>100000 ||
    typeof candidate.sha256!=="string"||
    !/^[0-9a-f]{64}$/.test(candidate.sha256)||
    typeof candidate.storageKey!=="string")return false;
 const key=new RegExp(
  "^vendors/"+candidate.vendorId.replaceAll("-","\\-")+
  "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(pdf|png|jpg)$","i");
 return key.test(candidate.storageKey);
}

/**
 * Only this exact response from an isolated ClamAV INSTREAM transaction
 * establishes a verdict. Neither MIME sniffing nor an HTTP 200 is a scan.
 * "FOUND" is a rejection with no threat name ever disclosed to the vendor.
 */
export function parsePrivateClamavResponse(value){
 if(typeof value!=="string"||value.length>MAX_RESPONSE_BYTES)return "unavailable";
 const v=value.replace(/\0$/,"").trim();
 if(v==="stream: OK")return "clean";
 if(/^stream: [^\r\n\0]{1,300} FOUND$/.test(v))return "infected";
 return "unavailable";
}

export async function scanPrivateDocumentWithLocalClamav(bytes,{port=3310,timeoutMs=10000}={}){
 if(!Buffer.isBuffer(bytes)||bytes.length<8||bytes.length>MAX_PRIVATE_SCAN_BYTES||
    !Number.isInteger(port)||port<1||port>65535 ||
    !Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
  return "unavailable";

 return await new Promise(resolve=>{
  let finished=false;
  let output=Buffer.alloc(0);
  const socket=createConnection({host:LOOPBACK,port});
  const finish=outcome=>{
   if(finished)return;
   finished=true;
   socket.destroy();
   resolve(outcome);
  };
  socket.setTimeout(timeoutMs,()=>finish("unavailable"));
  socket.on("error",()=>finish("unavailable"));
  socket.on("close",()=>{if(!finished)finish("unavailable");});
  socket.on("data",chunk=>{
   output=Buffer.concat([output,chunk]);
   if(output.length>MAX_RESPONSE_BYTES)return finish("unavailable");
   if(output.includes(0))finish(parsePrivateClamavResponse(output.toString("utf8")));
  });
  socket.on("connect",()=>{
   try{
    socket.write(INSTREAM);
    for(let offset=0;offset<bytes.length;offset+=65536){
     const frame=bytes.subarray(offset,Math.min(offset+65536,bytes.length));
     const length=Buffer.alloc(4);
     length.writeUInt32BE(frame.length);
     socket.write(length);
     socket.write(frame);
    }
    const terminator=Buffer.alloc(4);
    socket.end(terminator);
   }catch{finish("unavailable");}
  });
 });
}
