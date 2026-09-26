import { useMemo, useState } from "react";
import { adminCreatePackage, adminUpdatePackage } from "@/app/actions";
import { type Category, type City, type PackageRow } from "../adminTypes";
import { PrimaryButton, SecondaryButton } from "../AdminPrimitives";
import { ModalShell } from "./shared";

type RunAction = (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;

type Draft = {
  name: string;
  lead_count: string;
  total_price: string;
  validity_days: string;
  description: string;
  sort_order: string;
  is_active: boolean;
  category_ids: string[];
  city_ids: string[];
};

function initialDraft(item?: PackageRow | null): Draft {
  return {
    name: item?.name ?? "",
    lead_count: String(item?.lead_count ?? 0),
    total_price: String(item?.total_price ?? item?.display_price ?? 0),
    validity_days: String(item?.validity_days ?? 30),
    description: item?.description ?? "",
    sort_order: String(item?.sort_order ?? 100),
    is_active: item?.is_active !== false,
    category_ids: item?.category_ids ?? [],
    city_ids: item?.city_ids ?? [],
  };
}function toggle(list: string[], id: string) {
  return list.includes(id) ? list.filter((value) => value !== id) : [...list, id];
}

export function PackageEditorModal({ item, categories, cities, runAction, onClose }: {
  item?: PackageRow | null;
  categories: Category[];
  cities: City[];
  runAction: RunAction;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(item));
  const parentById = useMemo(() => new Map(categories.map((row) => [row.id, row])), [categories]);
  const orderedCategories = useMemo(() => [...categories].sort((a, b) => {
    const aParent = a.parent_id ? parentById.get(a.parent_id)?.name ?? "" : a.name ?? "";
    const bParent = b.parent_id ? parentById.get(b.parent_id)?.name ?? "" : b.name ?? "";
    return aParent.localeCompare(bParent) || Number(a.sort_order ?? 100) - Number(b.sort_order ?? 100) || String(a.name ?? "").localeCompare(String(b.name ?? ""));
  }), [categories, parentById]);

  const save = () => {
    const input = {
      name: draft.name.trim(),
      lead_count: Number(draft.lead_count),
      total_price: Number(draft.total_price),
      validity_days: Number(draft.validity_days),
      description: draft.description.trim() || null,
      sort_order: Number(draft.sort_order),
      is_active: draft.is_active,
      category_ids: draft.category_ids,
      city_ids: draft.city_ids,
    };
    runAction(item ? "Package updated" : "Package created", () => item ? adminUpdatePackage(item.id, input) : adminCreatePackage(input));
    onClose();
  };
  return (
    <ModalShell
      title={item ? "Edit package" : "Create package"}
      subtitle="Commercial package configuration. Empty scope means all active rows in that dimension."
      onClose={onClose}
    >
      <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Package name" value={draft.name} onChange={(value) => setDraft((d) => ({ ...d, name: value }))} />
          <Field label="Lead credits" type="number" min="1" value={draft.lead_count} onChange={(value) => setDraft((d) => ({ ...d, lead_count: value }))} />
          <Field label="Total price (INR)" type="number" min="0" step="0.01" value={draft.total_price} onChange={(value) => setDraft((d) => ({ ...d, total_price: value }))} />
          <Field label="Validity (days)" type="number" min="1" value={draft.validity_days} onChange={(value) => setDraft((d) => ({ ...d, validity_days: value }))} />
          <Field label="Sort order" type="number" min="0" value={draft.sort_order} onChange={(value) => setDraft((d) => ({ ...d, sort_order: value }))} />
          <label className="grid gap-1 text-sm font-medium text-slate-700">
            <span>Status</span>
            <select value={draft.is_active ? "active" : "inactive"} onChange={(event) => setDraft((d) => ({ ...d, is_active: event.target.value === "active" }))} className="qfa-control min-h-10 rounded-lg border border-slate-200 px-3">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1 text-sm font-medium text-slate-700">
          <span>Description</span>
          <textarea value={draft.description} onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))} rows={3} className="qfa-control rounded-lg border border-slate-200 px-3 py-2" placeholder="Optional package description" />
        </label>
        <ScopeSection title="Category / subcategory scope" allLabel="All active categories" isGlobal={draft.category_ids.length === 0} onAll={() => setDraft((d) => ({ ...d, category_ids: [] }))}>
          {orderedCategories.map((category) => {
            const parent = category.parent_id ? parentById.get(category.parent_id) : null;
            const label = parent ? `${parent.name ?? "Parent"} / ${category.name ?? "Subcategory"}` : category.name ?? "Unnamed category";
            return (
              <ScopeCheck
                key={category.id}
                label={label}
                inactive={category.is_active === false}
                checked={draft.category_ids.includes(category.id)}
                onChange={() => setDraft((d) => ({ ...d, category_ids: toggle(d.category_ids, category.id) }))}
              />
            );
          })}
        </ScopeSection>

        <ScopeSection title="City scope" allLabel="All active cities" isGlobal={draft.city_ids.length === 0} onAll={() => setDraft((d) => ({ ...d, city_ids: [] }))}>
          {cities.map((city) => (
            <ScopeCheck
              key={city.id}
              label={[city.name, city.state].filter(Boolean).join(", ") || "Unnamed city"}
              inactive={city.is_active === false}
              checked={draft.city_ids.includes(city.id)}
              onChange={() => setDraft((d) => ({ ...d, city_ids: toggle(d.city_ids, city.id) }))}
            />
          ))}
        </ScopeSection>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <SecondaryButton onClick={onClose}>Cancel</SecondaryButton>
          <PrimaryButton onClick={save}>{item ? "Save changes" : "Create package"}</PrimaryButton>
        </div>
      </div>
    </ModalShell>
  );
}
function Field({ label, value, onChange, type = "text", min, step }: { label: string; value: string; onChange: (value: string) => void; type?: string; min?: string; step?: string }) {
  return (
    <label className="grid gap-1 text-sm font-medium text-slate-700">
      <span>{label}</span>
      <input type={type} min={min} step={step} value={value} onChange={(event) => onChange(event.target.value)} className="qfa-control min-h-10 rounded-lg border border-slate-200 px-3" />
    </label>
  );
}

function ScopeSection({ title, allLabel, isGlobal, onAll, children }: { title: string; allLabel: string; isGlobal: boolean; onAll: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{isGlobal ? allLabel : "Selected scope only"}</p>
        </div>
        <button type="button" onClick={onAll} className="qfa-focus rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600">Use all</button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function ScopeCheck({ label, checked, inactive, onChange }: { label: string; checked: boolean; inactive: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-100 px-2.5 py-2 text-sm text-slate-700">
      <input type="checkbox" checked={checked} onChange={onChange} className="mt-0.5" />
      <span>{label}{inactive ? <span className="ml-1 text-xs text-amber-600">(inactive)</span> : null}</span>
    </label>
  );
}
