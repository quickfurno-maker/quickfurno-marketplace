"use client";

// ============================================================================
// QuickFurno — Phase 14C governance: Admin Categories manager (Superadmin only)
//
// Add / edit / activate / deactivate categories & subcategories. Talks ONLY to
// the admin-guarded /api/admin/categories* routes (which verify the admin
// session and use the service-role client server-side — never exposed here).
//
// Governance:
//   - SOFT delete only (Deactivate). No hard delete.
//   - Deactivating a parent with active subcategories prompts a confirm first.
//   - No duplicate names (enforced by the API).
//   - Public / vendor / client pages are read-only consumers (this manager is
//     the ONLY place categories are created/edited).
// ============================================================================
import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ActionMenu, DataTable, EmptyState, PrimaryButton, SecondaryButton, SectionCard, StatCard, StatusBadge } from "./AdminPrimitives";
import type { Category } from "./adminTypes";

type Notify = (message: string, tone?: "success" | "error" | "info") => void;

interface DraftState {
  mode: "add-category" | "add-subcategory" | "edit";
  target?: Category;
}

export function CategoryManager({ categories, notify }: { categories: Category[]; notify: Notify }) {
  const router = useRouter();
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [busy, setBusy] = useState(false);

  const parents = useMemo(() => categories.filter((c) => !c.parent_id), [categories]);
  const subcategories = useMemo(() => categories.filter((c) => c.parent_id), [categories]);
  const activeRows = useMemo(() => categories.filter((c) => c.is_active), [categories]);
  const inactiveRows = useMemo(() => categories.filter((c) => !c.is_active), [categories]);
  const parentNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name ?? ""])), [categories]);

  const refresh = useCallback(() => router.refresh(), [router]);

  const save = useCallback(
    async (url: string, body: Record<string, unknown>, successMsg: string) => {
      setBusy(true);
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (res.status === 403) {
          notify("Superadmin access is required to manage categories.", "error");
          return false;
        }
        if (!res.ok || !data?.ok) {
          notify(data?.error ?? "Action failed.", "error");
          return false;
        }
        notify(successMsg, "success");
        refresh();
        return true;
      } catch {
        notify("Action failed. Please try again.", "error");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [notify, refresh],
  );

  const toggleActive = useCallback(
    async (cat: Category) => {
      const next = !cat.is_active;
      setBusy(true);
      try {
        const call = (force: boolean) =>
          fetch(`/api/admin/categories/${cat.id}/active`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ isActive: next, force }),
          });
        let res = await call(false);
        let data = (await res.json()) as { ok?: boolean; error?: string; code?: string };
        if (res.status === 409 && data.code === "HAS_ACTIVE_SUBCATEGORIES") {
          if (!window.confirm(data.error ?? "This category has active subcategories. Deactivate anyway?")) return;
          res = await call(true);
          data = (await res.json()) as { ok?: boolean; error?: string; code?: string };
        }
        if (res.status === 403) {
          notify("Superadmin access is required.", "error");
          return;
        }
        if (!res.ok || !data?.ok) {
          notify(data?.error ?? "Could not update the category.", "error");
          return;
        }
        notify(next ? "Category activated." : "Category deactivated.", "success");
        refresh();
      } catch {
        notify("Could not update the category.", "error");
      } finally {
        setBusy(false);
      }
    },
    [notify, refresh],
  );

  function columns(showParent: boolean) {
    return [
      { header: "Category", cell: (item: Category) => <Strong title={item.name || "Unnamed"} subtitle={item.slug || item.id.slice(0, 8)} /> },
      { header: "Type", cell: (item: Category) => <StatusBadge value={item.parent_id ? "Subcategory" : "Parent"} tone={item.parent_id ? "blue" : "violet"} /> },
      ...(showParent ? [{ header: "Parent", cell: (item: Category) => (item.parent_id ? parentNameById.get(item.parent_id) ?? "—" : "—") }] : []),
      { header: "Status", cell: (item: Category) => <StatusBadge value={item.is_active ? "Active" : "Inactive"} tone={item.is_active ? "emerald" : "rose"} /> },
      {
        header: "Actions",
        cell: (item: Category) => (
          <ActionMenu
            actions={[
              { label: "Edit", onClick: () => setDraft({ mode: "edit", target: item }) },
              { label: item.is_active ? "Deactivate" : "Activate", onClick: () => void toggleActive(item) },
              ...(item.parent_id ? [] : [{ label: "Add subcategory", onClick: () => setDraft({ mode: "add-subcategory", target: item }) }]),
            ]}
          />
        ),
      },
    ];
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title="Categories & Subcategories"
        description="Admin-only source of truth. Public, vendor, and client pages are read-only consumers. Deactivate (soft delete) is preferred over deletion so old leads/vendors are never broken."
        action={
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={() => setDraft({ mode: "add-subcategory" })}>Add subcategory</SecondaryButton>
            <PrimaryButton onClick={() => setDraft({ mode: "add-category" })}>Add category</PrimaryButton>
          </div>
        }
      >
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Active" value={String(activeRows.length)} helper="Shown in dropdowns" icon="categories" tone="emerald" />
          <StatCard label="Inactive" value={String(inactiveRows.length)} helper="Hidden, kept for history" icon="categories" tone="rose" />
          <StatCard label="Parent categories" value={String(parents.length)} helper="Top-level" icon="categories" tone="indigo" />
          <StatCard label="Subcategories" value={String(subcategories.length)} helper="Nested" icon="reports" tone="slate" />
        </section>
      </SectionCard>

      <SectionCard title="Active categories" description="These appear in the Vendor Eligibility Checker, Vendors filter, and the client enquiry service picker.">
        {activeRows.length === 0 ? (
          <EmptyState title="No active categories" message="Add a category to populate the public/admin dropdowns." compact />
        ) : (
          <DataTable rows={activeRows} emptyTitle="No active categories" emptyMessage="" columns={columns(true)} />
        )}
      </SectionCard>

      <SectionCard title="Inactive categories" description="Soft-deleted. Kept so existing leads/vendors that reference them are never broken. Re-activate anytime.">
        {inactiveRows.length === 0 ? (
          <EmptyState title="No inactive categories" message="Deactivated categories will appear here." compact />
        ) : (
          <DataTable rows={inactiveRows} emptyTitle="No inactive categories" emptyMessage="" columns={columns(true)} />
        )}
      </SectionCard>

      {draft ? (
        <CategoryDraftModal
          draft={draft}
          parents={parents}
          busy={busy}
          onClose={() => setDraft(null)}
          onSubmit={async (name, parentId) => {
            let ok = false;
            if (draft.mode === "edit" && draft.target) {
              ok = await save(`/api/admin/categories/${draft.target.id}`, { name, parentId: parentId ?? null }, "Category updated.");
            } else {
              ok = await save(`/api/admin/categories`, { name, parentId: parentId ?? null }, draft.mode === "add-subcategory" ? "Subcategory added." : "Category added.");
            }
            if (ok) setDraft(null);
          }}
        />
      ) : null}
    </div>
  );
}

