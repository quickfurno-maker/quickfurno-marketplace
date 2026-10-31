// Prints the digest a DBA would record in aliases.json for the fixture alias.
import {canonicalStatementsDigest} from "../../rc37-migration-evidence-package.mjs";
console.log(canonicalStatementsDigest(["create index fix_gamma_idx on fix_alpha(id)"]));
