export function createN8nToolPlaceholder() {
  return {
    name: "n8nTool",
    enabled: false,
    canCallWebhook: false,
    description: "Placeholder only. No n8n webhook is called in Phase 1.",
    // TODO: Connect n8n only after signed webhook validation exists.
  };
}

