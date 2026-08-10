"use client";

// ============================================================================
// QuickFurno Admin V2 — Templates (C-WA1).
//
// FOUR INDEPENDENT TRUTH DIMENSIONS, never collapsed into one "Status" column:
//
//   LOCAL CONTRACT      what QuickFurno declares the template to be
//                       (committed submission manifest + code-proven bindings)
//   META / REMOTE       what Meta was last PROVEN to hold
//                       (committed remote-state evidence ledger)
//   MAPPING             the provider_template_mappings row, if any
//   RUNTIME ELIGIBILITY what the send-time gate would actually allow
//
// A template can be APPROVED at Meta and still be unsendable — unmapped,
// quarantined, or blocked by runtime policy. Showing one badge would lie.
//
// There is NO create, submit, delete, appeal, activate-mapping, retry-submission
// or category-override control here. Meta template submission is operator
// tooling under its own attestation workflow, not a browser button.
// ============================================================================

import { useState } from "react";
import { DataTable, Drawer, SectionCard, SelectFilter, StatusBadge, Toolbar } from "../AdminPrimitives";
import { Pagination } from "../Pagination";
import type { WhatsAppTemplatePageResult, WhatsAppTemplateRow } from "@/services/adminWhatsAppService";
import type { WhatsAppQuery } from "./whatsappAdminTypes";
import { FaultNotice, ReadOnlyNotice, FactGrid, humanize, when } from "./whatsappShared";

const GROUP_OPTIONS = ["All", "authentication", "consent_service", "transactional_business", "marketing"];
const SCOPE_OPTIONS = ["All", "authentication", "transactional", "marketing"];
const APPROVAL_OPTIONS = ["All", "approved", "not_approved"];
const MAPPING_OPTIONS = ["All", "mapped", "unmapped", "active"];

/** Runtime eligibility vocabulary → tone. Only ELIGIBLE is ever green. */
function eligibilityTone(value: string): "emerald" | "amber" | "rose" | "slate" {
  if (value === "ELIGIBLE") return "emerald";
  if (value === "MAPPING_STATE_UNKNOWN") return "rose";
  if (value === "BLOCKED_BY_RUNTIME") return "slate";
  return "amber";
}

/** Proven remote status → tone. Absence of evidence is never green. */
function remoteTone(value: string): "emerald" | "rose" | "slate" {
  if (value === "APPROVED") return "emerald";
  if (value === "DELETED") return "rose";
  return "slate";
}

/**
 * Read-only WhatsApp-style preview.
 *
 * Renders the LOCAL body specification with each {{n}} slot replaced by the
 * governed example fixture. This is a preview of declared copy — it is not a
 * render of a live provider payload and it is emphatically not a send.
 */
