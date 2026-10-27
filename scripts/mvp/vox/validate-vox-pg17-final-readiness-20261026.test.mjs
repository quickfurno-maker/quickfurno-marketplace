import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
for(const file of ["validate-voxPhaseB-nonce-pg17.ps1","validate-voxUI04-f1-pg17.ps1"]){
 test(file+" only runs disposable SQL tests after PostgreSQL final initialization",()=>{
  const source=readFileSync(resolve(root,"scripts/mvp/vox",file),"utf8");
  assert.match(source,/docker run --rm --network none/);
  assert.match(source,/PostgreSQL init process complete; ready for start up/);
  assert.match(source,/docker exec \$name pg_isready/);
  assert.match(source,/psql[^\n]+-c 'SELECT 1;'/);
  assert.match(source,/\$LASTEXITCODE -eq 0 -and \$probe -eq '1'/);
  assert.match(source,/docker rm -f \$name/);
 });
}
