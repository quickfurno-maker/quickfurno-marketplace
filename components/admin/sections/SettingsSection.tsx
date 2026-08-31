"use client";

import { useEffect, useState } from "react";
import {
  adminUpdateMarketplaceRuntimeSetting,
} from "@/app/actions";
import {
  SectionCard,
  StatusBadge,
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
  // QF-MVP-80.04 — mirrors the canonical server default in
  // lib/lead-assignment/runtimeSettings. If the row is absent the server
  // resolves "off", so showing "preview" here would tell the operator the
  // marketplace is in a mutating mode it is not actually in.
  auto_assignment_mode: "off",
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

        <div className="grid gap-3 qfa-quiet p-3">
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Minimum paid vendors required</span>
            <input
              type="number"
              min={1}
              value={settings.minimum_paid_vendors_required_for_auto_assignment}
              onChange={(event) => save("minimum_paid_vendors_required_for_auto_assignment", Math.max(1, Number(event.target.value) || 1))}
              className="qfa-control px-2.5 font-semibold outline-none"
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
              className="qfa-control px-2.5 font-semibold outline-none"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-xs font-semibold uppercase text-slate-500">Auto assignment mode</span>
            <select
              value={settings.auto_assignment_mode}
              onChange={(event) => save("auto_assignment_mode", event.target.value as MarketplaceSettingsView["auto_assignment_mode"])}
              className="qfa-control px-2.5 font-semibold outline-none"
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
      className="flex items-center justify-between gap-4 qfa-panel p-3 text-left transition-colors hover:border-[color:var(--qfa-line-strong)]"
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
    <div className="space-y-4">
      <MarketplaceRuntimeSettingsPanel settingsRows={data.marketplaceSettings ?? []} runAction={runAction} />

      {/* This grid used to render seven "settings groups", each with an enable
          switch driven by `index < 4`, two inert key/value inputs bound to
          nothing, and a Save button that only fired a toast reading
          "<group> save placeholder ready." Nothing was ever written. The real,
          persisted controls are in the runtime settings panel above; this is
          now a scope list stating plainly that these groups are not built. */}
      <SectionCard
        title="Planned settings groups"
        description="Not implemented. Only the marketplace runtime settings above are stored and applied."
      >
        <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <li key={group} className="flex items-center justify-between gap-2 text-[13px] text-slate-700">
              <span className="min-w-0 truncate">{group}</span>
              <StatusBadge value="Not built" tone="slate" />
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
