import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const page=readFileSync(new URL("../app/team/page.tsx",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/team/team.css",import.meta.url),"utf8");
test("Team Operations uses existing server BFF and current Core Auth checks",()=>{
 assert.match(page,/fetchStaffOverview\(\)/);
 assert.match(page,/fetchAdminStaffCapabilityCatalog\(\)/);
 assert.match(page,/if\(!overview\.ok\)/);
 assert.match(page,/admin\.ok\?/);
 assert.doesNotMatch(page,/getServerSideProps|localStorage|sessionStorage|createClient\(|signUp\(/);
});
test("no fictitious live agent sessions, counts, direct messaging or privileged actions",()=>{
 assert.match(page,/No synthetic metrics or conversations are displayed/);
 assert.match(page,/Riya Client Success/);
 assert.match(page,/Anisha Vendor Success/);
 assert.match(page,/Aarohi Acquisition/);
 assert.match(page,/AGNI \/ AOS/);
 assert.doesNotMatch(page,/onClick|fetch\(|sendMessage|href="https|provider\.send|button type="submit"/);
});
test("only truly implemented Core-protected destinations are clickable",()=>{
 assert.match(page,/href:"\/team\/work-queue"/);
 assert.match(page,/href="\/team\/admin\/staff"/);
 assert.match(page,/{"href" in w/);
 assert.match(page,/Actions disabled pending certification/);
 assert.match(page,/admin\.ok\?<section/);
});
test("responsive and keyboard accessible visual styling remains source-local",()=>{
 assert.match(css,/:focus-visible/);
 assert.match(css,/@media\(max-width:870px\)/);
 assert.match(css,/@media\(max-width:570px\)/);
});
