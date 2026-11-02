import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {sameVendorTaskCreate} from "../../../lib/crm/vendorTaskIdempotency.mjs";
const root=resolve(import.meta.dirname,"../../.."),read=p=>readFileSync(resolve(root,p),"utf8");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const req={task_type:"complaint",title:"Follow up on assigned support case",
 description:null,priority:"medium",due_at:"2026-10-16T11:00:00.000Z"};
const existing={...req,id:id(5),vendor_id:id(2),created_by:id(1),due_at:"2026-10-16T11:00:00+00:00"};
let n=0;function t(name,f){f();n++;console.log("PASS",name)}
t("safe exact retry",()=>assert.equal(sameVendorTaskCreate(existing,req,id(2),id(1)),true));
t("same time offset equivalent",()=>assert.equal(sameVendorTaskCreate(existing,req,id(2),id(1)),true));
t("other vendor denied",()=>assert.equal(sameVendorTaskCreate(existing,req,id(3),id(1)),false));
t("other actor denied",()=>assert.equal(sameVendorTaskCreate(existing,req,id(2),id(3)),false));
t("changed task type denied",()=>assert.equal(sameVendorTaskCreate(existing,{...req,task_type:"general"},id(2),id(1)),false));
t("changed title denied",()=>assert.equal(sameVendorTaskCreate(existing,{...req,title:"Other"},id(2),id(1)),false));
t("changed priority denied",()=>assert.equal(sameVendorTaskCreate(existing,{...req,priority:"high"},id(2),id(1)),false));
t("changed due denied",()=>assert.equal(sameVendorTaskCreate(existing,{...req,due_at:"2026-10-18T11:00:00Z"},id(2),id(1)),false));
t("invalid due denied",()=>assert.equal(sameVendorTaskCreate(existing,{...req,due_at:"bad"},id(2),id(1)),false));
t("changed description denied",()=>assert.equal(sameVendorTaskCreate(existing,{...req,description:"sensitive"},id(2),id(1)),false));
t("zero deadline allowed only for both",()=>assert.equal(sameVendorTaskCreate({...existing,due_at:null},{...req,due_at:null},id(2),id(1)),true));
t("null vs dated denied",()=>assert.equal(sameVendorTaskCreate({...existing,due_at:null},req,id(2),id(1)),false));
const service=read("services/vendorCrmService.ts");
t("native writer uses exact idempotency comparator",()=>assert.match(service,/sameVendorTaskCreate\(/));
t("native writer handles unique conflict only",()=>assert.match(service,/error\.code === "23505"/));
t("native retry requires authoritative re-read",()=>assert.match(service,/\.eq\("idempotency_key",v\.idempotency_key\)/));
t("duplicate payload mismatch fail closed",()=>assert.match(service,/VENDOR_TASK_IDEMPOTENCY_CONFLICT/));
t("never mutate money or provider",()=>assert.doesNotMatch(service.slice(service.indexOf("export async function createVendorTask("),service.indexOf("export async function updateVendorTask(")),/sendWhatsApp|lead_assignments|wallet|credits/));
console.log("VOX16_NATIVE_TASK_IDEMPOTENCY_PASS "+n+"/"+n);
