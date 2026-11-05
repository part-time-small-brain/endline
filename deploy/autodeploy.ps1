$Repo = Split-Path -Parent $PSScriptRoot
$Log = Join-Path (Split-Path -Parent $Repo) "endline-deploy.log"
Set-Location $Repo

function Log($m) { "$(Get-Date -Format s) $m" | Add-Content $Log }

function Run {
  $exe, $rest = $args
  $out = & $exe $rest 2>&1
  if ($LASTEXITCODE -ne 0) { throw "$args failed: $($out | Select-Object -Last 3)" }
  $out
}

try {
  Run git fetch --quiet origin main | Out-Null
  $remote = Run git rev-parse origin/main
  $deployed = git rev-parse -q --verify deployed
  if ($deployed -ne $remote) {
    Run git reset --hard --quiet $remote | Out-Null
    $server = -not $deployed -or (Run git diff --name-only --no-renames $deployed $remote | Where-Object { $_ -notmatch '^(apps/web/|apps/docs/)|\.md$' })
    if ($server) {
      Push-Location deploy
      Run docker compose build | Out-Null
      Run docker compose up -d --remove-orphans | Out-Null
      Pop-Location
      Log "deployed $remote"
    } else {
      Log "skipped ${remote}: web, docs or markdown only"
    }
    Run git tag -f deployed $remote | Out-Null
  }
} catch {
  Log "FAILED: $_"
  exit 1
}
