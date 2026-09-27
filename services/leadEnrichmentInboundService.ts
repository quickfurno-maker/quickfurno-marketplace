// ============================================================================
// QuickFurno — Client Journey V2 / Phase 1 deterministic WhatsApp enrichment.
//
// Verified inbound persistence happens BEFORE this service. This layer consumes
// only durable minimized messages, exact Core request tokens, and the governed
// conversation id already linked to the inbound row. Riya is intentionally not
// involved in this phase.
// ============================================================================

import { adminClient } from "@/lib/supabase";
import { normalizeConsentCommand } from "@/lib/communication/consentCommand";
import { leadWhatsAppDestinationHash } from "@/lib/leads/leadWhatsAppIdentity";
import {
  buildLeadEnrichmentCompleteExperience,
  buildLeadEnrichmentNeedsReviewExperience,
  buildLeadEnrichmentQuestionExperience,
  parseLeadEnrichmentReplyToken,
} from "@/lib/leads/leadEnrichmentWhatsApp";
import {
  mapClarificationAnswerToLeadField,
  type ClarificationQuestion,
} from "@/lib/lead-quality/clarificationPresets";
import type { QfWhatsAppExperienceV1 } from "@/lib/jarvis/whatsAppExperience";
import type { InboundProcessedMessage } from "./inboundWhatsAppMessageService";
import {
  applyClarificationResponsesToLead,
  createEnrichmentRequestForLead,
  recalculateLeadAfterClarification,
  type ClarificationResponseInput,
} from "./leadClarificationService";
import {
  markLeadMatchReady,
  markLeadMatchingOutcome,
  markLeadQualificationBlocked,
  recalculateStoredLeadQualification,
} from "./leadQualificationService";
import { canAutoDistributeLead } from "./leadQualityService";
import { runAutoLeadMatchingForLead } from "./leadMatchingEngine";
import { routePreferredVendorLead } from "./preferredVendorLeadService";
import { queueSystemConversationExperience } from "./conversationalWhatsAppService";

const ACTIVE_REQUEST_STATUSES = [
  "preview_prepared",
  "preview_sent",
  "expired_no_response",
] as const;
const CONTROL_CHARS = /[\r\n\t]/;

type LeadRow = Record<string, unknown> & {
  id: string;
  phone?: string | null;
  share_consent?: boolean | null;
  is_duplicate?: boolean | null;
  clarification_required?: boolean | null;
  clarification_last_request_id?: string | null;
  lead_intent?: string | null;
  target_vendor_id?: string | null;
  target_vendor_name?: string | null;
};

type RequestRow = {
  id: string;
  lead_id: string;
  status: string | null;
  questions_json: ClarificationQuestion[];
  destination_hash: string | null;
  conversation_id: string | null;
};

type RequestContext = {
  request: RequestRow;
  lead: LeadRow;
  conversationId: string;
  inboundMessageId: string;
};

export type LeadEnrichmentInboundOutcome =
  | { readonly ok: true; readonly handled: number }
  | { readonly ok: false; readonly code: "LEAD_ENRICHMENT_RETRY" };

/**
 * Process durable inbound messages sequentially. A real infrastructure failure
 * is retryable; deterministic non-enrichment traffic is simply ignored.
 */
export async function processLeadEnrichmentInboundMessages(
  messages: readonly InboundProcessedMessage[],
): Promise<LeadEnrichmentInboundOutcome> {
  let handled = 0;
  try {
    for (const item of messages) {
      const result = await processOne(item);
      if (result) handled += 1;
    }
    return { ok: true, handled };
  } catch {
    return { ok: false, code: "LEAD_ENRICHMENT_RETRY" };
  }
}

