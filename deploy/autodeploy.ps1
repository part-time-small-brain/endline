param([Parameter(Mandatory)][ValidateSet('testnet', 'mainnet')][string]$Network)

$Ref = @{ testnet = 'staging'; mainnet = 'main' }[$Network]
$Repo = Split-Path -Parent $PSScriptRoot
$Log = Join-Path (Split-Path -Parent $Repo) "endline-$Network-deploy.log"
Set-Location $Repo

function Log($m) { "$(Get-Date -Format s) $m" | Add-Content $Log }

function Run {
  $exe, $rest = $args
  $out = & $exe $rest 2>&1
  if ($LASTEXITCODE -ne 0) { throw "$args failed: $($out | Select-Object -Last 3)" }
  $out
}

try {
  if ((Get-Content "deploy\.env.$Network") -notcontains "NETWORK_ID=$Network") { throw "deploy\.env.$Network must set NETWORK_ID=$Network" }
  Run git fetch --quiet origin $Ref | Out-Null
  $remote = Run git rev-parse "origin/$Ref"
  $deployed = git rev-parse -q --verify deployed
  if ($deployed -ne $remote) {
    $changed = if ($deployed) { Run git diff --name-only --no-renames $deployed $remote } else { @() }
    # main's compose and this script run on the host next to the mainnet keys: testnet takes them only by hand
    if ($Network -eq 'testnet' -and ($changed -match '^deploy/(compose\.yaml|autodeploy\.ps1)$')) { throw "held ${remote}: deploy/compose.yaml or deploy/autodeploy.ps1 changed, deploy by hand" }
    Run git reset --hard --quiet $remote | Out-Null
    $server = -not $deployed -or ($changed | Where-Object { $_ -notmatch '^(apps/web/|apps/docs/)|\.md$' })
    if ($server) {
      Push-Location deploy
      Run docker compose --env-file ".env.$Network" build | Out-Null
      Run docker compose --env-file ".env.$Network" up -d --remove-orphans | Out-Null
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
