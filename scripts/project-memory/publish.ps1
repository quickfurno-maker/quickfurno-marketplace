$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $repoRoot

$branch = (git branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($branch)) {
  throw "Project Brain publish requires a named Git branch; detached HEAD is not allowed."
}

# Never mix unrelated already-staged work into a Project Brain commit.
$preStaged = @(git diff --cached --name-only)
if ($preStaged.Count -gt 0) {
  throw "Refusing to publish: Git already has staged changes. Commit or unstage them first."
}

& (Join-Path $PSScriptRoot "refresh.ps1")
if ($LASTEXITCODE -ne 0) { throw "Project Brain refresh failed" }

# Publish only the GitHub-readable Project Brain. Other working-tree changes stay untouched.
git add -- docs/project-memory
if ($LASTEXITCODE -ne 0) { throw "Unable to stage Project Brain documents" }

$staged = @(git diff --cached --name-only)
$outside = @($staged | Where-Object { $_ -notlike "docs/project-memory/*" })
if ($outside.Count -gt 0) {
  git reset -- docs/project-memory | Out-Null
  throw "Refusing to publish: staged files escaped docs/project-memory/."
}
if ($staged.Count -eq 0) {
  Write-Output "QF_PROJECT_BRAIN_PUBLISH=NO_CHANGES"
  Write-Output "Project Brain is already current; nothing was committed or pushed."
  exit 0
}

node scripts/project-memory/verify.mjs
if ($LASTEXITCODE -ne 0) {
  git reset -- docs/project-memory | Out-Null
  throw "Project Brain verification failed before commit"
}

git diff --cached --check
if ($LASTEXITCODE -ne 0) {
  git reset -- docs/project-memory | Out-Null
  throw "Staged Project Brain diff failed git diff --check"
}

$commitMessage = "chore(project-brain): refresh QuickFurno memory"
git commit -m $commitMessage
if ($LASTEXITCODE -ne 0) { throw "Project Brain commit failed" }

git push -u origin $branch
if ($LASTEXITCODE -ne 0) { throw "Project Brain push failed" }

Write-Output "QF_PROJECT_BRAIN_PUBLISH=PASS"
Write-Output "Published refreshed Project Brain to origin/$branch."
