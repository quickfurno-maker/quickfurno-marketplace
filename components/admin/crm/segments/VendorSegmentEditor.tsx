"use client";
// ============================================================================
// QF-MVP-30.3C — deterministic segment editor + dynamic preview (admin-only).
//
// The rule builder offers ONLY closed field/operator choices from the locked
// registry — there is no free-form field name, no free-form operator and no
// free-text search. Client-side validation is a convenience; the SERVER result
// is authoritative (it re-parses, re-normalizes and re-fingerprints every save
// and every preview).
//
// Notes are append-only elsewhere; here the equivalent invariant is: there is NO
// delete control, NO campaign control and NO send/test-send control. A segment
// is a saved question, never permission to contact anyone.
// ============================================================================

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, SectionCard, InfoGrid, DataTable, StatusBadge, PrimaryButton, SecondaryButton, EmptyState } from "../../AdminPrimitives";
import {
  SEGMENT_FIELDS, SEGMENT_OPERATORS, SEGMENT_COMBINATORS, SEGMENT_MAX_GROUPS,
  SEGMENT_MAX_PREDICATES_PER_GROUP, SEGMENT_MAX_PREDICATES_TOTAL, SEGMENT_SCHEMA_VERSION,
} from "@/lib/crm/segmentRuleContracts";
import {
  segmentCreate, segmentUpdate, segmentActivate, segmentArchive, segmentPreview,
} from "@/app/actions/vendorSegmentActions";

const FIELD_KEYS = Object.keys(SEGMENT_FIELDS).sort();
const NO_VALUE_OPS = ["is_null", "is_not_null", "is_true", "is_false"];
const ARRAY_OPS = ["in", "not_in", "array_contains_any", "array_contains_all"];
const PAIR_OPS = ["between"];

type Pred = { field: string; op: string; value: string };
type Group = { combinator: string; predicates: Pred[] };

/** Build the AST the server will re-validate. Client shape only — never trusted. */
function toDefinition(combinator: string, groups: Group[]) {
  return {
    schema_version: SEGMENT_SCHEMA_VERSION,
    combinator,
    groups: groups.map((g) => ({
      combinator: g.combinator,
      predicates: g.predicates.map((p) => {
        if (NO_VALUE_OPS.includes(p.op)) return { field: p.field, op: p.op };
        if (ARRAY_OPS.includes(p.op)) {
          return { field: p.field, op: p.op, value: p.value.split(",").map((x) => x.trim()).filter(Boolean) };
        }
        if (PAIR_OPS.includes(p.op)) {
          return { field: p.field, op: p.op, value: p.value.split(",").map((x) => Number(x.trim())) };
        }
        const spec = SEGMENT_FIELDS[p.field];
        const numeric = !spec?.values && !spec?.uuidValued && /^-?\d+$/.test(p.value.trim());
        return { field: p.field, op: p.op, value: numeric ? Number(p.value.trim()) : p.value.trim() };
      }),
    })),
  };
}

