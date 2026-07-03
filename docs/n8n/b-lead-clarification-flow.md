# B-Lead Clarification Flow

Phase 1.5 adds a preview-only route for B leads:

`lead.clarification_required`

Workflow name:

`QF-n8n-B-Lead-Clarification-Preview`

n8n branch behavior:

- Prepare WhatsApp clarification preview only.
- `safePreviewOnly = true`
- `whatsappSent = false`
- `databaseWritten = false`
- `creditsDeducted = false`
- `leadAutoAssigned = false`
- `vendorNotified = false`
- `externalApiCalled = false`

QuickFurno remains the source of truth. n8n must not update lead fields, assign vendors, deduct credits, or send WhatsApp messages in this phase.

Expected safe payload fields:

- `eventType`
- `leadId`
- `scoreClass`
- `score`
- `missingFields`
- `parentCategoryGroup`
- `marketplaceCategory`
- `serviceRequired`
- `previewMessage`
- `questionsCount`
- `source`
