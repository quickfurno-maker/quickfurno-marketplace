#!/usr/bin/env node
// FINAL-2 B: disposable PG17 destination-lock concurrency; NOT a Core writer.
import {execFileSync,spawn} from "node:child_process";
const name="qf-vox-final2-consent-lock", hash="a".repeat(64);
const dest="'dst|"+hash+"|whatsapp'";
const docker=(args,options={})=>execFileSync("docker",args,{encoding:"utf8",timeout:15000,windowsHide:true,...options}).trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let created=false,locker=null;
try{
 if(process.env.DOCKER_HOST&&!/^(npipe|unix):\/\//.test(process.env.DOCKER_HOST))throw Error("REMOTE_DOCKER_REFUSED");
 docker(["image","inspect","postgres:17-alpine"]);
 if(docker(["ps","-aq","--filter","name=^/"+name+"$"]))throw Error("CONTAINER_NAME_COLLISION");
 docker(["run","--pull","never","--rm","-d","--network","none","--name",name,
  "-e","POSTGRES_PASSWORD=synthetic_only","postgres:17-alpine"]);
 created=true;
 let ready=false;
 for(let i=0;i<90;i++){
  let logs="";try{logs=docker(["logs",name]);}catch{}
  if(logs.includes("PostgreSQL init process complete; ready for start up.")){
   try{if(docker(["exec",name,"psql","-X","-A","-t","-U","postgres","-d","postgres","-c","SELECT 1;"])==="1"){ready=true;break;}}catch{}
  }
  await sleep(180);
 }
 if(!ready)throw Error("PG17_FINAL_SERVER_NOT_READY");
 const psql=["exec","-i",name,"psql","-X","-A","-t","-q","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1"];
 locker=spawn("docker",psql,{stdio:["pipe","pipe","pipe"],windowsHide:true});
 let output="",error="";
 locker.stdout.on("data",v=>{output+=v.toString("utf8");});
 locker.stderr.on("data",v=>{error+=v.toString("utf8");});
 locker.stdin.end("BEGIN;\nSELECT pg_advisory_xact_lock(hashtextextended("+dest+",0));\nSELECT 'LOCK_HELD';\nSELECT pg_sleep(4);\nROLLBACK;\n");
 let started=false;
 for(let i=0;i<140;i++){if(output.includes("LOCK_HELD")){started=true;break}await sleep(30);}
 if(!started)throw Error("LOCKER_SESSION_NOT_HELD "+error.slice(0,120));
 const sql="SELECT pg_try_advisory_xact_lock(hashtextextended("+dest+",0));";
 const blocked=docker(["exec",name,"psql","-X","-A","-t","-U","postgres","-d","postgres","-c",sql]);
 if(blocked!=="f")throw Error("DESTINATION_LOCK_DID_NOT_BLOCK_SECOND_SESSION "+blocked);
 await new Promise((res,rej)=>{
  const t=setTimeout(()=>rej(Error("LOCKER_EXIT_TIMEOUT")),12000);
  locker.once("exit",c=>{clearTimeout(t);c===0?res():rej(Error("LOCKER_EXIT_"+c+" "+error))})
 });
 const released=docker(["exec",name,"psql","-X","-A","-t","-U","postgres","-d","postgres","-c",sql]);
 if(released!=="t")throw Error("DESTINATION_LOCK_NOT_RELEASED "+released);
 console.log("VOX_FINAL2_DISPOSABLE_PG17_CONSENT_DESTINATION_LOCK_PASS two_sessions=true managed_mutation=false");
}catch(e){console.error("VOX_FINAL2_CONSENT_DESTINATION_LOCK_FAIL "+e.message);process.exitCode=1;}
finally{
 try{if(locker&&!locker.killed)locker.kill();}catch{}
 if(created)try{docker(["rm","-f","-v",name],{timeout:15000});}catch{}
}
