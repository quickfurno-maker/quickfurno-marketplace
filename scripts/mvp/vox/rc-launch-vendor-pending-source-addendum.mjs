#!/usr/bin/env node
/**
 * Exact seven-file source-only addendum to the immutable 162-file October
 * VOX migration snapshot. Never edit or rebaseline the October capture.
 * Exemptions are NOT generic: every newer vendor SQL filename and raw byte
 * hash is pinned from the independently reviewed November vendor source.
 * Verifying these bytes cannot authorize any managed migration or deployment.
 */
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {MIGRATIONS} from "../vendor/vendor-seven-migration-fingerprint.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
export const VENDOR_ADDITIONAL_FILES=Object.freeze(MIGRATIONS.map(([file])=>file));
const pinned=new Map(MIGRATIONS);
export function validatePinnedVendorPendingFiles({names,sourceDir,allowAbsent=false}){
 if(!Array.isArray(names)||names.some(n=>typeof n!=="string"||!/^\d{14}_.+\.sql$/.test(n)))
  throw Error("VENDOR_ADDENDUM_INVALID_NAMES");
 const seen=new Set(names);
 if(seen.size!==names.length)throw Error("VENDOR_ADDENDUM_DUPLICATE_FILENAME");
 const present=VENDOR_ADDITIONAL_FILES.filter(f=>seen.has(f));
 if(!present.length&&allowAbsent)return Object.freeze({files:Object.freeze([]),count:0,verified:false});
 if(present.length!==VENDOR_ADDITIONAL_FILES.length)throw Error("VENDOR_ADDENDUM_INCOMPLETE");
 if(typeof sourceDir!=="string"||!sourceDir.trim())throw Error("VENDOR_ADDENDUM_SOURCE_DIRECTORY_REQUIRED");
 for(const name of present){
  let bytes;
  try{bytes=readFileSync(join(sourceDir,name));}
  catch{throw Error("VENDOR_ADDENDUM_SOURCE_UNREADABLE:"+name);}
  if(sha(bytes)!==pinned.get(name))throw Error("VENDOR_ADDENDUM_RAW_SHA_DRIFT:"+name);
 }
 return Object.freeze({
  files:Object.freeze(present),count:present.length,verified:true,
  managedStagingVerified:false,managedProductionVerified:false,
  applied:false,releaseGo:false,authorizesDeployment:false
 });
}
