"use client";
// ============================================================================
// QF-MVP-30.2 — combined Vendor CRM profile (admin-only, client shell).
// Core facts are displayed READ-ONLY (no edit control); CRM enrichment/contacts/
// tags/notes/tasks are editable via server actions. Notes are append-only (no
// edit/delete control). No package/credit/verification editing here. All writes
// go through authorized server actions — no service-role code runs in the browser.
// ============================================================================

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, SectionCard, Tabs, InfoGrid, DataTable, StatusBadge, PrimaryButton, SecondaryButton, EmptyState } from "../AdminPrimitives";
import {
  crmUpsertProfile, crmCreateContact, crmArchiveContact, crmCreateTag, crmAssignTag, crmRemoveTag,
  crmCreateNote, crmCreateTask, crmCompleteTask, crmCancelTask,
} from "@/app/actions/vendorCrmActions";
import {
  VENDOR_CRM_ONBOARDING_STAGES, VENDOR_CRM_RELATIONSHIP_STATUSES, VENDOR_CONTACT_CHANNELS,
  VENDOR_NOTE_CATEGORIES, VENDOR_TASK_TYPES, VENDOR_TASK_PRIORITIES,
} from "@/lib/crm/vendorCrmContracts";

const TABS = ["Overview", "Contacts", "Tags", "Notes", "Tasks", "Core context"] as const;

export function VendorCrmProfile(props: {
  vendorId: string;
  core: any; profile: any; contacts: any[]; tagAssignments: any[]; allTags: any[]; notes: any[]; tasks: any[];
  error: string | null;
}) {
  const { vendorId, core } = props;
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function act(p: Promise<{ ok: true } | { ok: false; error: string }>) {
    setMsg(null);
    start(async () => {
      const r = await p;
      if (!r.ok) setMsg(r.error ?? "Action failed.");
      else router.refresh();
    });
  }

  if (props.error) return <EmptyState title="Could not load vendor" message={props.error} />;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={core?.business_name || "Vendor"}
        description="Combined Core + CRM vendor profile. Core facts are read-only; CRM enrichment is editable. Founder/admin only."
        meta={<><StatusBadge value={core?.status ?? "—"} /><StatusBadge value={core?.is_active === false ? "Disabled" : "Active"} /></>}
        actions={<a href="/admin/vendor-crm" className="text-sm font-semibold text-emerald-700 hover:underline">← Directory</a>}
      />
      <Tabs tabs={[...TABS]} active={tab} onChange={(t) => setTab(t as any)} />
      {msg ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{msg}</div> : null}
      <div aria-busy={pending}>
        {tab === "Overview" && <Overview core={core} profile={props.profile} onSave={(input) => act(crmUpsertProfile(vendorId, input))} />}
        {tab === "Contacts" && <Contacts contacts={props.contacts} onCreate={(i) => act(crmCreateContact(vendorId, i))} onArchive={(id) => act(crmArchiveContact(vendorId, id))} />}
        {tab === "Tags" && <TagsTab assignments={props.tagAssignments} allTags={props.allTags} onAssign={(tagId) => act(crmAssignTag(vendorId, tagId))} onRemove={(tagId) => act(crmRemoveTag(vendorId, tagId))} onCreate={(i) => act(crmCreateTag(i))} />}
        {tab === "Notes" && <NotesTab notes={props.notes} onCreate={(i) => act(crmCreateNote(vendorId, i))} />}
        {tab === "Tasks" && <TasksTab tasks={props.tasks} onCreate={(i) => act(crmCreateTask(vendorId, i))} onComplete={(id, r) => act(crmCompleteTask(vendorId, id, r))} onCancel={(id) => act(crmCancelTask(vendorId, id))} />}
        {tab === "Core context" && <CoreContext core={core} />}
      </div>
    </div>
  );
}

