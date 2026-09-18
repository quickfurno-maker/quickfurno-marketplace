export const AAROHI_PROSPECT_STAGES = ["DISCOVERED","ENRICHED","QUALIFIED","OUTREACH_READY","CONTACTED","ENGAGED","INTERESTED","CONVERSION","WON","LOST","SUPPRESSED"] as const;
export const AAROHI_CONVERSATION_STAGES = ["NONE","FIRST_CONTACT","REPLIED","DISCOVERY","OBJECTION","PITCH","WHATSAPP_HANDOFF","FOLLOW_UP","CLOSING"] as const;
export const AAROHI_REGISTRATION_STAGES = ["NOT_STARTED","STARTED","IN_PROGRESS","COMPLETED","BLOCKED"] as const;
export const AAROHI_COMMERCIAL_STAGES = ["NONE","PACKAGE_INTEREST","PACKAGE_PRESENTED","PACKAGE_SELECTED"] as const;
export const AAROHI_PAYMENT_STAGES = ["NONE","PENDING","STARTED","PAID","FAILED"] as const;
export const AAROHI_PRIORITY_BANDS = ["A+","A","B","C","D"] as const;
export const AAROHI_AGENT_STATES = ["AAROHI","ANISHA"] as const;
export const AAROHI_TASK_TYPES = ["CALL","FOLLOW_UP","WHATSAPP","REVIEW","IDENTITY_REVIEW","REGISTRATION_ASSIST","PAYMENT_FOLLOWUP","HUMAN_CALLBACK","OTHER"] as const;
export const AAROHI_TASK_STATES = ["OPEN","IN_PROGRESS","DONE","CANCELLED","BLOCKED"] as const;
export const AAROHI_CHANNELS = ["CALL","WHATSAPP","INSTAGRAM","FACEBOOK","LINKEDIN","X","WEBSITE","PHONE","EMAIL","SYSTEM"] as const;
export const AAROHI_SOURCE_TYPES = ["GOOGLE","WEBSITE","INSTAGRAM","FACEBOOK","LINKEDIN","X","JUSTDIAL","INDIAMART","MANUAL","CSV","FIRECRAWL","OTHER"] as const;
export const AAROHI_SCORE_REASON_CODES = ["PHONE_AVAILABLE","WHATSAPP_AVAILABLE","PUNE_MATCH","CATEGORY_MATCH","MULTIPLE_SOURCES","RESPONDED","PRICE_REQUEST","CALLBACK_REQUESTED"] as const;
export type AarohiProspectStage = typeof AAROHI_PROSPECT_STAGES[number];
export type AarohiPermission = "aarohi.view"|"aarohi.manage"|"aarohi.takeover"|"aarohi.suppress"|"aarohi.review_identity"|"aarohi.manage_campaigns"|"aarohi.view_analytics"|"aarohi.export";
export const AAROHI_LOCAL_PIPELINE = ["NEW","ENRICHED","QUALIFIED","OUTREACH","REPLIED","INTERESTED","WHATSAPP","REGISTRATION","PACKAGE","PAYMENT","ACTIVATION","WON"] as const;
export function clampScore(value: unknown): number { const n=Number(value); return Number.isFinite(n)?Math.max(0,Math.min(100,Math.round(n))):0; }
export function derivePriorityBand(scores: { qualification:number; contactability:number; engagement:number; commercialIntent:number; dataConfidence:number }): typeof AAROHI_PRIORITY_BANDS[number] {
  const weighted = scores.qualification*.3 + scores.contactability*.15 + scores.engagement*.2 + scores.commercialIntent*.25 + scores.dataConfidence*.1;
  return weighted>=90?"A+":weighted>=78?"A":weighted>=62?"B":weighted>=45?"C":"D";
}
