export function createSupabaseToolPlaceholder() {
  return {
    name: "supabaseTool",
    enabled: false,
    canWrite: false,
    description: "Placeholder only. No Supabase reads or writes are performed in Phase 1.",
    // TODO: Add approved read-only queries before any write capability.
  };
}