function CategoryDraftModal({
  draft,
  parents,
  busy,
  onClose,
  onSubmit,
}: {
  draft: DraftState;
  parents: Category[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string, parentId: string | null) => void;
}) {
  const isSub = draft.mode === "add-subcategory" || (draft.mode === "edit" && Boolean(draft.target?.parent_id));
  const [name, setName] = useState(draft.mode === "edit" ? draft.target?.name ?? "" : "");
  const [parentId, setParentId] = useState<string>(draft.target?.parent_id ?? (draft.mode === "add-subcategory" && draft.target ? draft.target.id : ""));

  const title = draft.mode === "edit" ? "Edit category" : draft.mode === "add-subcategory" ? "Add subcategory" : "Add category";
  const showParent = draft.mode === "add-subcategory" || (draft.mode === "edit");

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 px-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">Close</button>
        </div>
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase text-slate-500">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isSub ? "e.g. Modular Factory" : "e.g. Interior"}
              className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          {showParent ? (
            <label className="block">
              <span className="text-xs font-semibold uppercase text-slate-500">Parent category {draft.mode === "edit" ? "(optional)" : ""}</span>
              <select
                value={parentId}
                onChange={(e) => setParentId(e.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
              >
                <option value="">{draft.mode === "edit" ? "None (top-level category)" : "Select a parent…"}</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <p className="text-xs text-slate-500">No duplicate names. Categories are never hard-deleted — use Deactivate to hide one safely.</p>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
            <PrimaryButton onClick={() => { if (name.trim()) onSubmit(name.trim(), parentId || null); }}>{busy ? "Saving…" : "Save"}</PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Strong({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="min-w-44">
      <p className="font-semibold text-slate-950">{title}</p>
      {subtitle ? <p className="mt-1 text-xs text-slate-500">{subtitle}</p> : null}
    </div>
  );
}
