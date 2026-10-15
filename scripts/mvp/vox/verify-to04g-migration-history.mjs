import {readFileSync} from "node:fs";
const path=new URL("../../../ops/vox/certification/TO04G-READONLY-MIGRATION-METADATA.json",import.meta.url);
export function inspect(manifest){
 if(!manifest||manifest.schema!=="qf.vox.to04g.readonly-migration-history.v1"||
    manifest.authorization!==false||manifest.ready!==false||
    !Array.isArray(manifest.environments?.staging?.migrations)||
    !Array.isArray(manifest.environments?.production?.migrations))
  return {ok:false,ready:false,error:"INVALID_AUDIT_PROVENANCE"};
 const st=manifest.environments.staging.migrations,pr=manifest.environments.production.migrations;
 if(st.length!==86||pr.length!==86||
    st.some(x=>typeof x.version!=="string"||!/^[0-9]{14}$/.test(x.version)||
     typeof x.name!=="string"||!/^[a-z0-9_]+$/.test(x.name))||
    pr.some(x=>typeof x.version!=="string"||!/^[0-9]{14}$/.test(x.version)||
     typeof x.name!=="string"||!/^[a-z0-9_]+$/.test(x.name)))
  return {ok:false,ready:false,error:"INCOMPLETE_MIGRATION_LIST"};
 const versions=a=>new Map(a.map(x=>[x.version,x.name]));
 const names=a=>a.reduce((m,x)=>{m.set(x.name,[...(m.get(x.name)??[]),x.version]);return m},new Map());
 const sv=versions(st),pv=versions(pr),sn=names(st),pn=names(pr);
 if(sv.size!==86||pv.size!==86)
  return {ok:false,ready:false,error:"DUPLICATE_MIGRATION_VERSION"};
 const sharedExactVersion=[...sv].filter(([version])=>pv.has(version)).length;
 const shifted=[...sn].filter(([name,vers])=>pn.has(name)&&!vers.some(v=>pn.get(name).includes(v))).length;
 const uniqueStagingNames=[...sn.keys()].filter(x=>!pn.has(x)).length;
 const uniqueProductionNames=[...pn.keys()].filter(x=>!sn.has(x)).length;
 const sharedNames=[...sn.keys()].filter(x=>pn.has(x)).length;
 const duplicateNamesStaging=[...sn].filter(([,v])=>v.length>1).length;
 const duplicateNamesProduction=[...pn].filter(([,v])=>v.length>1).length;
 const expected={sharedExactVersions:sharedExactVersion,sharedDistinctNames:sharedNames,
  sharedNameDifferentVersion:shifted,stagingOnlyNames:uniqueStagingNames,
  productionOnlyNames:uniqueProductionNames};
 const c=manifest.comparison;
 if(c.sharedExactVersions!==expected.sharedExactVersions||
    c.sharedDistinctNames!==expected.sharedDistinctNames||
    c.sharedNameDifferentVersion!==expected.sharedNameDifferentVersion||
    c.stagingOnlyNames?.length!==expected.stagingOnlyNames||
    c.productionOnlyNames?.length!==expected.productionOnlyNames||
    manifest.environments.staging.duplicateNames?.length!==duplicateNamesStaging||
    manifest.environments.production.duplicateNames?.length!==duplicateNamesProduction)
  return {ok:false,ready:false,error:"MIGRATION_COMPARISON_INCONSISTENT"};
 return {ok:true,ready:false,reason:"INDEPENDENT_DBA_SQL_DIFF_AND_RESTORE_REQUIRED",
  counts:{staging:st.length,production:pr.length,sharedExactVersions:sharedExactVersion,
   sharedNames,shiftedNameVersionPairs:shifted,
   stagingOnlyNames:uniqueStagingNames,productionOnlyNames:uniqueProductionNames,
   duplicateNamesStaging,duplicateNamesProduction},
  legalNextStep:"Independently compare version/name to immutable SQL content SHA, schema changes and tested restore. Never rename recorded migration IDs automatically."};
}
const report=inspect(JSON.parse(readFileSync(path,"utf8")));
if(import.meta.url===`file://${process.argv[1]}`){
 console.log(JSON.stringify(report));
 if(process.argv.includes("--release-check"))process.exit(report.ready?0:42);
 process.exit(report.ok?0:1);
}
