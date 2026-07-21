// ============================================================================
// QF-MVP-00 — Registers the minimal `.ts` resolution hook (tsResolveHooks.mjs)
// for the MVP test runner. Loaded via `node --import ./scripts/mvp/loader/register.mjs`.
//
// This registers ONLY a `resolve` hook. It adds NO transpiler, NO transform, and
// NO alias mapping — Node's own native type-stripping handles the `.ts` loading.
// See tsResolveHooks.mjs for the safety properties.
// ============================================================================
import { register } from 'node:module';

register('./tsResolveHooks.mjs', import.meta.url);
