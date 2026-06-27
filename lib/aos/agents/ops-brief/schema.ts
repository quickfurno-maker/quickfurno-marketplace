export interface OpsBriefInput {
  window?: "today" | "week" | "month";
}

export interface OpsBriefOutput {
  briefMode: "mock-summary";
  highlights: string[];
}

