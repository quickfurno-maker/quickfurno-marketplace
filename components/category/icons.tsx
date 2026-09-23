// Stroke icons from the approved canvases. Inline SVG rather than an icon
// font or emoji: they inherit `currentColor`, so a chip on a dark band and the
// same chip on cream both get the right colour without a second definition.
//
// Every one is decorative — the text beside it carries the meaning — so they
// are aria-hidden and focusable={false}. An icon that is the ONLY content of a
// control gets an aria-label on the control, not here.

type IconProps = { size?: number; width?: number; className?: string };

function Svg({ size = 18, width = 2, className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export const IconCheck = (p: IconProps) => (
  <Svg {...p}><path d="m4.5 12.5 4.5 4.5 10.5-11" /></Svg>
);
export const IconPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s6.5-6.1 6.5-10.4A6.5 6.5 0 0 0 5.5 10.6C5.5 14.9 12 21 12 21Z" />
    <circle cx="12" cy="10.4" r="2.3" />
  </Svg>
);
export const IconArrow = (p: IconProps) => (
  <Svg {...p}><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></Svg>
);
export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 19 6v5.5c0 4.2-2.9 7.3-7 9-4.1-1.7-7-4.8-7-9V6Z" />
    <path d="m9 12 2 2 4-4.5" />
  </Svg>
);
export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="9" r="3" />
    <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 7.2a2.9 2.9 0 0 1 0 5.6" />
    <path d="M17.5 19c0-2-.7-3.6-1.9-4.6" />
  </Svg>
);
export const IconClock = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 1.8" /></Svg>
);
export const IconGrid = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16v14H4z" /><path d="M10 5v14" /><path d="M10 12h10" />
  </Svg>
);
export const IconFactory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 19h16" /><path d="m6 19 3-11 3 6 2-4 4 9" />
  </Svg>
);
export const IconSearch = (p: IconProps) => (
  <Svg {...p}><circle cx="11" cy="11" r="6.2" /><path d="m16 16 4 4" /></Svg>
);
export const IconStar = ({ size = 14, className }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
       aria-hidden="true" focusable="false" className={className}>
    <path d="m12 4.5 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L4.2 10.2l5.4-.8Z" />
  </svg>
);
export const IconChevron = (p: IconProps) => (
  <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>
);
export const IconBack = (p: IconProps) => (
  <Svg {...p}><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></Svg>
);
export const IconCalendar = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 6.5h15V20h-15z" /><path d="M4.5 10.5h15" />
    <path d="M8.5 4v3" /><path d="M15.5 4v3" />
  </Svg>
);

/** Business type → the icon that reads as that kind of operation. */
export function businessTypeIcon(type: string | null | undefined, size = 13) {
  const t = (type ?? "").toLowerCase();
  if (t.includes("factory")) return <IconFactory size={size} width={2.1} />;
  if (t.includes("showroom") || t.includes("studio")) return <IconGrid size={size} width={2.1} />;
  return <IconPin size={size} width={2.1} />;
}
