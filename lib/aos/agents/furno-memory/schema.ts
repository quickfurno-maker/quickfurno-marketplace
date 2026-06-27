export interface FurnoMemoryInput {
  namespace?: string;
}

export interface FurnoMemoryOutput {
  memoryMode: "mock-snapshot";
  entries: Record<string, unknown>;
}

