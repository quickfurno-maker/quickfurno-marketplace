// RC4 Track E release pins. SOURCE-ONLY constants; a human release owner edits them in review.
// Every null below is an UNPINNED input and makes the plan HOLD. Nothing here authorizes SQL execution.
const deep=o=>{
 if(o&&typeof o==="object"&&!Object.isFrozen(o)){Object.values(o).forEach(deep);Object.freeze(o)}
 return o;
};
export const RC4_PINS=deep({
 schema:"qf.vox.rc4.release-pins.v1",
 // Verified RC3 base (PR #446 draft). The CLI compares the head SHA it is given against this.
 rc3BaseSha:"f5dd7e4824f66e6b28039606e055ae3e2ca7cfb6",
 stagingProjectRef:"uckafzuochmbvtiodmcl",
 // Last read-only Staging ledger observation on record (RC2 packet). Any other live value is DRIFT.
 stagingLedger:{appliedCount:86,latestVersion:"20261013144901"},
 // The reviewed 7 quarantined + 23 candidate set. The digest is copied from the committed fingerprint
 // so replacing the fingerprint JSON together with the SQL is still detected.
 source30:{
  fingerprintPath:"docs/vox/VOX-AB7K-REVIEWED-SOURCE-FINGERPRINT.json",
  manifestDigest:"3ae02af58c07e256507532b866594486d2785e768fd4092a1b1aa8db572f8f60",
  quarantined:{dir:"ops/vox/quarantined-migrations/legacy-20261014",count:7},
  candidates:{dir:"ops/vox/sql-candidates",count:23}
 },
 // PR #435 P0-6 is NOT present in this worktree. Until a human pins path + sha256 + bytes it blocks.
 p06:{path:null,sha256:null,bytes:null},
 // Review-only fail-closed overlay. Pinned filename, UNPINNED hash (no shell was available to compute it).
 overlay:{
  dir:"ops/vox/identity-attestation-overlay",
  file:"20261030010000_vox_ab7k_identity_attestation_fail_closed_overlay.sql",
  sha256:null,bytes:null,
  requiresPathIncludes:"20261018120000_vox_ab7j_two_person_staff_suspend_candidate.sql"
 },
 migrationsDir:"supabase/migrations",
 // Pinned Ed25519 public keys for independent signers: {keyId,role,signerId,publicKeyPem}.
 // Empty means no signature can verify, so every signoff gate holds.
 signerKeys:[],
 ownerId:null,
 requiredRoles:["DBA","APPSEC","OWNER","TEAM_LEADER","RELEASE_SIGNER"],
 requiredFlagsOff:["VOX_STAFF_PORTAL_ENABLED","VOX_TEAM_WORKSPACE_ENABLED","VOX_AB7H_SIGNED_OPERATOR_ATOMIC_ENABLED"],
 maxEnvelopeLifetimeMs:7*24*3600*1000,
 maxAal2AgeMs:15*60*1000,
 maxBackupAgeMs:24*3600*1000,
 // Hard-off. Flipping this is a reviewed code change, never a CLI argument.
 goEnabled:false
});