function TemplatePreview({ row }: { row: WhatsAppTemplateRow }) {
  const { local } = row;

  const filled = local.bodySpec.replace(/\{\{(\d+)\}\}/g, (match, position) => {
    const binding = local.bindings.find((b) => b.position === Number(position));
    return binding?.example ?? match;
  });

  return (
    <div className="space-y-2">
      <div className="rounded-[var(--qfa-radius-lg)] border border-[color:var(--qfa-line)] bg-[color:var(--qfa-inset)] p-3">
        <div className="max-w-sm rounded-[var(--qfa-radius)] border border-emerald-200/70 bg-emerald-50 px-3 py-2.5">
          <p className="whitespace-pre-wrap text-[13px] leading-5 text-slate-900">{filled}</p>
          {local.buttons.length > 0 ? (
            <div className="mt-2.5 space-y-1 border-t border-emerald-200/70 pt-2">
              {local.buttons.map((button, index) => (
                <p
                  key={`${button.type}-${index}`}
                  className="rounded-[var(--qfa-radius-xs)] border border-[color:var(--qfa-line)] px-2 py-1 text-center text-[12px] font-semibold text-sky-800"
                >
                  {button.text ?? humanize(button.type)}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          <strong>Example preview.</strong> Values are the governed example fixture from the source
          manifest, not real recipient data. Rendering a preview sends nothing.
        </p>
      </div>

      {!local.componentProfileSupported ? (
        <p className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          Component profile <strong>{local.componentProfile}</strong> is not implemented by the current
          renderer. The preview above shows the declared body only.
        </p>
      ) : null}
    </div>
  );
}

/** Variable contract table. An unresolved contract is stated, never invented. */
function VariableContract({ row }: { row: WhatsAppTemplateRow }) {
  const { local } = row;

  return (
    <div className="space-y-2">
      {local.bindingReadiness === "unresolved" ? (
        <p className="rounded-[var(--qfa-radius)] border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-900">
          VARIABLE CONTRACT UNRESOLVED — no source key is proven for this template. Positions and
          descriptions below are declarations only; the admin cannot supply or invent a source key.
        </p>
      ) : null}

      <DataTable<(typeof local.bindings)[number]>
        density="compact"
        columns={[
          { header: "Position", cell: (b) => <span className="tabular-nums">{b.position}</span> },
          { header: "Component", cell: (b) => b.component },
          {
            header: "Source key",
            cell: (b) =>
              b.sourceKey ? (
                <code className="text-[12px] text-cyan-800">{b.sourceKey}</code>
              ) : (
                <span className="text-[12px] text-amber-700">Unresolved</span>
              ),
          },
          { header: "Type", cell: (b) => b.parameterType },
          {
            header: "Example",
            cell: (b) => b.example ?? <span className="text-slate-400">—</span>,
          },
        ]}
        rows={[...local.bindings]}
        emptyTitle="No variables"
        emptyMessage="This template declares no positional parameters."
      />

      {local.codeProvenSourceKeys.length > 0 ? (
        <p className="text-[11px] text-slate-500">
          Source keys are additionally <strong>code-proven</strong> in
          {" "}lib/communication/businessTemplateVariables.ts: {local.codeProvenSourceKeys.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function TemplateDetail({ row }: { row: WhatsAppTemplateRow }) {
  const { local, remote, mappings } = row;

  return (
    <div className="space-y-4">
      <SectionCard title="Local contract" description="What QuickFurno declares — source governance state.">
        <FactGrid
          rows={[
            ["Internal key", <code key="k" className="text-[12px]">{local.internalTemplateKey}</code>],
            ["Governance group", humanize(local.group)],
            ["Category (candidate)", local.category],
            ["Language", local.language],
            ["Recipient type", humanize(local.recipientType)],
            ["Consent scope / lane", local.consentScope],
            ["Component profile", local.componentProfile],
            ["Provider name candidate", local.providerTemplateNameCandidate ?? "—"],
            ["Local submission state", local.submissionState],
            ["Local approval status", local.localApprovalStatus],
            ["Binding version", local.bindingVersion === null ? "—" : String(local.bindingVersion)],
            ["Owning subphase", local.owningSubphase ?? "—"],
          ]}
        />
        <p className="mt-3 text-[12px] leading-5 text-slate-600">{local.purpose}</p>
        {local.suppressionRule ? (
          <p className="mt-2 text-[11px] leading-4 text-slate-500">
            <strong>Suppression rule:</strong> {local.suppressionRule}
          </p>
        ) : null}
      </SectionCard>

      <SectionCard title="Preview" description="Declared copy with governed example values. Not a send.">
        <TemplatePreview row={row} />
      </SectionCard>

      <SectionCard title="Variables" description="Positional bindings and their proven source keys.">
        <VariableContract row={row} />
      </SectionCard>

      <SectionCard
        title="Meta / remote evidence"
        description="What Meta was last PROVEN to hold. Approval is not send authority."
      >
        {remote.length === 0 ? (
          <p className="text-[13px] text-slate-500">
            No proven remote evidence exists for this template. It has not been observed at Meta.
          </p>
        ) : (
          <div className="space-y-3">
            {remote.map((evidence) => (
              <div key={evidence.providerTemplateName} className="qfa-quiet px-3 py-2.5">
                <FactGrid
                  rows={[
                    ["Provider template name", <code key="n" className="text-[12px]">{evidence.providerTemplateName}</code>],
                    ["Last proven status", <StatusBadge key="s" value={evidence.lastProvenStatus} tone={remoteTone(evidence.lastProvenStatus)} />],
                    ["Requested category", evidence.requestedCategory ?? "—"],
                    ["Returned remote category", evidence.lastProvenRemoteCategory ?? "—"],
                    ["Disposition", <StatusBadge key="d" value={humanize(evidence.disposition)} tone="slate" />],
                    ["Send authority", <StatusBadge key="sa" value={evidence.sendAuthority} tone={evidence.sendAuthority === "DENIED" ? "rose" : "slate"} />],
                    ["Mapping authority", <StatusBadge key="ma" value={evidence.mappingAuthority} tone={evidence.mappingAuthority === "DENIED" ? "rose" : "slate"} />],
                    ["Reconciliation", evidence.reconciliationOutcome ?? "—"],
                  ]}
                />
                {evidence.notes ? (
                  <p className="mt-2 text-[11px] leading-4 text-slate-500">{evidence.notes}</p>
                ) : null}
                {evidence.evidenceReferences.length > 0 ? (
                  <p className="mt-2 text-[11px] text-slate-500">
                    Evidence files: {evidence.evidenceReferences.join(", ")}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Provider mapping"
        description="The row the send-time gate resolves. Approved AND active AND named."
      >
        {mappings.length === 0 ? (
          <p className="text-[13px] text-slate-500">
            No provider template mapping row exists for this template.
          </p>
        ) : (
          <DataTable<(typeof mappings)[number]>
            density="compact"
            columns={[
              { header: "Provider name", cell: (m) => m.providerTemplateName ?? <span className="text-slate-400">—</span> },
              { header: "Language", cell: (m) => m.language },
              { header: "Approval", cell: (m) => <StatusBadge value={humanize(m.approvalStatus)} /> },
              { header: "Active", cell: (m) => <StatusBadge value={m.isActive ? "active" : "inactive"} tone={m.isActive ? "emerald" : "slate"} /> },
              { header: "Version", cell: (m) => m.version },
              { header: "Bound positions", cell: (m) => <span className="tabular-nums">{m.boundPositionCount}</span> },
              { header: "Approved at", cell: (m) => when(m.approvedAt) },
            ]}
            rows={[...mappings]}
            emptyTitle="No mapping"
            emptyMessage="No provider template mapping row exists."
          />
        )}
      </SectionCard>

      <SectionCard title="Runtime eligibility" description="Derived only from the existing gates.">
        <StatusBadge value={humanize(row.runtimeEligibility)} tone={eligibilityTone(row.runtimeEligibility)} />
        <p className="mt-2 text-[12px] leading-5 text-slate-600">
          Eligibility here means the mapping and runtime gates would not block a send. Consent,
          suppression, frequency and the policy engine remain separate authorities that must also
          pass. Nothing on this screen can send.
        </p>
      </SectionCard>
    </div>
  );
}

export function WhatsAppTemplatesTab({
  result,
  query,
  setParam,
}: {
  result?: WhatsAppTemplatePageResult;
  query: WhatsAppQuery;
  setParam: (key: string, value?: string) => void;
}) {
  const [selected, setSelected] = useState<WhatsAppTemplateRow | null>(null);

  if (!result) return <FaultNotice fault="UNAVAILABLE" />;

  return (
    <div className="space-y-4">
      <ReadOnlyNotice>
        Templates are shown across four <strong>independent</strong> dimensions: the local contract,
        the proven Meta evidence, the provider mapping, and runtime eligibility. A template approved
        at Meta may still be unmapped, quarantined or runtime-blocked. There is no create, submit,
        delete, appeal or activate control here — Meta template submission is governed operator
        tooling, not an admin button.
      </ReadOnlyNotice>

      <Toolbar
        query={query.search ?? ""}
        setQuery={(value) => setParam("search", value || undefined)}
        placeholder="Search internal key, category or purpose…"
        filters={
          <>
            <SelectFilter
              label="Group"
              value={query.group ?? "All"}
              onChange={(value) => setParam("group", value)}
              options={GROUP_OPTIONS}
            />
            <SelectFilter
              label="Consent scope"
              value={query.lane ?? "All"}
              onChange={(value) => setParam("lane", value)}
              options={SCOPE_OPTIONS}
            />
            <SelectFilter
              label="Meta approval"
              value={query.approval ?? "All"}
              onChange={(value) => setParam("approval", value)}
              options={APPROVAL_OPTIONS}
            />
            <SelectFilter
              label="Mapping"
              value={query.mapping ?? "All"}
              onChange={(value) => setParam("mapping", value)}
              options={MAPPING_OPTIONS}
            />
          </>
        }
      />

      {result.mappingFault ? <FaultNotice fault={result.mappingFault} /> : null}

      <DataTable<WhatsAppTemplateRow>
        density="compact"
        getRowKey={(row) => row.local.internalTemplateKey}
        onRowClick={(row) => setSelected(row)}
        isRowActive={(row) => selected?.local.internalTemplateKey === row.local.internalTemplateKey}
        columns={[
          {
            header: "Internal key",
            cell: (row) => (
              <span className="font-semibold text-slate-950">{row.local.internalTemplateKey}</span>
            ),
          },
          { header: "Scope", cell: (row) => row.local.consentScope },
          { header: "Profile", cell: (row) => row.local.componentProfile },
          {
            header: "Local state",
            cell: (row) => <StatusBadge value={humanize(row.local.submissionState)} tone="slate" />,
          },
          {
            header: "Meta proven",
            cell: (row) => {
              const proven = row.remote[0];
              return proven ? (
                <StatusBadge value={proven.lastProvenStatus} tone={remoteTone(proven.lastProvenStatus)} />
              ) : (
                <span className="text-[11px] text-slate-400">No evidence</span>
              );
            },
          },
          {
            header: "Mapping",
            cell: (row) =>
              row.mappings.length === 0 ? (
                <span className="text-[11px] text-slate-400">Unmapped</span>
              ) : (
                <StatusBadge
                  value={row.mappings.some((m) => m.isActive) ? "active" : "inactive"}
                  tone={row.mappings.some((m) => m.isActive) ? "emerald" : "slate"}
                />
              ),
          },
          {
            header: "Runtime",
            cell: (row) => (
              <StatusBadge value={humanize(row.runtimeEligibility)} tone={eligibilityTone(row.runtimeEligibility)} />
            ),
          },
        ]}
        rows={[...result.rows]}
        emptyTitle="No templates match"
        emptyMessage="No internal template in the governed catalogue matches the current filters."
      />

      <Pagination
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        onPageChange={(page) => setParam("page", String(page))}
        noun="templates"
      />

      {selected ? (
        <Drawer
          title={selected.local.internalTemplateKey}
          subtitle="Local contract · Meta evidence · mapping · runtime eligibility"
          onClose={() => setSelected(null)}
          width="2xl"
        >
          <TemplateDetail row={selected} />
        </Drawer>
      ) : null}
    </div>
  );
}
