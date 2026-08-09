"use client";

import { useEffect, useMemo, useState } from "react";
import {
  VENDOR_CONTACT_CHANNELS,
  VENDOR_CRM_ONBOARDING_STAGES,
  VENDOR_CRM_RELATIONSHIP_STATUSES,
  VENDOR_NOTE_CATEGORIES,
  VENDOR_TASK_PRIORITIES,
  VENDOR_TASK_STATUSES,
  VENDOR_TASK_TYPES,
  type VendorTaskStatus,
} from "@/lib/crm/vendorCrmContracts";
import type {
  PagedResult,
  VendorContact,
  VendorCoreFacts,
  VendorCrmProfileRecord,
  VendorCrmProfileSummary,
  VendorNote,
  VendorTag,
  VendorTagAssignment,
  VendorTask,
} from "@/lib/crm/vendorCrmProfileTypes";
import {
  ConfirmDialog,
  DataTable,
  DangerButton,
  EmptyState,
  NoteBar,
  PrimaryButton,
  SectionCard,
  SecondaryButton,
  StatusBadge,
} from "../AdminPrimitives";
import { Pagination } from "../Pagination";

const DATE_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});
const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export function formatDate(value: string | null, includeTime = true): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return includeTime ? DATE_TIME_FORMAT.format(date) : DATE_FORMAT.format(date);
}

function humanize(value: string | null | undefined): string {
  if (!value) return "Not set";
  return value.replaceAll("_", " ");
}

function availabilityLabel(value: boolean | null): string {
  return value === true ? "Available for new assignments" : "Unavailable for new assignments";
}

function enabledLabel(value: boolean | null): string {
  return value === true ? "Active" : value === false ? "Disabled" : "Not set";
}

function listValue(values: string[] | null): string {
  return values?.length ? values.join(", ") : "Not set";
}

const controlClass =
  "qfa-control qfa-focus w-full bg-[color:var(--qfa-inset)] px-3 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-55";
const textareaClass =
  "qfa-focus min-h-[88px] w-full resize-y rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-[color:var(--qfa-inset)] px-3 py-2 text-[13px] leading-5 text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:opacity-55";

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-slate-600">{label}</span>
      {children}
      {helper ? <span className="text-[10px] leading-4 text-slate-500">{helper}</span> : null}
    </label>
  );
}

function SelectControl({
  value,
  options,
  onChange,
  disabled,
  emptyLabel = "Not set",
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  return (
    <span className="relative">
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`${controlClass} qfa-select pr-8 capitalize`}
      >
        {options.map((option) => (
          <option key={option || "empty"} value={option}>
            {option ? humanize(option) : emptyLabel}
          </option>
        ))}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">▼</span>
    </span>
  );
}

function FactGrid({ rows }: { rows: Array<{ label: string; value: React.ReactNode }> }) {
  return (
    <dl className="grid gap-px overflow-hidden rounded-[var(--qfa-radius)] border border-[color:var(--qfa-line)] bg-[color:var(--qfa-line)] sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0 bg-[color:var(--qfa-inset)] px-3 py-2.5">
          <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{row.label}</dt>
          <dd className="mt-1 break-words text-[13px] font-medium text-slate-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// -- Overview ----------------------------------------------------------------

export function OverviewTab({
  core,
  profile,
  summary,
  tagAssignments,
  pending,
  onSave,
}: {
  core: VendorCoreFacts;
  profile: VendorCrmProfileRecord | null;
  summary: VendorCrmProfileSummary;
  tagAssignments: VendorTagAssignment[];
  pending: boolean;
  onSave: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex min-w-0 flex-col gap-4">
        <SectionCard title="Core snapshot" description="Marketplace authority · read-only in Vendor CRM">
          <FactGrid
            rows={[
              { label: "Verification", value: <StatusBadge value={core.status ?? "Not set"} /> },
              { label: "Enabled state", value: enabledLabel(core.is_active) },
              { label: "Assignment availability", value: availabilityLabel(core.accepting_leads) },
              { label: "City", value: core.city ?? "Not set" },
              { label: "Categories", value: listValue(core.service_categories) },
              {
                label: "Coverage",
                value: core.covers_full_city ? "Full-city coverage" : listValue(core.areas_covered),
              },
              { label: "Credits", value: `${core.remaining_credits ?? 0} remaining / ${core.total_credits ?? 0} total` },
              { label: "Last assignment", value: formatDate(core.last_assigned_at) },
              { label: "Vendor since", value: formatDate(core.created_at, false) },
            ]}
          />

          <div className="mt-4 border-t border-[color:var(--qfa-line-soft)] pt-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Assigned CRM tags</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tagAssignments.length ? tagAssignments.map((assignment) => (
                <StatusBadge key={assignment.id} value={assignment.vendor_tags?.name ?? "Tag"} tone="violet" />
              )) : <span className="text-[13px] text-slate-500">No tags assigned.</span>}
            </div>
          </div>
        </SectionCard>

        <RelationshipForm profile={profile} pending={pending} onSave={onSave} />
      </div>

      <div className="min-w-0 xl:sticky xl:top-24 xl:self-start">
        <ContextRail core={core} profile={profile} summary={summary} />
      </div>
    </div>
  );
}

