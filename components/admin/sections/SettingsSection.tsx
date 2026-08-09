"use client";

import { useEffect, useState } from "react";
import {
  adminUpdateMarketplaceRuntimeSetting,
} from "@/app/actions";
import {
  SectionCard,
  ToggleSwitch,
} from "../AdminPrimitives";
import { type Lead, type MarketplaceRuntimeSetting, type Snapshot, type Vendor } from "../adminTypes";

export type MarketplaceSettingsView = {
  show_free_vendors_publicly: boolean;
  allow_free_vendor_interest_capture: boolean;
  notify_free_vendor_recharge_interest: boolean;
  allow_trial_vendors_for_assignment: boolean;
  minimum_paid_vendors_required_for_auto_assignment: number;
  max_vendors_per_lead: number;
  auto_assignment_mode: "off" | "preview" | "auto_suggest";
};

export const marketplaceSettingDefaults: MarketplaceSettingsView = {
  show_free_vendors_publicly: true,
  allow_free_vendor_interest_capture: true,
  notify_free_vendor_recharge_interest: true,
  allow_trial_vendors_for_assignment: true,
  minimum_paid_vendors_required_for_auto_assignment: 1,
  max_vendors_per_lead: 3,
  auto_assignment_mode: "preview",
};


export function marketplaceSettingsObject(rows?: MarketplaceRuntimeSetting[]): MarketplaceSettingsView {
  const settings = { ...marketplaceSettingDefaults };
  (rows ?? []).forEach((row) => {
    const key = row.key as keyof MarketplaceSettingsView;
    if (!(key in settings)) return;
    const fallback = settings[key];
    if (typeof fallback === "boolean") {
      settings[key] = readBooleanValue(row.value, fallback) as never;
    } else if (typeof fallback === "number") {
      const value = Number(row.value);
      settings[key] = (Number.isFinite(value) ? value : fallback) as never;
    } else if (key === "auto_assignment_mode") {
      const value = String(row.value ?? "").trim();
      settings[key] = (value === "off" || value === "preview" || value === "auto_suggest" ? value : fallback) as never;
    }
  });
  return settings;
}


export function readBooleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return fallback;
}


export function MarketplaceRuntimeSettingsPanel({
  settingsRows,
  runAction,
}: {
  settingsRows: MarketplaceRuntimeSetting[];
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [settings, setSettings] = useState(() => marketplaceSettingsObject(settingsRows));
  useEffect(() => {
    setSettings(marketplaceSettingsObject(settingsRows));
  }, [settingsRows]);

  function save<K extends keyof MarketplaceSettingsView>(key: K, value: MarketplaceSettingsView[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
    runAction("Marketplace setting update", () => adminUpdateMarketplaceRuntimeSetting(key, value));
  }

  return (
    <SectionCard title="Paid-Only Auto Matching Controls" description="These switches separate public visibility from paid/trial lead assignment. Changes are stored in marketplace_runtime_settings.">
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="grid gap-3 md:grid-cols-2">
          <MarketplaceToggle
            label="Show approved free vendors publicly"
            checked={settings.show_free_vendors_publicly}
            onChange={(value) => save("show_free_vendors_publicly", value)}
          />
          <MarketplaceToggle
            label="Allow free vendor interest capture"
            checked={settings.allow_free_vendor_interest_capture}
            onChange={(value) => save("allow_free_vendor_interest_capture", value)}
          />
          <MarketplaceToggle
            label="Notify free vendor to recharge on interest"
            checked={settings.notify_free_vendor_recharge_interest}
            onChange={(value) => save("notify_free_vendor_recharge_interest", value)}
          />
          <MarketplaceToggle
            label="Allow trial vendors for assignment"
            checked={settings.allow_trial_vendors_for_assignment}
            onChange={(value) => save("allow_trial_vendors_for_assignment", value)}
          />
        </div>

        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Minimum paid vendors required</span>
            <input
              type="number"
              min={1}
              value={settings.minimum_paid_vendors_required_for_auto_assignment}
              onChange={(event) => save("minimum_paid_vendors_required_for_auto_assignment", Math.max(1, Number(event.target.value) || 1))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Max vendors per lead</span>
            <input
              type="number"
              min={1}
              max={3}
              value={settings.max_vendors_per_lead}
              onChange={(event) => save("max_vendors_per_lead", Math.max(1, Math.min(3, Number(event.target.value) || 1)))}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Auto assignment mode</span>
            <select
              value={settings.auto_assignment_mode}
              onChange={(event) => save("auto_assignment_mode", event.target.value as MarketplaceSettingsView["auto_assignment_mode"])}
              className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
            >
              <option value="off">off</option>
              <option value="preview">preview</option>
              <option value="auto_suggest">auto_suggest</option>
            </select>
          </label>
        </div>
      </div>
    </SectionCard>
  );
}

export function MarketplaceToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50/30"
      aria-pressed={checked}
    >
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <span className={`flex h-6 w-11 shrink-0 items-center rounded-full p-1 transition ${checked ? "bg-emerald-500" : "bg-slate-200"}`}>
        <span className={`h-4 w-4 rounded-full bg-white shadow transition ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

export function SettingsPage({
  data,
  notify,
  runAction,
}: {
  data: Snapshot;
  notify: (message: string) => void;
  runAction: (title: string, action: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const groups = ["Business Settings", "Lead Settings", "Vendor Settings", "Distribution Settings", "AI Settings", "Automation Settings", "Security Settings"];
  return (
    <div className="space-y-5">
      <MarketplaceRuntimeSettingsPanel settingsRows={data.marketplaceSettings ?? []} runAction={runAction} />
      <section className="grid gap-4 xl:grid-cols-2">
        {groups.map((group, index) => (
          <article key={group} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">{group}</h2>
                <p className="mt-2 text-sm text-slate-500">Global marketplace controls prepared for Supabase persistence.</p>
              </div>
              <ToggleSwitch checked={index < 4} />
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <input className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" placeholder="Setting key" />
              <input className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100" placeholder="Setting value" />
            </div>
            <button type="button" onClick={() => notify(`${group} save placeholder ready.`)} className="mt-4 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">Save</button>
          </article>
        ))}
      </section>
    </div>
  );
}