// -- Overview: Core read-only + CRM profile edit ------------------------------
function Overview({ core, profile, onSave }: { core: any; profile: any; onSave: (i: Record<string, unknown>) => void }) {
  const [f, setF] = useState({
    onboarding_stage: profile?.onboarding_stage ?? "new",
    relationship_status: profile?.relationship_status ?? "prospect",
    next_follow_up_at: profile?.next_follow_up_at?.slice(0, 10) ?? "",
    company_type: profile?.company_type ?? "",
    budget_band: profile?.budget_band ?? "",
    residential_commercial_scope: profile?.residential_commercial_scope ?? "",
    capability_notes: profile?.capability_notes ?? "",
    campaign_notes: profile?.campaign_notes ?? "",
  });
  const set = (k: string, v: string) => setF({ ...f, [k]: v });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Core identity (read-only)" description="Owned by QuickFurno Core — not editable here.">
        <div className="px-5 py-4">
          <InfoGrid rows={[
            ["Business", core?.business_name ?? "—"], ["Owner", core?.owner_name ?? "—"], ["Phone", core?.phone ?? "—"],
            ["City", core?.city ?? "—"], ["Categories", (core?.service_categories ?? []).join(", ") || "—"],
            ["Verification", <StatusBadge key="v" value={core?.status ?? "—"} />], ["Enabled", core?.is_active === false ? "Disabled" : "Active"],
          ]} />
        </div>
      </SectionCard>
      <SectionCard title="CRM relationship" description="CRM-owned enrichment.">
        <div className="flex flex-col gap-3 px-5 py-4">
          <Field label="Onboarding stage"><Select value={f.onboarding_stage} options={[...VENDOR_CRM_ONBOARDING_STAGES]} onChange={(v) => set("onboarding_stage", v)} /></Field>
          <Field label="Relationship status"><Select value={f.relationship_status} options={[...VENDOR_CRM_RELATIONSHIP_STATUSES]} onChange={(v) => set("relationship_status", v)} /></Field>
          <Field label="Next follow-up"><input type="date" value={f.next_follow_up_at} onChange={(e) => set("next_follow_up_at", e.target.value)} className={inp} /></Field>
          <Field label="Company type"><input value={f.company_type} onChange={(e) => set("company_type", e.target.value)} className={inp} /></Field>
          <Field label="Budget band"><input value={f.budget_band} onChange={(e) => set("budget_band", e.target.value)} className={inp} /></Field>
          <Field label="Scope"><Select value={f.residential_commercial_scope || ""} options={["", "residential", "commercial", "both"]} onChange={(v) => set("residential_commercial_scope", v)} /></Field>
          <Field label="Capability notes"><textarea value={f.capability_notes} onChange={(e) => set("capability_notes", e.target.value)} className={inp} rows={2} /></Field>
          <Field label="Campaign notes"><textarea value={f.campaign_notes} onChange={(e) => set("campaign_notes", e.target.value)} className={inp} rows={2} /></Field>
          <PrimaryButton onClick={() => onSave({ ...f, next_follow_up_at: f.next_follow_up_at || null, residential_commercial_scope: f.residential_commercial_scope || null })}>Save relationship</PrimaryButton>
        </div>
      </SectionCard>
    </div>
  );
}

// -- Contacts -----------------------------------------------------------------
function Contacts({ contacts, onCreate, onArchive }: { contacts: any[]; onCreate: (i: Record<string, unknown>) => void; onArchive: (id: string) => void }) {
  const [f, setF] = useState({ name: "", role_title: "", phone: "", email: "", preferred_channel: "", is_primary: false });
  const active = contacts.filter((c) => c.is_active !== false);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Contacts" description="Private CRM contacts. A CRM contact does NOT grant communication consent — Core owns consent.">
        {active.length === 0 ? <div className="px-5 py-6"><EmptyState compact title="No contacts" message="Add the first decision-maker contact." /></div> :
          <DataTable columns={[
            { header: "Name", cell: (c: any) => <span className="font-medium">{c.name}{c.is_primary ? <StatusBadge value="Primary" /> : null}</span> },
            { header: "Role", cell: (c: any) => c.role_title ?? "—" },
            { header: "Phone", cell: (c: any) => c.phone ?? "—" },
            { header: "Email", cell: (c: any) => c.email ?? "—" },
            { header: "", cell: (c: any) => <SecondaryButton onClick={() => onArchive(c.id)}>Archive</SecondaryButton> },
          ]} rows={active} emptyTitle="No contacts" emptyMessage="" />}
      </SectionCard>
      <SectionCard title="Add contact">
        <div className="flex flex-col gap-3 px-5 py-4">
          <Field label="Name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={inp} /></Field>
          <Field label="Role/title"><input value={f.role_title} onChange={(e) => setF({ ...f, role_title: e.target.value })} className={inp} /></Field>
          <Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} className={inp} /></Field>
          <Field label="Email"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className={inp} /></Field>
          <Field label="Preferred channel"><Select value={f.preferred_channel} options={["", ...VENDOR_CONTACT_CHANNELS]} onChange={(v) => setF({ ...f, preferred_channel: v })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_primary} onChange={(e) => setF({ ...f, is_primary: e.target.checked })} /> Primary contact</label>
          <PrimaryButton onClick={() => onCreate({ ...f, preferred_channel: f.preferred_channel || null })}>Add contact</PrimaryButton>
        </div>
      </SectionCard>
    </div>
  );
}

