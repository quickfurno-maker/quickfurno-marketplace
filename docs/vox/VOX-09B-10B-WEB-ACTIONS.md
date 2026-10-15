# VOX-09B / VOX-10B staff interaction source integration

VOX Vendor 360 now has an internal Vendor CRM task creation form, shown only when `VOX_VENDOR_TASK_UI_ENABLED=staging`. The browser POSTs **only to same-origin VOX BFF**; Core bearer tokens and service-role keys are never exposed. A verified session and `VOX_STAFF_PORTAL_ENABLED=staging` plus `VOX_STAFF_VIEW_MODE=scoped` are required before proxying to the new default-OFF Core vendor-task boundary (#217). Native Core Vendor CRM is the only task writer; UI fields are whitelist-constrained, actor and city/vendor permission checked by Core, no finance/vendor/protocol changes possible.

VOX adds `/studio` read-only simulation page backed by Core's actual native `/api/vox/v1/studio-simulate` (#218), requiring a separate `VOX_STUDIO_WEB_ENABLED=staging` and AAL2 staff session. It labels source as DEFAULT native definition, **not live** workflow. It has no publish/mutation buttons or direct provider access. Fail-closed no-data hold pages remain default.

This is source-only UI and BFF integration. No real Staging user has tested a task write; Core staff grant tables and auth are still unapplied. The native Studio editor and full CRM/WhatsApp transactions are not complete. External Team Leader onboarding remains deferred.
