// D-DB: pure, offline SQL content lint used by the release preflight. It never executes SQL and
// never returns SQL text: findings carry only a rule code and a short fixed detail string.
// Path-based pending classification can be dodged by renaming/copying a file, so these rules look at
// the bytes: P0-6 is_admin definitions, PUBLIC/anon grants, new functions that keep the implicit
// PUBLIC EXECUTE, SECURITY DEFINER without a pinned search_path, and destructive DDL.

const stripSql=t=>String(t).replace(/\/\*[\s\S]*?\*\//g,"").replace(/--[^\n]*/g,"").toLowerCase();
const ID='(?:"[^"]+"|[a-z_][a-z0-9_$]*)';
const QNAME=`(?:${ID}\\s*\\.\\s*)?(${ID})`;
const unq=s=>s.replace(/^"|"$/g,"");
const GRANTEE_PUBLIC=/(?:^|[\s,])(?:public|anon)(?=[\s,]|$)/;

/** @returns {{code:string,severity:"BLOCK"|"HOLD",detail:string}[]} */
export function lintSqlAcl(text){
 const src=stripSql(text),out=[];
 const add=(code,severity,detail)=>out.push({code,severity,detail});
 const stmts=src.split(";");

 // P0-6 content: any (re)definition or drop of is_admin(), whatever the file is named.
 const isAdmin=new RegExp(`\\b(?:create\\s+(?:or\\s+replace\\s+)?function|drop\\s+function(?:\\s+if\\s+exists)?)\\s+(?:${ID}\\s*\\.\\s*)?"?is_admin"?\\s*\\(`);
 if(isAdmin.test(src))add("P0_6_CONTENT","BLOCK","defines or drops is_admin(); review-only P0-6 surface");

 for(const st of stmts){
  const g=/^\s*grant\b[\s\S]*?\bto\b([\s\S]*)$/.exec(st);
  if(g&&GRANTEE_PUBLIC.test(g[1]))add("ACL_GRANT_TO_PUBLIC_OR_ANON","BLOCK","GRANT to PUBLIC or anon");
  if(/^\s*alter\s+default\s+privileges\b/.test(st))
   add("ACL_ALTER_DEFAULT_PRIVILEGES","BLOCK","ALTER DEFAULT PRIVILEGES widens future object ACLs");
 }

 // New functions default to PUBLIC EXECUTE unless revoked in the same file.
 const created=new Set();
 const fnRe=new RegExp(`\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${QNAME}\\s*\\(`,"g");
 for(let m;(m=fnRe.exec(src));){
  const name=unq(m[1]);created.add(name);
  const rest=src.slice(m.index),end=rest.search(/\$[a-z0-9_]*\$|\bas\s*'/);
  const hdr=end<0?rest:rest.slice(0,end);
  if(/\bsecurity\s+definer\b/.test(hdr)&&!/\bset\s+search_path\b/.test(hdr))
   add("SECDEF_WITHOUT_SEARCH_PATH","BLOCK",`SECURITY DEFINER function ${name} has no pinned search_path`);
 }
 const revoked=new Set();
 for(const st of stmts){
  const r=/^\s*revoke\b[\s\S]*?\bon\s+(?:function|routine)\s+([\s\S]*?)\bfrom\b([\s\S]*)$/.exec(st);
  if(!r||!GRANTEE_PUBLIC.test(r[2]))continue;
  const re=new RegExp(`${QNAME}\\s*\\(`,"g");
  for(let m;(m=re.exec(r[1]));)revoked.add(unq(m[1]));
 }
 for(const n of created)if(!revoked.has(n))
  add("FUNCTION_PUBLIC_EXECUTE_NOT_REVOKED","BLOCK",`function ${n} is created without REVOKE ... FROM PUBLIC in the same file`);

 // Irreversible DDL needs a pinned rollback file.
 if(/\b(?:drop\s+(?:table|column|schema|type|view)|truncate\b)|\balter\s+table\s+[^;]*\bdrop\s+column/.test(src))
  add("DESTRUCTIVE_DDL_NEEDS_ROLLBACK","HOLD","drops/truncates data objects; a pinned rollback file is required");
 return out;
}
