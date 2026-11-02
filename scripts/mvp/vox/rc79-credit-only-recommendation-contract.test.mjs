import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const src=readFileSync(resolve(root,"app/actions.ts"),"utf8");
test("actual admin recommendation signature cannot offer replacement or money",()=>{
 const section=src.split("export const adminRecommendBadLeadRecovery = async")[1]?.split("export const adminGenerateBadLeadRecoveryRecommendation")[0]??"";
 assert.match(section,/recommendation: "none" \| "restore_credit"/);
 assert.doesNotMatch(section,/recommendation:.*replace/);
 assert.match(section,/recommendation!=="none"&&recommendation!=="restore_credit"/);
 assert.ok(section.indexOf('recommendation!=="none"')<section.indexOf("recommendBadLeadRecovery(reportId,recommendation)"));
 assert.match(section,/rc44VerifiedBadLeadOwner\(actor\)/);
 assert.doesNotMatch(section,/wallet|cash_refund|money_credit|providerMessage/);
});