// -- Tags ---------------------------------------------------------------------
function TagsTab({ assignments, allTags, onAssign, onRemove, onCreate }: { assignments: any[]; allTags: any[]; onAssign: (id: string) => void; onRemove: (id: string) => void; onCreate: (i: Record<string, unknown>) => void }) {
  const [name, setName] = useState("");
  const [pick, setPick] = useState("");
  const assignedTagIds = new Set(assignments.map((a) => a.tag_id));
  const available = allTags.filter((t) => t.is_active !== false && !assignedTagIds.has(t.id));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Assigned tags">
        <div className="flex flex-wrap gap-2 px-5 py-4">
          {assignments.length === 0 ? <span className="text-sm text-slate-400">No tags assigned.</span> :
            assignments.map((a) => <button key={a.id} onClick={() => onRemove(a.tag_id)} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs hover:border-rose-300 hover:text-rose-600">{a.vendor_tags?.name ?? "tag"} ✕</button>)}
        </div>
        <div className="flex items-end gap-2 border-t border-slate-100 px-5 py-4">
          <Field label="Assign existing"><Select value={pick} options={["", ...available.map((t) => t.name)]} onChange={setPick} /></Field>
          <PrimaryButton onClick={() => { const t = available.find((x) => x.name === pick); if (t) onAssign(t.id); }}>Assign</PrimaryButton>
        </div>
      </SectionCard>
      <SectionCard title="Create tag" description="Normalized name is generated server-side to prevent duplicates.">
        <div className="flex items-end gap-2 px-5 py-4">
          <Field label="Tag name"><input value={name} onChange={(e) => setName(e.target.value)} className={inp} /></Field>
          <PrimaryButton onClick={() => { if (name.trim()) { onCreate({ name }); setName(""); } }}>Create</PrimaryButton>
        </div>
      </SectionCard>
    </div>
  );
}

// -- Notes (append-only: no edit/delete control) ------------------------------
function NotesTab({ notes, onCreate }: { notes: any[]; onCreate: (i: Record<string, unknown>) => void }) {
  const [body, setBody] = useState(""); const [cat, setCat] = useState("general");
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Notes" description="Append-only — notes cannot be edited or deleted; add a new note to correct.">
        <div className="flex flex-col gap-3 px-5 py-4">
          {notes.length === 0 ? <EmptyState compact title="No notes" message="Add the first note." /> :
            notes.map((n) => (
              <div key={n.id} className="rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-3">
                <div className="mb-1 flex items-center gap-2"><StatusBadge value={n.category ?? "general"} /><span className="text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</span></div>
                <p className="whitespace-pre-wrap text-sm text-slate-700">{n.note}</p>
              </div>
            ))}
        </div>
      </SectionCard>
      <SectionCard title="Add note">
        <div className="flex flex-col gap-3 px-5 py-4">
          <Field label="Category"><Select value={cat} options={[...VENDOR_NOTE_CATEGORIES]} onChange={setCat} /></Field>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} className={inp} rows={4} placeholder="Note…" />
          <PrimaryButton onClick={() => { if (body.trim()) { onCreate({ note: body, category: cat }); setBody(""); } }}>Add note</PrimaryButton>
        </div>
      </SectionCard>
    </div>
  );
}

