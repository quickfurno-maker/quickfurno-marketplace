"use client";

export type FilterChipItem = {
  key: string;
  label: string;
};

export function FilterChips({
  chips,
  activeKeys,
  onToggle,
  className = "",
}: {
  chips: FilterChipItem[];
  activeKeys: string[];
  onToggle: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={`qf-filter-chips ${className}`} aria-label="Vendor filters">
      {chips.map((chip) => {
        const active = activeKeys.includes(chip.key);
        return (
          <button
            key={chip.key}
            type="button"
            className={`qf-filter-chip ${active ? "qf-filter-chip--active" : ""}`}
            aria-pressed={active}
            onClick={() => onToggle(chip.key)}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
