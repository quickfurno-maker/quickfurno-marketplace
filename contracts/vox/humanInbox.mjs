// VOX-00 message-view boundary. No Meta or outbound provider capability lives here.
const TYPES=Object.freeze({prospect:"AAROHI",vendor:"ANISHA",client:"RIYA"});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const INBOX_SUBJECT_TYPES=Object.freeze(Object.keys(TYPES));
export function projectHumanThread(row) {
  if (!row || !Object.hasOwn(TYPES,row.subjectType)) throw new Error("UNKNOWN_SUBJECT_TYPE");
  if (!UUID.test(String(row.id??""))) throw new Error("INVALID_CONVERSATION_ID");
  if (row.state!=="HUMAN" || row.humanTakeover!==true) throw new Error("NOT_HUMAN_OWNED");
  const revision=Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("BAD_REVISION");
  return Object.freeze({
    conversationId:String(row.id??""),
    agent:TYPES[row.subjectType],
    subjectType:row.subjectType,
    destinationMasked:typeof row.destinationMasked==="string"?row.destinationMasked.replace(/\d(?=\D*\d\D*\d)/g,"*").slice(0,40):"—",
    humanTakeover:true,
    revision,
    canFreeformReply:typeof row.serviceWindowExpiresAt==="string" &&
      Date.parse(row.serviceWindowExpiresAt)>Date.now(),
  });
}
export function proposeHumanReply(row, text, expectedRevision) {
  const view=projectHumanThread(row);
  if (view.revision!==expectedRevision) return Object.freeze({accepted:false,reason:"STALE_REVISION"});
  if (!view.canFreeformReply) return Object.freeze({accepted:false,reason:"SERVICE_WINDOW_CLOSED"});
  if (typeof text!=="string" || !text.trim() || text.length>4096) return Object.freeze({accepted:false,reason:"INVALID_REPLY"});
  // This is a COMMAND PROPOSAL, not an outbound send. The Core service must
  // re-check consent, identity, ownership, time-window and revision atomically.
  return Object.freeze({accepted:true,reason:"PENDING_CORE_VALIDATION",
    command:Object.freeze({operation:"REQUEST_CORE_HUMAN_REPLY",conversationId:view.conversationId,
      expectedRevision:view.revision,body:text.trim()})});
}
