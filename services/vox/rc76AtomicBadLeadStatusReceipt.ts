const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Only a checked atomic Core receipt can certify the optional writer.
 * This parser never issues money, lead credits or messages. Unknown or
 * unexpected response fields always require reconciliation, not retry.
 */
export function rc76ValidAtomicBadLeadReceipt(
 raw:unknown,reportId:string,status:string
):boolean{
 if(!raw||typeof raw!=="object"||Array.isArray(raw)||
  !UUID.test(reportId))return false;
 const x=raw as Record<string,unknown>;
 if(Object.keys(x).sort().join("|")!==
  "assignmentFlagged|leadCreditsIssued|ok|providerMessagesSent|reportId|schema|status")return false;
 return x.ok===true&&
  x.schema==="qf.vox.rc75.badlead.status.review.v1"&&
  x.reportId===reportId&&x.status===status&&
  x.assignmentFlagged===(status==="Valid")&&
  x.leadCreditsIssued===0&&x.providerMessagesSent===0;
}
