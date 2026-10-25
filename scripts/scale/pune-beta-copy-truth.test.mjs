import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Static source review only. This does not prove Production deployed these words
// or that customer-facing lead capture is safe to activate.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(resolve(root,p),"utf8");

test("homepage makes eligible-supply availability explicit", () => {
  const home=read("components/home/PuneLaunchHomepage.tsx");
  assert.match(home,/checks for eligible local professionals/);
  assert.match(home,/If suitable Teams\s+are available, you may be introduced to up to 3/);
  assert.match(home,/Check local availability/);
  assert.doesNotMatch(home,/Get matched with up to 3 verified Pune professionals/);
});
test("public enquiry page does not guarantee immediate matching", () => {
  const page=read("app/enquiry/page.tsx");
  assert.match(page,/checks local vendor availability/);
  assert.match(page,/if suitable teams are available/);
  assert.doesNotMatch(page,/QuickFurno matches you with up to 3 relevant eligible/);
});
test("legacy lead form does not guarantee 3 instant matches", () => {
  const form=read("components/LeadForm.tsx");
  assert.match(form,/We'll check availability before any vendor introductions/);
  assert.doesNotMatch(form,/will match you with 3 verified vendors shortly/);
  assert.match(form,/Check eligible vendor availability/);
});
test("public navigation and submit label communicate a request not a guarantee", () => {
  const header=read("components/Header.tsx"), footer=read("components/Footer.tsx");
  const modal=read("components/ClientEnquiryModal.tsx");
  assert.match(header,/Check availability/);
  assert.match(footer,/Check availability/);
  assert.match(modal,/Submitting….*Submit enquiry/);
});
test("lead consent and core matching authority are not changed by copy-only patch", () => {
  const form=read("components/LeadForm.tsx");
  const modal=read("components/ClientEnquiryModal.tsx");
  assert.match(form,/share_consent: shareConsent/);
  assert.match(modal,/share_consent: form.shareConsent/);
  assert.match(modal,/submitLead\(payload\)/);
});
