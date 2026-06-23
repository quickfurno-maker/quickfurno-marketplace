type IconName =
  | "home"
  | "pin"
  | "search"
  | "user"
  | "briefcase"
  | "grid"
  | "chat"
  | "more"
  | "shield"
  | "bolt"
  | "map"
  | "noFee"
  | "compare"
  | "request"
  | "hammer"
  | "kitchen"
  | "wardrobe"
  | "sofa"
  | "paint"
  | "ceiling"
  | "civil"
  | "plug"
  | "reno"
  | "pipe"
  | "floor"
  | "clock"
  | "lock"
  | "tag"
  | "star"
  | "arrow";

const paths: Record<IconName, string[]> = {
  home: ["M4 11.5 12 5l8 6.5", "M6.5 10.5V19h11v-8.5", "M10 19v-5h4v5"],
  pin: ["M12 21s6-5.3 6-10a6 6 0 0 0-12 0c0 4.7 6 10 6 10Z", "M12 12.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z"],
  search: ["M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z", "m16 16 4 4"],
  user: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M5 21a7 7 0 0 1 14 0"],
  briefcase: ["M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2", "M4 8h16v11H4Z", "M4 12h16"],
  grid: ["M4 4h6v6H4Z", "M14 4h6v6h-6Z", "M4 14h6v6H4Z", "M14 14h6v6h-6Z"],
  chat: ["M5 5h14v10H8l-3 4Z", "M8 9h8", "M8 12h5"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  shield: ["M12 3 19 6v5c0 4.4-2.8 7.7-7 10-4.2-2.3-7-5.6-7-10V6Z", "m9 12 2 2 4-5"],
  bolt: ["M13 2 5 13h6l-1 9 8-12h-6Z"],
  map: ["M9 18 4 20V6l5-2 6 2 5-2v14l-5 2-6-2Z", "M9 4v14", "M15 6v14"],
  noFee: ["M6 6h12v12H6Z", "m7 17 10-10", "M9 10h5a2 2 0 0 1 0 4h-2"],
  compare: ["M6 7h12", "M6 12h9", "M6 17h6", "M17 14l3 3-3 3"],
  request: ["M7 4h10v16H7Z", "M9 8h6", "M9 12h6", "M9 16h3"],
  hammer: ["M14 4 20 10", "M12 6l6 6", "M4 20l8-8", "M9 9l3-3"],
  kitchen: ["M5 5h14v14H5Z", "M5 10h14", "M9 5v14", "M14 14h2"],
  wardrobe: ["M6 4h12v16H6Z", "M12 4v16", "M9.5 12h.01", "M14.5 12h.01"],
  sofa: ["M5 12V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v3", "M4 12h16v6H4Z", "M7 18v2", "M17 18v2"],
  paint: ["M6 4h9l3 3-3 3H6Z", "M8 10v4a3 3 0 0 0 6 0v-1", "M11 17v4"],
  ceiling: ["M4 6h16", "M7 10h10", "M9 14h6", "M12 14v5"],
  civil: ["M5 19h14", "M7 19V9l5-4 5 4v10", "M9 19v-5h6v5"],
  plug: ["M9 3v6", "M15 3v6", "M7 9h10v3a5 5 0 0 1-10 0Z", "M12 17v4"],
  reno: ["M4 17 17 4l3 3L7 20H4Z", "M14 7l3 3"],
  pipe: ["M5 8h8a4 4 0 0 1 0 8h-1", "M5 8V5", "M5 8v3", "M12 16v3", "M12 16h-3"],
  floor: ["M4 5h16v14H4Z", "M4 12h16", "M10 5v14", "M16 5v14"],
  clock: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M12 7.5v5l3.2 2"],
  lock: ["M6 11h12v9H6Z", "M9 11V8a3 3 0 0 1 6 0v3", "M12 15v2"],
  tag: ["M4 4h7l9 9-7 7-9-9Z", "M8.4 8.4h.01"],
  star: ["M12 4l2.3 4.9 5.2.7-3.8 3.6 1 5.3-4.7-2.6-4.7 2.6 1-5.3L4.5 9.6l5.2-.7L12 4Z"],
  arrow: ["M5 12h14", "m13 6 6 6-6 6"],
};

export function QFIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