// -- Tasks --------------------------------------------------------------------
function TasksTab({ tasks, onCreate, onComplete, onCancel }: { tasks: any[]; onCreate: (i: Record<string, unknown>) => void; onComplete: (id: string, r: string) => void; onCancel: (id: string) => void }) {
  const [f, setF] = useState({ task_type: "general", title: "", priority: "medium", due_at: "" });
  const now = Date.now();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionCard title="Tasks">
        {tasks.length === 0 ? <div className="px-5 py-6"><EmptyState compact title="No tasks" message="Create the first follow-up task." /></div> :
          <DataTable columns={[
            { header: "Task", cell: (t: any) => <span className="font-medium">{t.title}<span className="block text-xs text-slate-400">{t.task_type}</span></span> },
            { header: "Priority", cell: (t: any) => <StatusBadge value={t.priority} /> },
            { header: "Status", cell: (t: any) => <StatusBadge value={t.status} /> },
            { header: "Due", cell: (t: any) => <span className={t.due_at && Date.parse(t.due_at) < now && !["done", "cancelled"].includes(t.status) ? "text-rose-600 font-semibold" : "text-slate-600"}>{t.due_at ? new Date(t.due_at).toLocaleDateString() : "—"}</span> },
            { header: "", cell: (t: any) => ["done", "cancelled"].includes(t.status) ? <span className="text-xs text-slate-300">—</span> : (
              <div className="flex gap-1">
                <SecondaryButton onClick={() => { const r = window.prompt("Completion result?"); if (r) onComplete(t.id, r); }}>Done</SecondaryButton>
                <SecondaryButton onClick={() => onCancel(t.id)}>Cancel</SecondaryButton>
              </div>
            ) },
          ]} rows={tasks} emptyTitle="No tasks" emptyMessage="" />}
      </SectionCard>
      <SectionCard title="Add task">
        <div className="flex flex-col gap-3 px-5 py-4">
          <Field label="Type"><Select value={f.task_type} options={[...VENDOR_TASK_TYPES]} onChange={(v) => setF({ ...f, task_type: v })} /></Field>
          <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={inp} /></Field>
          <Field label="Priority"><Select value={f.priority} options={[...VENDOR_TASK_PRIORITIES]} onChange={(v) => setF({ ...f, priority: v })} /></Field>
          <Field label="Due date"><input type="date" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} className={inp} /></Field>
          <PrimaryButton onClick={() => { if (f.title.trim()) { onCreate({ ...f, due_at: f.due_at || null }); setF({ task_type: "general", title: "", priority: "medium", due_at: "" }); } }}>Add task</PrimaryButton>
        </div>
      </SectionCard>
    </div>
  );
}

// -- Core context (read-only) -------------------------------------------------
function CoreContext({ core }: { core: any }) {
  return (
    <SectionCard title="Core context (read-only)" description="Package, credits, leads and communication remain owned by QuickFurno Core / Marketplace admin. Vendor CRM never edits these.">
      <div className="px-5 py-4">
        <InfoGrid rows={[
          ["Credits", `${core?.remaining_credits ?? 0} remaining / ${core?.total_credits ?? 0} total`],
          ["Verification", <StatusBadge key="v" value={core?.status ?? "—"} />],
          ["Enabled", core?.is_active === false ? "Disabled" : "Active"],
          ["Service areas", (core?.areas_covered ?? []).join(", ") || (core?.covers_full_city ? "Full city" : "—")],
          ["Last assigned", core?.last_assigned_at ? new Date(core.last_assigned_at).toLocaleString() : "—"],
          ["Package / leads / consent", "Managed in Marketplace admin (Core-owned, read-only here)"],
        ]} />
      </div>
    </SectionCard>
  );
}

// -- primitives ---------------------------------------------------------------
const inp = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-400";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500"><span>{label}</span>{children}</label>;
}
function Select({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} className={inp}>{options.map((o) => <option key={o} value={o}>{o || "—"}</option>)}</select>;
}