async function processOne(item: InboundProcessedMessage): Promise<boolean> {
  const type = item.message.messageType;
  if (!["button_reply", "list_reply", "text"].includes(type)) return false;

  // STOP / START / HELP remain owned by the consent-command authority. Never
  // let lead enrichment consume or answer those control messages.
  if (
    type === "text" &&
    normalizeConsentCommand(item.message.contentMinimized.text) !== "unsupported"
  ) {
    return false;
  }

  const inbound = await readInboundContext(item.receipt.inboundMessageId);
  if (!inbound || !inbound.conversationId) return false;

  const replyId =
    typeof item.message.contentMinimized.replyId === "string"
      ? item.message.contentMinimized.replyId
      : null;
  const token = parseLeadEnrichmentReplyToken(replyId);

  let context: RequestContext | null = null;
  if (token) {
    context = await loadExactRequestContext({
      requestId: token.requestId,
      conversationId: inbound.conversationId,
      senderHash: inbound.senderHash,
      inboundMessageId: item.receipt.inboundMessageId,
    });
  } else if (type === "text") {
    // Plain text is accepted only after an exact request has already been bound
    // to this governed conversation. There is no phone→first-lead fallback.
    context = await loadConversationRequestContext({
      conversationId: inbound.conversationId,
      senderHash: inbound.senderHash,
      inboundMessageId: item.receipt.inboundMessageId,
    });
  }

  if (!context) return false;

  await markReachable(context.lead.id);

  const questions = context.request.questions_json;
  const answered = await answeredQuestionKeys(context.request.id);

  if (token?.kind === "start") {
    const next = firstUnansweredQuestion(questions, answered);
    if (!next) return finalizeCompletedRequest(context, item);
    await queueQuestion(context, item.receipt.inboundMessageId, next.index, next.question);
    return true;
  }

  const answer = resolveAnswer({
    token,
    messageType: type,
    content: item.message.contentMinimized,
    questions,
    answered,
  });

  if (!answer) {
    const next = firstUnansweredQuestion(questions, answered);
    if (!next) return finalizeCompletedRequest(context, item);
    // Deterministic Phase 1 fallback: repeat the exact predefined question.
    // Riya will own ambiguous free-form interpretation only in Phase 2.
    await queueQuestion(context, item.receipt.inboundMessageId, next.index, next.question);
    return true;
  }

  const persisted = await persistAnswer({
    context,
    inboundMessageId: item.receipt.inboundMessageId,
    messageType: type,
    question: answer.question,
    answerValue: answer.value,
    answerLabel: answer.label,
  });
  if (!persisted) throw new Error("LEAD_ENRICHMENT_RESPONSE_NOT_PERSISTED");

  const after = await answeredQuestionKeys(context.request.id);
  const next = firstUnansweredQuestion(questions, after);
  if (next) {
    await queueQuestion(context, item.receipt.inboundMessageId, next.index, next.question);
    return true;
  }

  return finalizeCompletedRequest(context, item);
}

async function readInboundContext(inboundMessageId: string): Promise<{
  conversationId: string | null;
  senderHash: string;
} | null> {
  const { data, error } = await adminClient()
    .from("communication_inbound_messages")
    .select("id,conversation_id,sender_hash")
    .eq("id", inboundMessageId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    conversationId:
      typeof data.conversation_id === "string" ? data.conversation_id : null,
    senderHash: String(data.sender_hash ?? ""),
  };
}

