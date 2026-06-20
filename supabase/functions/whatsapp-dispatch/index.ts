// ============================================================================
// QuickFurno — supabase/functions/whatsapp-dispatch/index.ts
// Drains queued WhatsApp messages (whatsapp_logs.status = 'Pending') and sends
// them through the Meta WhatsApp Cloud API. Run on a schedule (pg_cron / external
// scheduler) or invoke manually.
//
// Required secrets (supabase secrets set ...):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (provided automatically in Edge env)
//   WHATSAPP_TOKEN        — Meta permanent access token
//   WHATSAPP_PHONE_ID     — Meta phone number ID
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v20.0";

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");

  // pull a batch of pending messages
  const { data: pending, error } = await supabase
    .from("whatsapp_logs")
    .select("id, phone, message")
    .eq("status", "Pending")
    .order("created_at", { ascending: true })
    .limit(50);

  if (error) return json({ error: error.message }, 500);
  if (!pending?.length) return json({ sent: 0, message: "nothing pending" });

  // if WhatsApp isn't configured yet, fail loudly per-row so they aren't silently dropped
  if (!token || !phoneId) {
    return json({ error: "WHATSAPP_TOKEN / WHATSAPP_PHONE_ID not configured", pending: pending.length }, 503);
  }

  let sent = 0, failed = 0;
  for (const row of pending) {
    try {
      const resp = await fetch(`${GRAPH}/${phoneId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalize(row.phone),
          type: "text",
          text: { body: row.message },
        }),
      });

      if (resp.ok) {
        await supabase.from("whatsapp_logs").update({ status: "Sent" }).eq("id", row.id);
        sent++;
      } else {
        const body = await resp.text();
        await supabase.from("whatsapp_logs").update({ status: "Failed", error_message: body.slice(0, 500) }).eq("id", row.id);
        failed++;
      }
    } catch (e) {
      await supabase.from("whatsapp_logs").update({ status: "Failed", error_message: String(e).slice(0, 500) }).eq("id", row.id);
      failed++;
    }
  }

  return json({ sent, failed });
});

/** Meta expects E.164 digits without the leading '+'. */
function normalize(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length === 10 ? `91${digits}` : digits; // assume India if 10-digit
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
