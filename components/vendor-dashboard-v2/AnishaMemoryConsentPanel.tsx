"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Decision = "GRANTED" | "DENIED" | "UNKNOWN";
type Status = {
  readonly decision: Decision;
  readonly erasurePending: boolean;
};

export function AnishaMemoryConsentPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [acceptedNotice, setAcceptedNotice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/vendor/anisha-memory-consent", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const data: unknown = await response.json();
      if (!response.ok || !data || typeof data !== "object")
        throw new Error("unavailable");
      const row = data as Record<string, unknown>;
      if (
        row["ok"] !== true ||
        !["GRANTED", "DENIED", "UNKNOWN"].includes(String(row["decision"])) ||
        typeof row["erasurePending"] !== "boolean"
      )
        throw new Error("unavailable");
      setStatus({
        decision: row["decision"] as Decision,
        erasurePending: row["erasurePending"],
      });
    } catch {
      setStatus(null);
      setMessage(
        "Memory preference status is unavailable. No consent changes were made.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(decision: "GRANT" | "REVOKE") {
    if (
      saving ||
      !status ||
      (decision === "GRANT" && (!acceptedNotice || status.erasurePending))
    )
      return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/vendor/anisha-memory-consent", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data: unknown = await response.json();
      if (
        !response.ok ||
        !data ||
        typeof data !== "object" ||
        (data as Record<string, unknown>)["ok"] !== true
      )
        throw new Error("unavailable");
      await load();
      setAcceptedNotice(false);
      setMessage(
        decision === "GRANT"
          ? "Optional memory consent has been saved in Core. This does not itself activate AI memory."
          : "Consent revoked. Future memory access is blocked; physical deletion is pending confirmation.",
      );
    } catch {
      setMessage(
        "Could not confirm the change. Please refresh and verify before retrying.",
      );
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-labelledby="anisha-memory-heading"
      style={{ maxWidth: 720, margin: "0 auto", padding: "24px 0" }}
    >
      <h1 id="anisha-memory-heading">Anisha — optional memory preferences</h1>
      <p>Staging preview. Separate from WhatsApp and marketing consent.</p>
      <p>
        With your permission, Anisha may remember your preferred language and
        reply style for up to 30 days. No full chat transcripts, exact credit
        balances, customer contacts, payments or package status are stored as
        long-term preferences. QuickFurno Core remains the source of current
        business information.
      </p>
      <p>
        You can withdraw permission here. Future memory reads are blocked
        immediately; permanent deletion runs through a separate verified
        process. Deletion completion is shown only after Core confirms it, and
        is not instantaneous.
      </p>
      <p>
        <Link href="/privacy">QuickFurno privacy policy</Link>
      </p>
      {loading ? <p role="status">Checking consent status…</p> : null}
      {!loading && status ? (
        <>
          <p role="status">
            <strong>Consent:</strong>{" "}
            {status.decision === "GRANTED"
              ? "Enabled in Core"
              : status.decision === "DENIED"
                ? "Not granted"
                : "No recorded permission"}
          </p>
          {status.erasurePending ? (
            <p role="status">
              Memory deletion is pending verification. You cannot grant new
              consent until deletion is acknowledged.
            </p>
          ) : null}
          {status.decision !== "GRANTED" ? (
            <label
              style={{
                display: "flex",
                gap: 12,
                alignItems: "start",
                margin: "20px 0",
              }}
            >
              <input
                type="checkbox"
                checked={acceptedNotice}
                onChange={(event) => setAcceptedNotice(event.target.checked)}
              />
              <span>
                I explicitly allow Anisha to remember only the optional 30-day
                language and communication preferences described above.
              </span>
            </label>
          ) : null}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {status.decision === "GRANTED" ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => void change("REVOKE")}
              >
                Withdraw consent and request erasure
              </button>
            ) : (
              <button
                type="button"
                disabled={saving || !acceptedNotice || status.erasurePending}
                onClick={() => void change("GRANT")}
              >
                Grant optional memory permission
              </button>
            )}
            <button type="button" disabled={saving} onClick={() => void load()}>
              Refresh status
            </button>
          </div>
        </>
      ) : null}
      {message ? (
        <p role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
    </section>
  );
}