async function loadExactRequestContext(input: {
  requestId: string;
  conversationId: string;
  senderHash: string;
  inboundMessageId: string;
}): Promise<RequestContext | null> {
  const request = await readRequest(input.requestId);
  if (!request || request.destination_hash !== input.senderHash) return null;

  if (request.status === "expired_no_response") {
    // A late client reply reactivates the SAME requirement. It never creates a
    // competing lead and never loses the original no-response/send evidence.
    const now = new Date().toISOString();
    const { error: reopenError } = await adminClient()
      .from("leads")
      .update({
        clarification_required: true,
        clarification_status: "late_response",
        journey_state: "awaiting_client",
        match_readiness_status: "needs_enrichment",
        reachability_status: "reachable",
        clarification_checked_at: now,
      })
      .eq("id", request.lead_id)
      .eq("clarification_last_request_id", request.id)
      .eq("is_duplicate", false);
    if (reopenError) throw reopenError;
  }

  const lead = await readEligibleLead(request.lead_id, request.id, input.senderHash);
  if (!lead) return null;

  if (request.conversation_id && request.conversation_id !== input.conversationId) {
    return null;
  }

  if (!request.conversation_id) {
    const now = new Date().toISOString();
    const { data, error } = await adminClient()
      .from("lead_clarification_requests")
      .update({
        conversation_id: input.conversationId,
        interaction_started_at: now,
        updated_at: now,
      })
      .eq("id", request.id)
      .is("conversation_id", null)
      .select("conversation_id");
    if (error) throw error;

    if (!Array.isArray(data) || data.length !== 1) {
      const rebound = await readRequest(request.id);
      if (!rebound || rebound.conversation_id !== input.conversationId) return null;
      request.conversation_id = rebound.conversation_id;
    } else {
      request.conversation_id = input.conversationId;
    }
  }

  return {
    request,
    lead,
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
  };
}

async function loadConversationRequestContext(input: {
  conversationId: string;
  senderHash: string;
  inboundMessageId: string;
}): Promise<RequestContext | null> {
  const { data: bound, error: boundError } = await adminClient()
    .from("lead_clarification_requests")
    .select("id")
    .eq("conversation_id", input.conversationId)
    .in("status", [...ACTIVE_REQUEST_STATUSES])
    .order("created_at", { ascending: false })
    .limit(2);
  if (boundError) throw boundError;

  if (Array.isArray(bound) && bound.length === 1 && bound[0]?.id) {
    return loadExactRequestContext({
      requestId: String(bound[0].id),
      conversationId: input.conversationId,
      senderHash: input.senderHash,
      inboundMessageId: input.inboundMessageId,
    });
  }
  if (Array.isArray(bound) && bound.length > 1) return null;

  // First client reply after the approved outbound template: bind only when the
  // privacy-safe destination hash identifies exactly one active unbound request.
  // Two simultaneous requirements for the same WhatsApp identity are ambiguous
  // and deliberately fall through to human/Riya handling rather than guessing.
  const { data: unbound, error: unboundError } = await adminClient()
    .from("lead_clarification_requests")
    .select("id")
    .eq("destination_hash", input.senderHash)
    .is("conversation_id", null)
    .in("status", [...ACTIVE_REQUEST_STATUSES])
    .order("created_at", { ascending: false })
    .limit(2);
  if (unboundError) throw unboundError;
  if (!Array.isArray(unbound) || unbound.length !== 1 || !unbound[0]?.id) return null;

  return loadExactRequestContext({
    requestId: String(unbound[0].id),
    conversationId: input.conversationId,
    senderHash: input.senderHash,
    inboundMessageId: input.inboundMessageId,
  });
}

async function readRequest(requestId: string): Promise<RequestRow | null> {
  const { data, error } = await adminClient()
    .from("lead_clarification_requests")
    .select("id,lead_id,status,questions_json,destination_hash,conversation_id")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (
    !data ||
    !ACTIVE_REQUEST_STATUSES.includes(
      String(data.status ?? "") as (typeof ACTIVE_REQUEST_STATUSES)[number],
    ) ||
    !Array.isArray(data.questions_json) ||
    data.questions_json.length === 0
  ) {
    return null;
  }
  return {
    id: String(data.id),
    lead_id: String(data.lead_id),
    status: data.status == null ? null : String(data.status),
    questions_json: data.questions_json as ClarificationQuestion[],
    destination_hash:
      typeof data.destination_hash === "string" ? data.destination_hash : null,
    conversation_id:
      typeof data.conversation_id === "string" ? data.conversation_id : null,
  };
}

async function readEligibleLead(
  leadId: string,
  requestId: string,
  senderHash: string,
): Promise<LeadRow | null> {
  const { data, error } = await adminClient()
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const lead = data as LeadRow;
  if (
    lead.is_duplicate === true ||
    lead.share_consent !== true ||
    lead.clarification_required !== true ||
    lead.clarification_last_request_id !== requestId
  ) {
    return null;
  }

  const destinationHash = leadWhatsAppDestinationHash(lead.phone);
  if (!destinationHash || destinationHash !== senderHash) return null;
  return lead;
}

