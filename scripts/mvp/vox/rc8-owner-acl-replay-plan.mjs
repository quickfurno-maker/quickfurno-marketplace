// RC8 disposable-only ACL replay plan. Pure, no DB connections.
// Exact two-path catalog diff and explicit owner-only ACL are required.
import {readFileSync} from "node:fs";
const TABLE="vox_ab7j_staff_suspend_intents_candidate_v1";
const FIELDS=["$.relations."+TABLE+".acl","$.relations."+TABLE+".acl_is_default"].sort();
const PRIV=["DELETE","INSERT","MAINTAIN","REFERENCES","SELECT","TRIGGER","TRUNCATE","UPDATE"].sort();
export function createRc8OwnerAclReplayPlan({source,restored,diff}={}){
 const paths=diff?.differingPaths;
 if(!Array.isArray(paths)||paths.length!==2||
  paths.slice().sort().join("|")!==FIELDS.join("|"))return null;
 const src=source?.relations?.[TABLE],dst=restored?.relations?.[TABLE];
 if(!src||!dst||src.owner!=="postgres"||dst.owner!=="postgres"||
    src.acl_is_default!==false||dst.acl_is_default!==true||
    !Array.isArray(src.acl)||src.acl.length!==8)return null;
 const grants=src.acl.map(s=>{
  const x=typeof s==="string"?s.split("|"):[];
  return x.length===4&&x[0]==="postgres"&&x[1]==="postgres"&&x[3]==="false"?x[2]:null;
 });
 if(grants.includes(null)||grants.sort().join("|")!==PRIV.join("|"))return null;
 if(dst.acl!==null&&!Array.isArray(dst.acl))return null;
 const table="public."+TABLE;
 return Object.freeze({type:"LOCAL_DISPOSABLE_POSTRESTORE_ACL_REPLAY",
  table,owner:"postgres",sql:"REVOKE ALL PRIVILEGES ON TABLE "+table+" FROM postgres;\n"+
  "GRANT ALL PRIVILEGES ON TABLE "+table+" TO postgres;"});
}
if(process.argv.some(x=>x.endsWith("rc8-owner-acl-replay-plan.mjs"))){
 const argv=process.argv.slice(2);
 if(argv.length!==3){console.error("USAGE source restored diff");process.exit(2);}
 try{
  const [source,restored,diff]=argv.map(p=>JSON.parse(readFileSync(p,"utf8")));
  const plan=createRc8OwnerAclReplayPlan({source,restored,diff});
  if(!plan){console.error("RC8_ACL_REPLAY_REFUSED_UNEXPECTED_DIFF");process.exit(3);}
  console.log(plan.sql);
 }catch{console.error("RC8_ACL_REPLAY_REFUSED_BAD_SNAPSHOT");process.exit(4);}
}
