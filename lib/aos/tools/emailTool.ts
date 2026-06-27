export function createEmailToolPlaceholder() {
  return {
    name: "emailTool",
    enabled: false,
    canSend: false,
    description: "Placeholder only. This tool never sends email in Phase 1.",
    // TODO: Wire only after notification consent and templates are reviewed.
  };
}

