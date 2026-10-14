// Pure exact retry guard. A reused key cannot authorize a different vendor,
 // actor, task type, title, priority, description or deadline.
const date=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?Date.parse(x):null;
const norm=x=>typeof x==="string"&&x.length?x:null;
export function sameVendorTaskCreate(existing,requested,vendorId,actor){
 if(!existing||!requested||typeof existing!=="object"||typeof requested!=="object"||
    existing.vendor_id!==vendorId||existing.created_by!==actor||
    existing.task_type!==requested.task_type||existing.title!==requested.title||
    existing.priority!==requested.priority||
    norm(existing.description)!==norm(requested.description))return false;
 if(existing.due_at===null&&requested.due_at===null)return true;
 const old=date(existing.due_at),now=date(requested.due_at);
 return old!==null&&old===now;
}