async function answeredQuestionKeys(requestId: string): Promise<Set<string>> {
  const { data, error } = await adminClient()
    .from("lead_clarification_responses")
    .select("question_key")
    .eq("request_id", requestId)
    .not("applied_at", "is", null);
  if (error) throw error;
  return new Set(
    (data ?? [])
      .map((row) => String(row.question_key ?? "").trim())
      .filter(Boolean),
  );
}

function firstUnansweredQuestion(
  questions: readonly ClarificationQuestion[],
  answered: ReadonlySet<string>,
): { index: number; question: ClarificationQuestion } | null {
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index];
    if (question?.key && !answered.has(question.key)) return { index, question };
  }
  return null;
}

function resolveAnswer(input: {
  token: ReturnType<typeof parseLeadEnrichmentReplyToken>;
  messageType: string;
  content: Record<string, unknown>;
  questions: readonly ClarificationQuestion[];
  answered: ReadonlySet<string>;
}): { question: ClarificationQuestion; value: string; label: string } | null {
  if (input.token?.kind === "answer") {
    const question = input.questions[input.token.questionIndex];
    const option = question?.options?.[input.token.optionIndex];
    if (!question || question.type !== "single_choice" || !option) return null;
    return {
      question,
      value: option.value,
      label: option.label,
    };
  }

  if (input.messageType !== "text") return null;
  const raw = typeof input.content.text === "string" ? input.content.text.trim() : "";
  if (!raw || raw.length > 200 || CONTROL_CHARS.test(raw)) return null;

  const next = firstUnansweredQuestion(input.questions, input.answered);
  if (!next) return null;
  if (next.question.type === "free_text_later") {
    return { question: next.question, value: raw, label: raw };
  }

  const options = next.question.options ?? [];
  const byNumber = /^\d{1,2}$/.test(raw) ? Number(raw) - 1 : -1;
  const normalized = raw.toLowerCase();
  const option =
    (byNumber >= 0 ? options[byNumber] : undefined) ??
    options.find(
      (candidate) =>
        candidate.label.trim().toLowerCase() === normalized ||
        candidate.value.trim().toLowerCase() === normalized,
    );
  return option
    ? { question: next.question, value: option.value, label: option.label }
    : null;
}

async function persistAnswer(input: {
  context: RequestContext;
  inboundMessageId: string;
  messageType: string;
  question: ClarificationQuestion;
  answerValue: string;
  answerLabel: string;
}): Promise<boolean> {
  let response = await readResponseByInbound(input.inboundMessageId);
  const mapped = mapClarificationAnswerToLeadField(
    input.question.key,
    input.answerValue,
  );
  if (!mapped) return false;

  if (!response) {
    const { data, error } = await adminClient()
      .from("lead_clarification_responses")
      .insert({
        lead_id: input.context.lead.id,
        request_id: input.context.request.id,
        question_key: input.question.key,
        answer_value: input.answerValue,
        answer_label: input.answerLabel,
        mapped_field: mapped.mapped_field ?? null,
        mapped_value: mapped.mapped_value ?? null,
        raw_payload: { message_type: input.messageType },
        inbound_message_id: input.inboundMessageId,
        response_source: "whatsapp",
      })
      .select("id,lead_id,request_id,question_key,answer_value,answer_label,applied_at")
      .maybeSingle();

    if (error) {
      response = await readResponseByInbound(input.inboundMessageId);
      if (!response) throw error;
    } else {
      response = data;
    }
  }

  if (
    !response ||
    String(response.lead_id) !== input.context.lead.id ||
    String(response.request_id) !== input.context.request.id ||
    String(response.question_key) !== input.question.key
  ) {
    return false;
  }

  if (!response.applied_at) {
    const responseInput: ClarificationResponseInput = {
      question_key: String(response.question_key),
      answer_value: String(response.answer_value),
      answer_label:
        response.answer_label == null ? null : String(response.answer_label),
      raw_payload: { source: "whatsapp" },
    };
    const applied = await applyClarificationResponsesToLead(
      input.context.lead.id,
      [responseInput],
    );
    if (!applied.ok) throw new Error("LEAD_ENRICHMENT_APPLY_FAILED");

    const now = new Date().toISOString();
    const { error: appliedError } = await adminClient()
      .from("lead_clarification_responses")
      .update({ applied_at: now })
      .eq("id", response.id);
    if (appliedError) throw appliedError;
  }

  const now = new Date().toISOString();
  await Promise.all([
    adminClient()
      .from("lead_clarification_requests")
      .update({ response_received_at: now, updated_at: now })
      .eq("id", input.context.request.id),
    adminClient()
      .from("leads")
      .update({
        reachability_status: "reachable",
        journey_state: "awaiting_client",
        clarification_checked_at: now,
      })
      .eq("id", input.context.lead.id),
  ]);

  return true;
}

