// ============================================================================
// QuickFurno - services/vendorSupportService.ts
// Vendor support threads and admin replies. No WhatsApp or package side effects.
// ============================================================================
import { adminClient } from "../lib/supabase";
import { appError, fail, ok, type Result } from "../lib/errors";
import { createVendorNotification } from "./vendorNotificationService";

export type VendorSupportThread = {
  id: string;
  vendor_id: string;
  subject: string;
  topic: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type VendorSupportMessage = {
  id: string;
  thread_id: string;
  sender_type: "vendor" | "admin" | "system" | string;
  sender_id: string | null;
  message: string;
  created_at: string | null;
};

export type VendorSupportThreadWithMessages = VendorSupportThread & {
  messages: VendorSupportMessage[];
};

export async function listVendorSupportThreads(vendorId: string): Promise<Result<VendorSupportThreadWithMessages[]>> {
  try {
    return ok(await loadThreadsWithMessages({ vendorId }));
  } catch (e) {
    return fail(e);
  }
}

export async function listAdminSupportThreads(): Promise<Result<VendorSupportThreadWithMessages[]>> {
  try {
    return ok(await loadThreadsWithMessages({}));
  } catch (e) {
    return fail(e);
  }
}

export async function createVendorSupportThread(
  vendorId: string,
  senderId: string | null,
  input: { subject: string; topic?: string; message: string },
): Promise<Result<VendorSupportThread>> {
  try {
    const subject = cleanText(input.subject, 140);
    const topic = cleanText(input.topic ?? "general", 60) || "general";
    const message = cleanText(input.message, 1200);
    if (!subject || !message) throw appError("VALIDATION");

    const db = adminClient();
    const { data: thread, error: threadError } = await db
      .from("vendor_support_threads")
      .insert({ vendor_id: vendorId, subject, topic, status: "open" })
      .select("*")
      .single();
    if (threadError) throw threadError;

    const { error: messageError } = await db.from("vendor_support_messages").insert({
      thread_id: thread.id,
      sender_type: "vendor",
      sender_id: senderId,
      message,
    });
    if (messageError) throw messageError;

    return ok(thread as VendorSupportThread);
  } catch (e) {
    return fail(e);
  }
}

export async function createVendorSupportMessage(
  vendorId: string,
  threadId: string,
  senderId: string | null,
  messageValue: string,
): Promise<Result<VendorSupportMessage>> {
  try {
    const message = cleanText(messageValue, 1200);
    if (!threadId || !message) throw appError("VALIDATION");

    const db = adminClient();
    const { data: thread, error: threadError } = await db
      .from("vendor_support_threads")
      .select("id, vendor_id")
      .eq("id", threadId)
      .eq("vendor_id", vendorId)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread) throw appError("UNAUTHORIZED");

    const { data, error } = await db
      .from("vendor_support_messages")
      .insert({ thread_id: threadId, sender_type: "vendor", sender_id: senderId, message })
      .select("*")
      .single();
    if (error) throw error;

    await db
      .from("vendor_support_threads")
      .update({ status: "vendor_replied", updated_at: new Date().toISOString() })
      .eq("id", threadId);

    return ok(data as VendorSupportMessage);
  } catch (e) {
    return fail(e);
  }
}

export async function createAdminSupportReply(
  threadId: string,
  senderId: string | null,
  messageValue: string,
): Promise<Result<VendorSupportMessage>> {
  try {
    const message = cleanText(messageValue, 1200);
    if (!threadId || !message) throw appError("VALIDATION");

    const db = adminClient();
    const { data: thread, error: threadError } = await db
      .from("vendor_support_threads")
      .select("id, vendor_id")
      .eq("id", threadId)
      .maybeSingle();
    if (threadError) throw threadError;
    if (!thread) throw appError("UNKNOWN");

    const { data, error } = await db
      .from("vendor_support_messages")
      .insert({ thread_id: threadId, sender_type: "admin", sender_id: senderId, message })
      .select("*")
      .single();
    if (error) throw error;

    await db
      .from("vendor_support_threads")
      .update({ status: "admin_replied", updated_at: new Date().toISOString() })
      .eq("id", threadId);

    await createVendorNotification(thread.vendor_id, {
      title: "Support replied",
      message,
      type: "support",
      priority: "normal",
      cta_label: "View support thread",
      cta_url: "/vendor/dashboard/support",
    });

    return ok(data as VendorSupportMessage);
  } catch (e) {
    return fail(e);
  }
}

async function loadThreadsWithMessages({ vendorId }: { vendorId?: string }) {
  const db = adminClient();
  let threadQuery = db
    .from("vendor_support_threads")
    .select("*")
    .order("updated_at", { ascending: false });

  if (vendorId) threadQuery = threadQuery.eq("vendor_id", vendorId);

  const { data: threads, error: threadError } = await threadQuery;
  if (threadError) throw threadError;

  const threadRows = (threads ?? []) as VendorSupportThread[];
  const threadIds = threadRows.map((thread) => thread.id);
  if (threadIds.length === 0) return threadRows.map((thread) => ({ ...thread, messages: [] }));

  const { data: messages, error: messageError } = await db
    .from("vendor_support_messages")
    .select("*")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: true });
  if (messageError) throw messageError;

  const messagesByThread = new Map<string, VendorSupportMessage[]>();
  ((messages ?? []) as VendorSupportMessage[]).forEach((message) => {
    const current = messagesByThread.get(message.thread_id) ?? [];
    current.push(message);
    messagesByThread.set(message.thread_id, current);
  });

  return threadRows.map((thread) => ({
    ...thread,
    messages: messagesByThread.get(thread.id) ?? [],
  }));
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}