export function VendorSegmentEditor({
  segmentId, segment, error,
}: {
  segmentId: string | null;
  segment: {
    id: string; name: string; description: string | null; status: string;
    definition: any; definition_version: number; definition_fingerprint: string;
    created_at: string; updated_at: string;
  } | null;
  error: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [name, setName] = useState(segment?.name ?? "");
  const [description, setDescription] = useState(segment?.description ?? "");
  const [combinator, setCombinator] = useState<string>(segment?.definition?.combinator ?? "AND");
  const [groups, setGroups] = useState<Group[]>(() => {
    const g = segment?.definition?.groups;
    if (Array.isArray(g) && g.length > 0) {
      return g.map((x: any) => ({
        combinator: x.combinator ?? "AND",
        predicates: (x.predicates ?? []).map((p: any) => ({
          field: p.field, op: p.op,
          value: Array.isArray(p.value) ? p.value.join(", ") : p.value === undefined ? "" : String(p.value),
        })),
      }));
    }
    return [{ combinator: "AND", predicates: [{ field: FIELD_KEYS[0], op: "eq", value: "" }] }];
  });

  const [message, setMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ id: string; name: string }[]>([]);
  const [preview, setPreview] = useState<any>(null);

  const totalPredicates = useMemo(
    () => groups.reduce((n, g) => n + g.predicates.length, 0), [groups]);

  if (error) {
    return (
      <div className="space-y-5">
        <PageHeader title="Segment" description="Deterministic vendor segment" />
        <EmptyState title="Segment unavailable" message={error} />
      </div>
    );
  }

  const definition = toDefinition(combinator, groups);
  const isArchived = segment?.status === "archived";

  const patchPred = (gi: number, pi: number, patch: Partial<Pred>) =>
    setGroups((gs) => gs.map((g, i) => i !== gi ? g : {
      ...g, predicates: g.predicates.map((p, j) => j !== pi ? p : { ...p, ...patch }),
    }));

  const act = (fn: () => Promise<any>, ok: string) => start(async () => {
    setMessage(null);
    const res = await fn();
    if (res?.ok) {
      setMessage(ok);
      if (res.data?.duplicates) setDuplicates(res.data.duplicates);
      if (res.data?.id && !segmentId) router.push(`/admin/vendor-crm/segments/${res.data.id}`);
      else router.refresh();
    } else {
      setMessage(res?.error ?? "That action could not be completed.");
    }
  });

  const runPreview = (page = 1) => start(async () => {
    setMessage(null);
    const res = await segmentPreview(definition, { page, pageSize: 25 }, {
      fingerprint: segment?.definition_fingerprint,
      definitionVersion: segment?.definition_version,
    });
    if (res.ok) { setPreview(res.data); }
    else { setPreview(null); setMessage(res.error); }
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title={segmentId ? name || "Segment" : "New segment"}
        description="Deterministic saved rule over Core and CRM facts."
      />

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Preview only — not communication authorization.</strong> This shows who matches the
        rule right now. Consent, suppression and send approval are decided separately at campaign
        time and are never implied by a segment.
      </div>

      {message && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">{message}</div>
      )}
      {duplicates.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Another live segment already describes this exact population:{" "}
          {duplicates.map((d) => d.name).join(", ")}. That is allowed — the same population may be
          tracked under more than one name.
        </div>
      )}

      <SectionCard title="Definition">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={isArchived}
                maxLength={120}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-300" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">Description</span>
              <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={isArchived}
                maxLength={2000}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-emerald-300" />
            </label>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-600">Combine groups with</span>
            <select value={combinator} onChange={(e) => setCombinator(e.target.value)} disabled={isArchived}
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm font-semibold">
              {SEGMENT_COMBINATORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <span className="text-xs text-slate-500">
              max {SEGMENT_MAX_GROUPS} groups · {SEGMENT_MAX_PREDICATES_PER_GROUP} rules per group ·
              {" "}{SEGMENT_MAX_PREDICATES_TOTAL} total (using {totalPredicates})
            </span>
          </div>

          {groups.map((g, gi) => (
            <div key={gi} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="font-medium text-slate-600">Group {gi + 1} — match</span>
                <select value={g.combinator} disabled={isArchived}
                  onChange={(e) => setGroups((gs) => gs.map((x, i) => i === gi ? { ...x, combinator: e.target.value } : x))}
                  className="h-9 rounded-lg border border-slate-200 px-2 text-sm font-semibold">
                  {SEGMENT_COMBINATORS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                {groups.length > 1 && !isArchived && (
                  <SecondaryButton onClick={() => setGroups((gs) => gs.filter((_, i) => i !== gi))}>
                    Remove group
                  </SecondaryButton>
                )}
              </div>

              <div className="space-y-2">
                {g.predicates.map((p, pi) => {
                  const spec = SEGMENT_FIELDS[p.field];
                  const ops = spec?.operators ?? Object.keys(SEGMENT_OPERATORS);
                  const needsValue = !NO_VALUE_OPS.includes(p.op);
                  return (
                    <div key={pi} className="flex flex-wrap items-center gap-2">
                      <select value={p.field} disabled={isArchived}
                        onChange={(e) => patchPred(gi, pi, { field: e.target.value, op: SEGMENT_FIELDS[e.target.value].operators[0], value: "" })}
                        className="h-10 rounded-lg border border-slate-200 px-2 text-sm">
                        {FIELD_KEYS.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <select value={p.op} disabled={isArchived}
                        onChange={(e) => patchPred(gi, pi, { op: e.target.value, value: "" })}
                        className="h-10 rounded-lg border border-slate-200 px-2 text-sm">
                        {ops.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                      {needsValue && (
                        spec?.values ? (
                          <select value={p.value} disabled={isArchived}
                            onChange={(e) => patchPred(gi, pi, { value: e.target.value })}
                            className="h-10 rounded-lg border border-slate-200 px-2 text-sm">
                            <option value="">—</option>
                            {spec.values.map((v) => <option key={v} value={v}>{v}</option>)}
                          </select>
                        ) : (
                          <input value={p.value} disabled={isArchived} maxLength={200}
                            onChange={(e) => patchPred(gi, pi, { value: e.target.value })}
                            placeholder={ARRAY_OPS.includes(p.op) ? "comma-separated" : PAIR_OPS.includes(p.op) ? "lo, hi" : "value"}
                            className="h-10 w-56 rounded-lg border border-slate-200 px-2 text-sm" />
                        )
                      )}
                      {g.predicates.length > 1 && !isArchived && (
                        <button onClick={() => setGroups((gs) => gs.map((x, i) => i !== gi ? x : { ...x, predicates: x.predicates.filter((_, j) => j !== pi) }))}
                          className="text-xs text-slate-500 hover:text-rose-600">remove</button>
                      )}
                    </div>
                  );
                })}
              </div>

              {!isArchived && g.predicates.length < SEGMENT_MAX_PREDICATES_PER_GROUP && (
                <div className="mt-2">
                  <SecondaryButton onClick={() => setGroups((gs) => gs.map((x, i) => i !== gi ? x : { ...x, predicates: [...x.predicates, { field: FIELD_KEYS[0], op: SEGMENT_FIELDS[FIELD_KEYS[0]].operators[0], value: "" }] }))}>
                    Add rule
                  </SecondaryButton>
                </div>
              )}
            </div>
          ))}

          {!isArchived && groups.length < SEGMENT_MAX_GROUPS && (
            <SecondaryButton onClick={() => setGroups((gs) => [...gs, { combinator: "AND", predicates: [{ field: FIELD_KEYS[0], op: SEGMENT_FIELDS[FIELD_KEYS[0]].operators[0], value: "" }] }])}>
              Add group
            </SecondaryButton>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            {!isArchived && (
              <PrimaryButton onClick={() => segmentId
                ? act(() => segmentUpdate(segmentId, { name, description, definition }), "Segment saved.")
                : act(() => segmentCreate({ name, description, definition }), "Segment created.")}>
                {pending ? "Saving…" : segmentId ? "Save" : "Create"}
              </PrimaryButton>
            )}
            <SecondaryButton onClick={() => runPreview(1)}>
              {pending ? "Evaluating…" : "Preview matches"}
            </SecondaryButton>
            {segmentId && !isArchived && segment?.status !== "active" && (
              <SecondaryButton onClick={() => act(() => segmentActivate(segmentId), "Segment activated.")}>
                Activate
              </SecondaryButton>
            )}
            {segmentId && !isArchived && (
              <SecondaryButton onClick={() => act(() => segmentArchive(segmentId), "Segment archived.")}>
                Archive
              </SecondaryButton>
            )}
          </div>
        </div>
      </SectionCard>

      {segment && (
        <SectionCard title="Provenance">
          <InfoGrid rows={[
            ["Status", <StatusBadge key="s" value={segment.status} />],
            ["Definition version", <span key="v" className="tabular-nums">v{segment.definition_version}</span>],
            ["Fingerprint", <code key="f" className="text-xs">{segment.definition_fingerprint}</code>],
            ["Created", new Date(segment.created_at).toLocaleString()],
            ["Updated", new Date(segment.updated_at).toLocaleString()],
          ]} />
        </SectionCard>
      )}

      <SectionCard title="Preview (evaluated now — nothing is stored)">
        {preview ? (
          <div className="space-y-3">
            <div className="text-sm text-slate-600">
              <strong className="tabular-nums">{preview.total}</strong> vendor{preview.total === 1 ? "" : "s"} match ·
              evaluated {new Date(preview.evaluatedAt).toLocaleString()} ·
              page {preview.page} (max {preview.pageSize})
            </div>
            <DataTable<any>
              columns={[
                { header: "Vendor", cell: (v) => v.business_name ?? "—" },
                { header: "City", cell: (v) => v.city ?? "—" },
                { header: "Verification", cell: (v) => <StatusBadge value={v.status} /> },
                { header: "Enabled", cell: (v) => (v.is_active ? "Yes" : "No") },
              ]}
              rows={preview.rows}
              emptyTitle="No vendors match"
              emptyMessage="No vendor currently satisfies this rule. The rule is saved; matches are recomputed every time."
            />
            <div className="flex gap-2">
              <SecondaryButton onClick={() => runPreview(Math.max(1, preview.page - 1))}>Previous</SecondaryButton>
              <SecondaryButton onClick={() => runPreview(preview.page + 1)}>Next</SecondaryButton>
            </div>
          </div>
        ) : (
          <EmptyState title="No preview yet" message="Run a preview to see who matches this rule right now." compact />
        )}
      </SectionCard>
    </div>
  );
}