async function readResponseByInbound(inboundMessageId: string): Promise<any | null> {
  const { data, error } = await adminClient()
    .from("lead_clarification_responses")
    .select("id,lead_id,request_id,question_key,answer_value,answer_label,applied_at")
    .eq("inbound_message_id", inboundMessageId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function markReachable(leadId: string): Promise<void> {
  const { error } = await adminClient()
    .from("leads")
    .update({
      reachability_status: "reachable",
      clarification_checked_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) throw error;
}

async function queueQuestion(
  context: RequestContext,
  inboundMessageId: string,
  questionIndex: number,
  question: ClarificationQuestion,
): Promise<void> {
  const experience = buildLeadEnrichmentQuestionExperience({
    requestId: context.request.id,
    question,
    questionIndex,
    totalQuestions: context.request.questions_json.length,
  });
  if (!experience) throw new Error("LEAD_ENRICHMENT_QUESTION_INVALID");
  await queueExperience(context.conversationId, inboundMessageId, experience);
}

async function queueExperience(
  conversationId: string,
  inboundMessageId: string,
  experience: QfWhatsAppExperienceV1,
): Promise<void> {
  const { data: existing, error: existingError } = await adminClient()
    .from("communication_conversation_outbox")
    .select("id")
    .eq("proposal_id", `concierge:${inboundMessageId}`)
    .limit(1);
  if (existingError) throw existingError;
  if (Array.isArray(existing) && existing.length > 0) return;

  const { data: conversation, error } = await adminClient()
    .from("communication_conversations")
    .select("id,revision")
    .eq("id", conversationId)
    .maybeSingle();
  if (error || !conversation) throw error ?? new Error("CONVERSATION_NOT_FOUND");

  const queued = await queueSystemConversationExperience({
    conversationId,
    expectedRevision: Number(conversation.revision),
    inboundMessageId,
    experience,
  });
  if (!queued.ok) throw new Error("LEAD_ENRICHMENT_REPLY_NOT_QUEUED");
}

async function finalizeCompletedRequest(
  context: RequestContext,
  item: InboundProcessedMessage,
): Promise<boolean> {
  const now = new Date().toISOString();
  const qualification = await recalculateStoredLeadQualification(context.lead.id);

  if (qualification.completenessStatus !== "complete") {
    await adminClient()
      .from("lead_clarification_requests")
      .update({
        status: "completed_still_incomplete",
        completed_at: now,
        updated_at: now,
      })
      .eq("id", context.request.id);

    await adminClient()
      .from("leads")
      .update({
        clarification_required: false,
        clarification_status: "completed_still_incomplete",
        clarification_checked_at: now,
      })
      .eq("id", context.lead.id);

    // Rare >5-question/category evolution path: create a fresh exact request for
    // only what remains. The existing Core producer owns its next outbound.
    await createEnrichmentRequestForLead(context.lead.id);
    await queueExperience(
      context.conversationId,
      item.receipt.inboundMessageId,
      buildLeadEnrichmentNeedsReviewExperience(),
    );
    return true;
  }

  const scored = await recalculateLeadAfterClarification(context.lead.id);
  if (!scored.ok) {
    await markLeadQualificationBlocked(context.lead.id, "manual_review");
    throw new Error("LEAD_ENRICHMENT_SCORE_FAILED");
  }

  const canMatch = canAutoDistributeLead(scored.data);
  const completionStatus = canMatch
    ? "completed_upgraded"
    : "completed_quality_hold";

  await adminClient()
    .from("lead_clarification_requests")
    .update({
      status: completionStatus,
      response_received_at: now,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", context.request.id);

  await adminClient()
    .from("leads")
    .update({
      clarification_required: false,
      clarification_status: completionStatus,
      clarification_checked_at: now,
    })
    .eq("id", context.lead.id);

  if (!canMatch) {
    await markLeadQualificationBlocked(
      context.lead.id,
      scored.data.recommended_action === "nurture"
        ? "nurture"
        : "manual_review",
    );
    await queueExperience(
      context.conversationId,
      item.receipt.inboundMessageId,
      buildLeadEnrichmentCompleteExperience(),
    );
    return true;
  }

  await markLeadMatchReady(context.lead.id);
  await adminClient()
    .from("leads")
    .update({ journey_state: "matching" })
    .eq("id", context.lead.id);

  const refreshed = await readLead(context.lead.id);
  if (!refreshed) throw new Error("LEAD_NOT_FOUND_AFTER_ENRICHMENT");

  if (
    String(refreshed.lead_intent ?? "") === "preferred_vendor" &&
    typeof refreshed.target_vendor_id === "string" &&
    refreshed.target_vendor_id.trim()
  ) {
    const preferred = await routePreferredVendorLead({
      leadId: refreshed.id,
      vendorId: refreshed.target_vendor_id,
      vendorName:
        typeof refreshed.target_vendor_name === "string"
          ? refreshed.target_vendor_name
          : null,
      city: typeof refreshed.city === "string" ? refreshed.city : null,
      serviceRequired:
        typeof refreshed.service_required === "string"
          ? refreshed.service_required
          : null,
      category:
        typeof refreshed.category === "string" ? refreshed.category : null,
      subcategory:
        typeof refreshed.subcategory === "string" ? refreshed.subcategory : null,
      isDuplicate: refreshed.is_duplicate === true,
      fallbackAllowed: true,
    });
    await markPreferredJourney(refreshed.id, preferred.status, preferred.assigned);
  } else {
    const matching = await runAutoLeadMatchingForLead(context.lead.id);
    if (!matching.ok) {
      await markLeadQualificationBlocked(context.lead.id, "manual_review");
      throw new Error("LEAD_ENRICHMENT_MATCH_FAILED");
    }
    await markLeadMatchingOutcome(context.lead.id, {
      status: matching.data.status,
      assignedCount: matching.data.assignedVendors.length,
      eligibleVendorCount: matching.data.eligibleVendorCount,
    });
  }

  await queueExperience(
    context.conversationId,
    item.receipt.inboundMessageId,
    buildLeadEnrichmentCompleteExperience(),
  );
  return true;
}

async function readLead(leadId: string): Promise<LeadRow | null> {
  const { data, error } = await adminClient()
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  return (data as LeadRow | null) ?? null;
}

async function markPreferredJourney(
  leadId: string,
  status: string,
  assigned: boolean,
): Promise<void> {
  const journeyState = assigned
    ? "partially_matched"
    : ["preferred_vendor_no_credits", "preferred_vendor_pending"].includes(status)
      ? "waiting_for_supply"
      : "manual_review";
  const { error } = await adminClient()
    .from("leads")
    .update({
      journey_state: journeyState,
      match_readiness_status: assigned || journeyState === "waiting_for_supply"
        ? "ready"
        : "blocked",
      qualification_checked_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) throw error;
}