function RelationshipForm({
  profile,
  pending,
  onSave,
}: {
  profile: VendorCrmProfileRecord | null;
  pending: boolean;
  onSave: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const [form, setForm] = useState({
    onboarding_stage: profile?.onboarding_stage ?? "new",
    relationship_status: profile?.relationship_status ?? "prospect",
    next_follow_up_at: profile?.next_follow_up_at?.slice(0, 10) ?? "",
    company_type: profile?.company_type ?? "",
    budget_band: profile?.budget_band ?? "",
    residential_commercial_scope: profile?.residential_commercial_scope ?? "",
    capability_notes: profile?.capability_notes ?? "",
    campaign_notes: profile?.campaign_notes ?? "",
  });
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <SectionCard
      title="CRM relationship"
      description="Relationship enrichment owned by Vendor CRM"
      action={<StatusBadge value={profile ? "Profile active" : "Profile not created"} tone={profile ? "emerald" : "amber"} />}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Onboarding stage">
          <SelectControl value={form.onboarding_stage} options={VENDOR_CRM_ONBOARDING_STAGES} disabled={pending} onChange={(value) => set("onboarding_stage", value)} />
        </Field>
        <Field label="Relationship status">
          <SelectControl value={form.relationship_status} options={VENDOR_CRM_RELATIONSHIP_STATUSES} disabled={pending} onChange={(value) => set("relationship_status", value)} />
        </Field>
        <Field label="Next follow-up">
          <input type="date" value={form.next_follow_up_at} disabled={pending} onChange={(event) => set("next_follow_up_at", event.target.value)} className={controlClass} />
        </Field>
        <Field label="Company type">
          <input value={form.company_type} disabled={pending} onChange={(event) => set("company_type", event.target.value)} className={controlClass} placeholder="e.g. Studio, contractor" />
        </Field>
        <Field label="Budget band">
          <input value={form.budget_band} disabled={pending} onChange={(event) => set("budget_band", event.target.value)} className={controlClass} placeholder="Existing CRM value" />
        </Field>
        <Field label="Residential / commercial scope">
          <SelectControl value={form.residential_commercial_scope} options={["", "residential", "commercial", "both"]} disabled={pending} onChange={(value) => set("residential_commercial_scope", value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Capability notes">
            <textarea value={form.capability_notes} disabled={pending} onChange={(event) => set("capability_notes", event.target.value)} className={textareaClass} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Campaign notes">
            <textarea value={form.campaign_notes} disabled={pending} onChange={(event) => set("campaign_notes", event.target.value)} className={textareaClass} />
          </Field>
        </div>
      </div>
      <div className="mt-4 flex justify-end border-t border-[color:var(--qfa-line-soft)] pt-4">
        <PrimaryButton
          disabled={pending}
          onClick={() => onSave({
            ...form,
            next_follow_up_at: form.next_follow_up_at || null,
            residential_commercial_scope: form.residential_commercial_scope || null,
          })}
        >
          {pending ? "Saving…" : "Save relationship"}
        </PrimaryButton>
      </div>
    </SectionCard>
  );
}

function followUpState(value: string | null): { label: string; tone: "rose" | "amber" | "blue" | "slate" } {
  if (!value) return { label: "Not scheduled", tone: "slate" };
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return { label: "Not scheduled", tone: "slate" };
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 86_400_000;
  if (due.getTime() < start) return { label: "Follow-up overdue", tone: "rose" };
  if (due.getTime() < end) return { label: "Follow-up due today", tone: "amber" };
  return { label: "Follow-up upcoming", tone: "blue" };
}

function ContextRail({
  core,
  profile,
  summary,
}: {
  core: VendorCoreFacts;
  profile: VendorCrmProfileRecord | null;
  summary: VendorCrmProfileSummary;
}) {
  const followUp = followUpState(profile?.next_follow_up_at ?? null);
  const attention = [
    summary.overdue_tasks > 0 ? `${summary.overdue_tasks} overdue task${summary.overdue_tasks === 1 ? "" : "s"}` : null,
    followUp.tone === "rose" || followUp.tone === "amber" ? followUp.label : null,
    !summary.primary_contact ? "No primary CRM contact" : null,
    !profile ? "No CRM profile yet" : null,
  ].filter((item): item is string => Boolean(item));

  return (
    <section className="qfa-panel overflow-hidden" aria-label="Vendor account context">
      <div className="border-b border-[color:var(--qfa-line-soft)] px-4 py-3">
        <h2 className="text-[15px] font-semibold text-slate-950">Account context</h2>
        <p className="mt-0.5 text-xs text-slate-500">Live relationship and operating facts</p>
      </div>

      <div className="divide-y divide-[color:var(--qfa-line-soft)]">
        <RailBlock label="Relationship" value={humanize(profile?.relationship_status)} helper={`Stage · ${humanize(profile?.onboarding_stage)}`} />
        <RailBlock label="Next follow-up" value={formatDate(profile?.next_follow_up_at ?? null)} helper={followUp.label} tone={followUp.tone} />
        <RailBlock label="Tasks" value={`${summary.open_tasks} open · ${summary.overdue_tasks} overdue`} helper={`${summary.notes_total} total notes`} tone={summary.overdue_tasks ? "rose" : "slate"} />
        <RailBlock
          label="Primary contact"
          value={summary.primary_contact?.name ?? "Not set"}
          helper={summary.primary_contact?.role_title ?? `${summary.contacts_total} active contact${summary.contacts_total === 1 ? "" : "s"}`}
        />
        <RailBlock label="Availability" value={availabilityLabel(core.accepting_leads)} />
        <RailBlock label="Credits" value={`${core.remaining_credits ?? 0} / ${core.total_credits ?? 0}`} helper="Remaining / total" />
        <RailBlock
          label="Latest note"
          value={summary.latest_note?.note ?? "No notes yet"}
          helper={summary.latest_note ? formatDate(summary.latest_note.created_at) : undefined}
        />
      </div>

      <div className="border-t border-[color:var(--qfa-line-soft)] px-4 py-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">Attention</p>
        {attention.length ? (
          <ul className="mt-2 space-y-1.5">
            {attention.map((item) => (
              <li key={item} className="flex items-start gap-2 text-[12px] leading-5 text-slate-700">
                <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                {item}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-[12px] text-slate-500">No immediate CRM attention from current records.</p>}
      </div>
    </section>
  );
}

function RailBlock({
  label,
  value,
  helper,
  tone = "slate",
}: {
  label: string;
  value: string;
  helper?: string;
  tone?: "rose" | "amber" | "blue" | "slate";
}) {
  const color = tone === "rose" ? "text-rose-700" : tone === "amber" ? "text-amber-700" : tone === "blue" ? "text-sky-700" : "text-slate-900";
  return (
    <div className="px-4 py-2.5">
      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className={`mt-0.5 break-words text-[13px] font-semibold leading-5 ${color}`}>{value}</p>
      {helper ? <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{helper}</p> : null}
    </div>
  );
}

// -- Contacts ----------------------------------------------------------------

export function ContactsTab({
  page,
  pendingKey,
  onPageChange,
  onCreate,
  onArchive,
}: {
  page: PagedResult<VendorContact>;
  pendingKey: string | null;
  onPageChange: (page: number) => void;
  onCreate: (input: Record<string, unknown>) => Promise<boolean>;
  onArchive: (contactId: string) => Promise<boolean>;
}) {
  const [archiveTarget, setArchiveTarget] = useState<VendorContact | null>(null);
  const columns = [
    {
      header: "Name",
      cell: (contact: VendorContact) => (
        <span className="flex min-w-[9rem] items-center gap-1.5 font-semibold text-slate-900">
          {contact.name}
          {contact.is_primary ? <StatusBadge value="Primary" tone="cyan" /> : null}
        </span>
      ),
    },
    { header: "Role / title", cell: (contact: VendorContact) => contact.role_title ?? "—" },
    { header: "Phone", cell: (contact: VendorContact) => contact.phone ?? "—" },
    { header: "Email", cell: (contact: VendorContact) => contact.email ?? "—" },
    { header: "Preferred channel", cell: (contact: VendorContact) => humanize(contact.preferred_channel) },
    {
      header: "",
      className: "text-right",
      cell: (contact: VendorContact) => (
        <SecondaryButton
          size="sm"
          disabled={pendingKey === `contact-archive-${contact.id}`}
          onClick={() => setArchiveTarget(contact)}
        >
          Archive
        </SecondaryButton>
      ),
    },
  ];

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <NoteBar>
            <strong className="font-semibold text-slate-800">Consent boundary:</strong> a CRM contact does not grant communication consent. Core owns consent and communication authority.
          </NoteBar>
          {page.rows.length ? (
            <DataTable columns={columns} rows={page.rows} density="compact" getRowKey={(contact) => contact.id} emptyTitle="No contacts" emptyMessage="Add the first CRM contact." />
          ) : (
            <EmptyState title="No active contacts" message="Add a decision-maker or operational contact for this vendor." />
          )}
          <Pagination page={page.page} pageSize={page.pageSize} total={page.total} noun="contacts" onPageChange={onPageChange} />
          <p className="text-[11px] text-slate-500">Archive preserves the contact lifecycle record; it does not hard-delete it.</p>
        </div>
        <ContactForm pending={pendingKey === "contact-create"} onCreate={onCreate} />
      </div>

      {archiveTarget ? (
        <ConfirmDialog
          title="Archive CRM contact?"
          message={`${archiveTarget.name} will leave the active contacts list. The lifecycle record is retained.`}
          onCancel={() => setArchiveTarget(null)}
          onConfirm={async () => {
            const target = archiveTarget;
            setArchiveTarget(null);
            await onArchive(target.id);
          }}
        />
      ) : null}
    </>
  );
}

function ContactForm({
  pending,
  onCreate,
}: {
  pending: boolean;
  onCreate: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const empty = { name: "", role_title: "", phone: "", email: "", preferred_channel: "", is_primary: false };
  const [form, setForm] = useState(empty);
  const valid = form.name.trim().length > 0 && (form.phone.trim().length > 0 || form.email.trim().length > 0);

  return (
    <SectionCard title="Add contact" description="Private CRM relationship contact" className="self-start xl:sticky xl:top-24">
      <div className="space-y-3">
        <Field label="Name"><input value={form.name} disabled={pending} onChange={(event) => setForm({ ...form, name: event.target.value })} className={controlClass} /></Field>
        <Field label="Role / title"><input value={form.role_title} disabled={pending} onChange={(event) => setForm({ ...form, role_title: event.target.value })} className={controlClass} /></Field>
        <Field label="Phone" helper="Phone or email is required."><input type="tel" value={form.phone} disabled={pending} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={controlClass} /></Field>
        <Field label="Email"><input type="email" value={form.email} disabled={pending} onChange={(event) => setForm({ ...form, email: event.target.value })} className={controlClass} /></Field>
        <Field label="Preferred channel">
          <SelectControl value={form.preferred_channel} options={["", ...VENDOR_CONTACT_CHANNELS]} disabled={pending} onChange={(value) => setForm({ ...form, preferred_channel: value })} />
        </Field>
        <label className="qfa-quiet flex min-h-10 cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] font-medium text-slate-700">
          <input
            type="checkbox"
            checked={form.is_primary}
            disabled={pending}
            onChange={(event) => setForm({ ...form, is_primary: event.target.checked })}
            className="h-4 w-4 accent-cyan-500"
          />
          Make primary contact
        </label>
        <PrimaryButton
          className="w-full"
          disabled={!valid || pending}
          onClick={async () => {
            const ok = await onCreate({ ...form, preferred_channel: form.preferred_channel || null });
            if (ok) setForm(empty);
          }}
        >
          {pending ? "Adding…" : "Add contact"}
        </PrimaryButton>
      </div>
    </SectionCard>
  );
}

// -- Tags --------------------------------------------------------------------

export function TagsTab({
  assignments,
  allTags,
  pendingKey,
  onAssign,
  onRemove,
  onCreate,
}: {
  assignments: VendorTagAssignment[];
  allTags: VendorTag[];
  pendingKey: string | null;
  onAssign: (tagId: string) => Promise<boolean>;
  onRemove: (tagId: string) => Promise<boolean>;
  onCreate: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const assignedIds = useMemo(() => new Set(assignments.map((assignment) => assignment.tag_id)), [assignments]);
  const available = allTags.filter((tag) => tag.is_active && !assignedIds.has(tag.id));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <SectionCard title="Assigned tags" description={`${assignments.length} active assignment${assignments.length === 1 ? "" : "s"}`}>
        {assignments.length ? (
          <ul className="divide-y divide-[color:var(--qfa-line-soft)]">
            {assignments.map((assignment) => (
              <li key={assignment.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-slate-900">{assignment.vendor_tags?.name ?? "Inactive tag"}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Assigned {formatDate(assignment.assigned_at)}</p>
                </div>
                <SecondaryButton
                  size="sm"
                  disabled={pendingKey === `tag-remove-${assignment.tag_id}`}
                  onClick={() => onRemove(assignment.tag_id)}
                >
                  Unassign
                </SecondaryButton>
              </li>
            ))}
          </ul>
        ) : <EmptyState compact title="No tags assigned" message="Assign an active tag from the CRM vocabulary." />}
      </SectionCard>

      <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
        <SectionCard title="Assign existing" description="Active global CRM vocabulary">
          <div className="space-y-3">
            <Field label="Tag">
              <span className="relative">
                <select
                  value={selected}
                  disabled={pendingKey === "tag-assign"}
                  onChange={(event) => setSelected(event.target.value)}
                  className={`${controlClass} qfa-select pr-8`}
                >
                  <option value="">Choose a tag</option>
                  {available.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
                <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[9px] text-slate-400">▼</span>
              </span>
            </Field>
            {selected ? <p className="text-[11px] text-slate-500">Selected · {available.find((tag) => tag.id === selected)?.name}</p> : null}
            <PrimaryButton
              className="w-full"
              disabled={!selected || pendingKey === "tag-assign"}
              onClick={async () => {
                const ok = await onAssign(selected);
                if (ok) setSelected("");
              }}
            >
              {pendingKey === "tag-assign" ? "Assigning…" : "Assign tag"}
            </PrimaryButton>
          </div>
        </SectionCard>

        <SectionCard title="Create tag" description="The server normalizes names and prevents duplicates.">
          <div className="space-y-3">
            <Field label="Tag name"><input value={name} disabled={pendingKey === "tag-create"} onChange={(event) => setName(event.target.value)} className={controlClass} /></Field>
            <PrimaryButton
              className="w-full"
              disabled={!name.trim() || pendingKey === "tag-create"}
              onClick={async () => {
                const ok = await onCreate({ name });
                if (ok) setName("");
              }}
            >
              {pendingKey === "tag-create" ? "Creating…" : "Create tag"}
            </PrimaryButton>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

// -- Notes -------------------------------------------------------------------

export function NotesTab({
  page,
  pending,
  onPageChange,
  onCreate,
}: {
  page: PagedResult<VendorNote>;
  pending: boolean;
  onPageChange: (page: number) => void;
  onCreate: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-3">
        <NoteBar>
          <strong className="font-semibold text-slate-800">Append-only history.</strong> Notes cannot be edited, overwritten, or deleted. Add another note to record a correction.
        </NoteBar>
        <SectionCard title="Relationship notes" description={`${page.total} total note${page.total === 1 ? "" : "s"}`}>
          {page.rows.length ? (
            <ol className="relative ml-1 border-l border-[color:var(--qfa-line)]">
              {page.rows.map((note) => (
                <li key={note.id} className="relative pb-5 pl-5 last:pb-0">
                  <span aria-hidden="true" className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[color:var(--qfa-surface)] bg-cyan-400" />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <StatusBadge value={note.category ?? "general"} tone="slate" />
                    <time className="text-[11px] text-slate-500" dateTime={note.created_at}>{formatDate(note.created_at)}</time>
                    {note.author_name ? <span className="text-[11px] text-slate-500">by {note.author_name}</span> : null}
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-5 text-slate-700">{note.note}</p>
                </li>
              ))}
            </ol>
          ) : <EmptyState compact title="No notes" message="Add the first relationship note." />}
        </SectionCard>
        <Pagination page={page.page} pageSize={page.pageSize} total={page.total} noun="notes" onPageChange={onPageChange} />
      </div>

      <SectionCard title="Add note" description="Creates a permanent timeline entry" className="self-start xl:sticky xl:top-24">
        <div className="space-y-3">
          <Field label="Category">
            <SelectControl value={category} options={VENDOR_NOTE_CATEGORIES} disabled={pending} onChange={setCategory} />
          </Field>
          <Field label="Note body">
            <textarea value={body} disabled={pending} onChange={(event) => setBody(event.target.value)} className={`${textareaClass} min-h-[150px]`} placeholder="Add factual CRM context…" />
          </Field>
          <PrimaryButton
            className="w-full"
            disabled={!body.trim() || pending}
            onClick={async () => {
              const ok = await onCreate({ note: body, category });
              if (ok) setBody("");
            }}
          >
            {pending ? "Adding…" : "Add note"}
          </PrimaryButton>
        </div>
      </SectionCard>
    </div>
  );
}

// -- Tasks -------------------------------------------------------------------

export function TasksTab({
  page,
  status,
  summary,
  pendingKey,
  onFilterChange,
  onPageChange,
  onCreate,
  onComplete,
  onCancel,
}: {
  page: PagedResult<VendorTask>;
  status?: VendorTaskStatus;
  summary: VendorCrmProfileSummary;
  pendingKey: string | null;
  onFilterChange: (status?: VendorTaskStatus) => void;
  onPageChange: (page: number) => void;
  onCreate: (input: Record<string, unknown>) => Promise<boolean>;
  onComplete: (taskId: string, result: string) => Promise<boolean>;
  onCancel: (taskId: string) => Promise<boolean>;
}) {
  const [completeTarget, setCompleteTarget] = useState<VendorTask | null>(null);
  const [cancelTarget, setCancelTarget] = useState<VendorTask | null>(null);
  const now = Date.now();
  const columns = [
    {
      header: "Task",
      cell: (task: VendorTask) => (
        <span className="block min-w-[12rem]">
          <span className="block font-semibold text-slate-900">{task.title}</span>
          {task.description ? <span className="mt-0.5 block max-w-sm truncate text-[11px] text-slate-500">{task.description}</span> : null}
        </span>
      ),
    },
    { header: "Type", cell: (task: VendorTask) => <span className="capitalize">{humanize(task.task_type)}</span> },
    { header: "Priority", cell: (task: VendorTask) => <StatusBadge value={task.priority} /> },
    {
      header: "Due",
      cell: (task: VendorTask) => {
        const overdue = Boolean(task.due_at && Date.parse(task.due_at) < now && ["open", "in_progress"].includes(task.status));
        return <span className={overdue ? "font-semibold text-rose-700" : "text-slate-700"}>{formatDate(task.due_at, false)}</span>;
      },
    },
    { header: "Status", cell: (task: VendorTask) => <StatusBadge value={task.status} /> },
    {
      header: "",
      className: "text-right",
      cell: (task: VendorTask) => ["done", "cancelled"].includes(task.status) ? (
        <span className="text-[11px] text-slate-400">Lifecycle closed</span>
      ) : (
        <div className="flex justify-end gap-1">
          <SecondaryButton size="sm" disabled={pendingKey === `task-complete-${task.id}`} onClick={() => setCompleteTarget(task)}>Complete</SecondaryButton>
          <DangerButton size="sm" disabled={pendingKey === `task-cancel-${task.id}`} onClick={() => setCancelTarget(task)}>Cancel</DangerButton>
        </div>
      ),
    },
  ];

  return (
    <>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          <div className="qfa-quiet flex flex-col gap-3 p-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex gap-2">
              <StatusBadge value={`${summary.open_tasks} open`} tone="blue" />
              <StatusBadge value={`${summary.overdue_tasks} overdue`} tone={summary.overdue_tasks ? "rose" : "slate"} />
            </div>
            <Field label="Status filter">
              <SelectControl
                value={status ?? ""}
                options={["", ...VENDOR_TASK_STATUSES]}
                emptyLabel="All statuses"
                onChange={(value) => onFilterChange(value ? value as VendorTaskStatus : undefined)}
              />
            </Field>
          </div>
          {page.rows.length ? (
            <DataTable columns={columns} rows={page.rows} density="compact" getRowKey={(task) => task.id} emptyTitle="No tasks" emptyMessage="No tasks match this status." />
          ) : <EmptyState title="No tasks match" message={status ? `No ${humanize(status)} tasks are on this vendor account.` : "Create the first real follow-up task."} />}
          <Pagination page={page.page} pageSize={page.pageSize} total={page.total} noun="tasks" onPageChange={onPageChange} />
        </div>
        <TaskForm pending={pendingKey === "task-create"} onCreate={onCreate} />
      </div>

      {completeTarget ? (
        <CompletionDialog
          task={completeTarget}
          pending={pendingKey === `task-complete-${completeTarget.id}`}
          onCancel={() => setCompleteTarget(null)}
          onComplete={async (result) => {
            const ok = await onComplete(completeTarget.id, result);
            if (ok) setCompleteTarget(null);
          }}
        />
      ) : null}

      {cancelTarget ? (
        <ConfirmDialog
          title="Cancel task?"
          message={`“${cancelTarget.title}” will move to the cancelled lifecycle state. It will not be deleted.`}
          onCancel={() => setCancelTarget(null)}
          onConfirm={async () => {
            const target = cancelTarget;
            setCancelTarget(null);
            await onCancel(target.id);
          }}
        />
      ) : null}
    </>
  );
}

function TaskForm({
  pending,
  onCreate,
}: {
  pending: boolean;
  onCreate: (input: Record<string, unknown>) => Promise<boolean>;
}) {
  const empty = { task_type: "general", title: "", priority: "medium", due_at: "" };
  const [form, setForm] = useState(empty);
  return (
    <SectionCard title="Create task" description="Manual CRM follow-up" className="self-start xl:sticky xl:top-24">
      <div className="space-y-3">
        <Field label="Task type"><SelectControl value={form.task_type} options={VENDOR_TASK_TYPES} disabled={pending} onChange={(value) => setForm({ ...form, task_type: value })} /></Field>
        <Field label="Task"><input value={form.title} disabled={pending} onChange={(event) => setForm({ ...form, title: event.target.value })} className={controlClass} /></Field>
        <Field label="Priority"><SelectControl value={form.priority} options={VENDOR_TASK_PRIORITIES} disabled={pending} onChange={(value) => setForm({ ...form, priority: value })} /></Field>
        <Field label="Due date"><input type="date" value={form.due_at} disabled={pending} onChange={(event) => setForm({ ...form, due_at: event.target.value })} className={controlClass} /></Field>
        <PrimaryButton
          className="w-full"
          disabled={!form.title.trim() || pending}
          onClick={async () => {
            const ok = await onCreate({ ...form, due_at: form.due_at || null });
            if (ok) setForm(empty);
          }}
        >
          {pending ? "Creating…" : "Create task"}
        </PrimaryButton>
      </div>
    </SectionCard>
  );
}

function CompletionDialog({
  task,
  pending,
  onCancel,
  onComplete,
}: {
  task: VendorTask;
  pending: boolean;
  onCancel: () => void;
  onComplete: (result: string) => Promise<void>;
}) {
  const [result, setResult] = useState("");
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, pending]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 backdrop-blur-[2px]">
      <section role="dialog" aria-modal="true" aria-labelledby="task-completion-title" className="w-full max-w-lg rounded-[var(--qfa-radius-lg)] border border-[color:var(--qfa-line)] bg-white p-5 shadow-[var(--qfa-shadow-pop)]">
        <h2 id="task-completion-title" className="text-base font-semibold text-slate-950">Complete task</h2>
        <p className="mt-1 text-[13px] text-slate-500">{task.title}</p>
        <div className="mt-4">
          <Field label="Completion result" helper="Required. Record the real outcome before closing this task.">
            <textarea autoFocus value={result} disabled={pending} onChange={(event) => setResult(event.target.value)} className={textareaClass} />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <SecondaryButton disabled={pending} onClick={onCancel}>Keep open</SecondaryButton>
          <PrimaryButton disabled={!result.trim() || pending} onClick={() => onComplete(result.trim())}>
            {pending ? "Completing…" : "Complete task"}
          </PrimaryButton>
        </div>
      </section>
    </div>
  );
}

// -- Core context ------------------------------------------------------------

export function CoreContextTab({ core }: { core: VendorCoreFacts }) {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <CoreGroup
        title="Identity"
        rows={[
          ["Vendor ID", core.id],
          ["Business", core.business_name ?? "Not set"],
          ["Owner", core.owner_name ?? "Not set"],
          ["Phone", core.phone ?? "Not set"],
          ["Email", core.email ?? "Not set"],
        ]}
      />
      <CoreGroup
        title="Marketplace"
        rows={[
          ["City", core.city ?? "Not set"],
          ["Areas covered", listValue(core.areas_covered)],
          ["Full-city coverage", core.covers_full_city ? "Yes" : "No"],
          ["Categories", listValue(core.service_categories)],
        ]}
      />
      <CoreGroup
        title="Account"
        rows={[
          ["Verification", core.status ?? "Not set"],
          ["Enabled", enabledLabel(core.is_active)],
          ["Availability", availabilityLabel(core.accepting_leads)],
          ["Credits", `${core.remaining_credits ?? 0} remaining / ${core.total_credits ?? 0} total`],
          ["Last assigned", formatDate(core.last_assigned_at)],
          ["Created", formatDate(core.created_at)],
        ]}
      />
      <div className="xl:col-span-3">
        <NoteBar>
          Core Context is read-only. Vendor CRM provides no verification, enabled-state, availability, assignment, package, credit, consent, or communication controls.
        </NoteBar>
      </div>
    </div>
  );
}

function CoreGroup({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <SectionCard title={title} description="QuickFurno Core · read-only">
      <dl className="divide-y divide-[color:var(--qfa-line-soft)]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
            <dt className="shrink-0 text-[11px] font-semibold text-slate-500">{label}</dt>
            <dd className="min-w-0 break-words text-right text-[13px] font-medium text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </SectionCard>
  );
}
