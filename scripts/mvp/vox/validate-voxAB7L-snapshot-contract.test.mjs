import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("./validate-voxAB7L-archived-staging-schema-pg17.ps1",import.meta.url),"utf8");
test("AB7L uses a pinned, user-supplied local staging archive and isolated Supabase PG17",()=>{
 assert.match(source,/Parameter\(Mandatory=\$true\).*ArchivePath/);
 assert.match(source,/D88176856CDBEDE5FD31216E6217A388D64A95D137C728A0CB0DE0A605BDE71E/);
 assert.match(source,/supabase\/postgres@sha256:28f0e16a019e648089fc1a6d333549a55548f6019c15ae4bd7cd58b989027518/);
 assert.match(source,/--network none/);
 assert.doesNotMatch(source,/--publish|--port 5432|supabase\.co|STAGING_DATABASE_URL/i);
});
test("AB7L pg_restore never restores customer records or alters remote managed DB",()=>{
 assert.match(source,/--schema-only --no-owner --no-acl --exit-on-error/);
 assert.match(source,/count\(\*\) from auth\.users/);
 assert.match(source,/count\(\*\) from public\.aarohi_prospects/);
 assert.match(source,/docker rm -f \$name/);
 assert.doesNotMatch(source,/--data-only|--dbname\s+\$\{?.*URL|psql.*host=/i);
});
test("AB7L hard-fails for structural schema drift and unsafe VOX grants",()=>{
 for(const marker of [
 "2441|9353af8b65889b2a4ba5823e2d821a5d",
 "212|55c5ab92e50a8d5426c45b1b873a22a8",
 "75|5f45a978554dd40104eb1cf16f1960a3",
 "708|a948e7608a8aea7ec3dbdb80b7a17e6a",
 "1103|2426ec853fd70573f6be691feb9c0f3a",
 "74|1074f4271259203defff256380386a42",
 "39|39|0|0|0|2|0"
 ])assert.equal(source.includes(marker),true,marker);
 assert.match(source,/AB7L_OFFLINE_RLS_OR_PRIVILEGE_DRIFT/);
 assert.match(source,/AB7L_REAL_STAGING_SCHEMA_CANDIDATE_DDL_FAILED/);
});
