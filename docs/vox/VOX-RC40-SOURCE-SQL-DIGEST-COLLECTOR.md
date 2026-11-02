# VOX RC40 source SQL digest collector

Offline, read-only collector for the 107 source-only SQL files in
`docs/vox/VOX-MANAGED-STAGING-MIGRATION-DRIFT-READONLY-20261031.json`
(31 managed-only, 107 source-only, 55 common). It turns the per-file digest burden into one command.

Script: `scripts/mvp/vox/rc40-source-sql-digest-collector.mjs`
Tests: `scripts/mvp/vox/rc40-source-sql-digest-collector.test.mjs`

## Usage

```
node scripts/mvp/vox/rc40-source-sql-digest-collector.mjs --out <new-evidence.json> \
  [--drift <drift.json>] [--source-dir <dir>] [--expected <digests.json>] \
  [--prev <earlier-evidence.json>] [--require-complete]
```

Defaults: the 20261031 drift record and `supabase/migrations`. Exit 0 on success, 1 on any rejection.

- `--out` is created exclusively (`wx`): an existing file is never overwritten, and a rejected run leaves no file.
- `--expected` accepts digest evidence in one of three schemas, matched to source-only files by file or version:
  `qf.vox.rc40.source-sql-expected-digests.v1` (`entries:[{file,sha256}]`),
  `qf.vox.rc38.migration-digests.v1` (predeploy, `forwardSha256`), or an RC38 dry-run plan (`stages[].forwardSha256`).
  Digests are compared to the canonical (CRLF/trailing-whitespace normalised) digest, or the raw digest.
- `--require-complete` rejects unless every source-only file is attested by `--expected`.
- `--prev` chains an earlier evidence file: it must be untampered, and none of its entries may be removed or have a changed digest.

## Output

`qf.vox.rc40.source-sql-digest-evidence.v1`: per-file `sha256` and `canonicalSha256`, `attestation`
(`MATCHES_CANONICAL` / `MATCHES_RAW` / `UNATTESTED`), `sourceOnlyDigestSetSha256`, `evidenceSha256`,
and the managed-only versions by name only with `sqlDigest: null` (managed SQL is never guessed).
No timestamps, so identical inputs give byte-identical output. `releaseGo` is always `false`.

## Rejections (fail closed)

Missing source-only file; SQL file in the source dir that is neither source-only nor common; duplicate
filenames, versions or digests; empty files; digests matching quarantined/protected roots (or pending paths);
expected digest mismatch, malformed, duplicated or naming a non-source-only file; secrets in JSON inputs;
drift record with inconsistent counts or non-read-only flags.

## Not done here

No DB or network access, no env reads, no SQL execution, no managed Staging/Production writes, no flag
activation. Collecting digests is evidence only, not a deploy plan and not a GO.

Run tests: `node --test scripts/mvp/vox/rc40-source-sql-digest-collector.test.mjs`
