param(
  [string]$RepoPath = "C:\Users\Dell\Documents\New project 2\PbkDesign-main",
  [string]$Repository = "probonokeyrealty-cyber/PbkDesign-main",
  [string]$AgentId = "main",
  [string]$OpenClawProfile = "pbk-worker",
  [int]$StaleClaimMinutes = 60,
  [int]$IssueNumber = 0,
  [switch]$DryRun,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

$claimMarker = "<!-- pbk-agent-worker:claimed -->"
$doneMarker = "<!-- pbk-agent-worker:finished -->"

function Get-Token {
  foreach ($name in @("PBK_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN")) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "User") }
    if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, "Machine") }
    if ($value) { return $value }
  }

  $ghToken = (& cmd /c "gh auth token" 2>$null | Out-String).Trim()
  if ($ghToken) {
    return $ghToken
  }

  throw "Missing GitHub token. Set PBK_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN, or log in with gh auth login."
}

function Invoke-GitHubApi {
  param(
    [string]$Method,
    [string]$Uri,
    [object]$Body = $null
  )

  $headers = @{
    Authorization = "Bearer $(Get-Token)"
    Accept = "application/vnd.github+json"
    "X-GitHub-Api-Version" = "2022-11-28"
  }

  $params = @{
    Method = $Method
    Uri = $Uri
    Headers = $headers
  }

  if ($null -ne $Body) {
    $params["ContentType"] = "application/json"
    $params["Body"] = ($Body | ConvertTo-Json -Depth 20)
  }

  Invoke-RestMethod @params
}

function Get-IssueLabelNames {
  param([object]$Issue)
  @($Issue.labels | ForEach-Object {
      if ($_ -is [string]) { $_ } else { $_.name }
    }) | Where-Object { $_ }
}

function Test-IssueHasLabel {
  param([object]$Issue, [string]$Label)
  return (Get-IssueLabelNames -Issue $Issue) -contains $Label
}

function Get-IssueComments {
  param([int]$Number)
  Invoke-GitHubApi -Method GET -Uri "https://api.github.com/repos/$Repository/issues/$Number/comments?per_page=100"
}

function Get-CommentTimestamp {
  param([object]$Comment)
  if (-not $Comment.created_at) {
    return $null
  }

  if ($Comment.created_at -is [datetimeoffset]) {
    return $Comment.created_at
  }
  if ($Comment.created_at -is [datetime]) {
    return [datetimeoffset]$Comment.created_at
  }

  $rawValue = "$($Comment.created_at)".Trim()
  if (-not $rawValue) {
    return $null
  }

  $parsed = [datetimeoffset]::MinValue
  if ([datetimeoffset]::TryParse($rawValue, [ref]$parsed)) {
    return $parsed
  }

  return $null
}

function Remove-IssueComment {
  param([Int64]$CommentId)
  Invoke-GitHubApi -Method DELETE -Uri "https://api.github.com/repos/$Repository/issues/comments/$CommentId" | Out-Null
}

function Get-NextIssue {
  if ($IssueNumber -gt 0) {
    return Invoke-GitHubApi -Method GET -Uri "https://api.github.com/repos/$Repository/issues/$IssueNumber"
  }

  $issues = Invoke-GitHubApi -Method GET -Uri "https://api.github.com/repos/$Repository/issues?state=open&labels=agent/ready&per_page=50&sort=created&direction=asc"
  $candidates = @($issues | Where-Object {
      -not $_.pull_request -and
      -not (Test-IssueHasLabel -Issue $_ -Label "agent/human-required")
    })

  foreach ($candidate in $candidates) {
    $comments = @(Get-IssueComments -Number $candidate.number)
    $doneComments = @($comments | Where-Object { ($_.body -as [string]) -match [regex]::Escape($doneMarker) })
    if ($doneComments.Count -gt 0) {
      continue
    }

    $claimComments = @($comments | Where-Object { ($_.body -as [string]) -match [regex]::Escape($claimMarker) })
    if ($claimComments.Count -eq 0) {
      return $candidate
    }

    $latestClaim = $claimComments[-1]
    $latestClaimAt = Get-CommentTimestamp $latestClaim
    if (-not $latestClaimAt) {
      return $candidate
    }

    $failureAfterClaim = @($comments | Where-Object {
        $body = $_.body -as [string]
        $createdAt = Get-CommentTimestamp $_
        $createdAt -and
        $createdAt -gt $latestClaimAt -and
        $body -like "Worker run failed on*"
      })
    if ($failureAfterClaim.Count -gt 0) {
      return $candidate
    }

    $claimAgeMinutes = (([datetimeoffset]::UtcNow) - $latestClaimAt.ToUniversalTime()).TotalMinutes
    if ($claimAgeMinutes -ge $StaleClaimMinutes) {
      return $candidate
    }
  }

  return $null
}

function Get-Slug {
  param([string]$Value)
  return (($Value.ToLower() -replace "[^a-z0-9]+", "-").Trim("-")).Substring(0, [Math]::Min(48, (($Value.ToLower() -replace "[^a-z0-9]+", "-").Trim("-")).Length))
}

function Get-OpenClawJson {
  param([string]$RawText)
  $start = $RawText.IndexOf("{")
  if ($start -lt 0) {
    throw "OpenClaw output did not include JSON."
  }
  $jsonText = $RawText.Substring($start)
  return ($jsonText | ConvertFrom-Json -Depth 50)
}

function Assert-CleanRepo {
  $status = git -C $RepoPath status --porcelain
  if ($status) {
    throw "Agent worker requires a clean repo clone. Current repo has pending changes."
  }
}

function Ensure-OpenClawProfile {
  $profileRoot = Join-Path $HOME ".openclaw-$OpenClawProfile"
  $configPath = Join-Path $profileRoot "openclaw.json"
  New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null

  $config = @{
    agents = @{
      defaults = @{
        workspace = $RepoPath
        model = @{
          primary = "google/gemini-2.5-flash"
        }
        models = @{
          "google/gemini-2.5-flash" = @{}
        }
      }
    }
  }

  ($config | ConvertTo-Json -Depth 10) | Set-Content -Path $configPath -Encoding UTF8
}

function Get-OpenClawEntrypoint {
  $cmdPath = (Get-Command openclaw.cmd -ErrorAction Stop).Source
  $entrypoint = Join-Path (Split-Path $cmdPath -Parent) "node_modules\openclaw\openclaw.mjs"
  if (-not (Test-Path $entrypoint)) {
    throw "OpenClaw entrypoint not found at $entrypoint"
  }
  return $entrypoint
}

function New-AgentPrompt {
  param([object]$Issue)

  $body = if ($Issue.body) { $Issue.body } else { "_No body provided._" }
  return @"
You are the unattended PBK founder builder.

Work only in this repository:
$RepoPath

Issue #$($Issue.number): $($Issue.title)

$body

Hard rules:
- Keep PBK founder runtime contracts stable.
- Do not change secrets, env vars, billing resources, provider dashboards, or cloud settings.
- Do not buy anything or complete onboarding steps.
- Stay inside this repo only.
- For file reads and edits, use absolute paths rooted at $RepoPath.
- For shell/exec commands, set workdir to $RepoPath.
- Run the narrowest useful checks while you work.
- Before finishing, make sure npm run build and npm run test:founder pass unless the issue explicitly limits scope and you explain why.

When you are done:
- Leave the repo with the intended code changes only.
- Print a short summary of what changed and what tests passed.
"@
}

function Get-CommandSafePrompt {
  param([string]$Value)
  return (($Value -replace "(`r`n|`n|`r)", "\n")).Trim()
}

Assert-CleanRepo
Ensure-OpenClawProfile

$issue = Get-NextIssue
if (-not $issue) {
  Write-Host "No agent-ready issue available."
  exit 0
}

$issueLabels = Get-IssueLabelNames -Issue $issue
git -C $RepoPath fetch origin
git -C $RepoPath checkout main
git -C $RepoPath pull --ff-only origin main

$branchName = "agent/$($issue.number)-$(Get-Slug -Value $issue.title)"
git -C $RepoPath checkout -B $branchName origin/main

$prompt = Get-CommandSafePrompt -Value (New-AgentPrompt -Issue $issue)
$openClawEntrypoint = Get-OpenClawEntrypoint
$runSessionId = [guid]::NewGuid().ToString()

if ($DryRun) {
  Write-Host $prompt
  exit 0
}

$claimComment = $null

try {
  $claimBody = @"
$claimMarker
Worker claimed this issue on $(hostname) at $(Get-Date -Format o).
"@

  if (-not $DryRun) {
    $claimComment = Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)/comments" -Body @{ body = $claimBody }
  }

  $previousNativeErrorPreference = $PSNativeCommandUseErrorActionPreference
  $PSNativeCommandUseErrorActionPreference = $false
  try {
    $raw = (& node $openClawEntrypoint --profile $OpenClawProfile agent --local --agent $AgentId --session-id $runSessionId --message $prompt --json 2>&1 | Out-String)
  }
  finally {
    $PSNativeCommandUseErrorActionPreference = $previousNativeErrorPreference
  }
  $result = Get-OpenClawJson -RawText $raw

  $diff = git -C $RepoPath status --porcelain
  if (-not $diff) {
    Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)/comments" -Body @{
      body = "$doneMarker`nWorker completed without code changes. Summary:`n`n$($result.meta.finalAssistantVisibleText)"
    } | Out-Null
    exit 0
  }

  npm --prefix $RepoPath run test:founder

  git -C $RepoPath add -A
  $commitMessage = "[agent] Resolve #$($issue.number) $($issue.title)"
  git -C $RepoPath commit -m $commitMessage

  if (-not $NoPush) {
    git -C $RepoPath push -u origin $branchName
  }

  $prBody = @"
Closes #$($issue.number)

## Agent summary
$($result.meta.finalAssistantVisibleText)

## Checks
- npm run test:founder
"@

  $pr = Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/pulls" -Body @{
    title = "[agent] $($issue.title)"
    head = $branchName
    base = "main"
    body = $prBody
    draft = $false
  }

  if ($issueLabels -contains "agent/automerge") {
    Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($pr.number)/labels" -Body @{
      labels = @("agent/automerge")
    } | Out-Null
  }

  $updatedIssueLabels = @($issueLabels | Where-Object { $_ -ne "agent/ready" })
  Invoke-GitHubApi -Method PATCH -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)" -Body @{
    labels = $updatedIssueLabels
  } | Out-Null

  $doneBody = @(
    $doneMarker
    "Worker opened PR $($pr.html_url)"
    ""
    "Summary:"
    $result.meta.finalAssistantVisibleText
  ) -join "`n"
  Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)/comments" -Body @{
    body = $doneBody
  } | Out-Null

  Write-Host "Opened PR $($pr.html_url)"
}
catch {
  if ($claimComment -and $claimComment.id) {
    try {
      Remove-IssueComment -CommentId $claimComment.id
    }
    catch {
      Write-Warning "Failed to remove claim comment $($claimComment.id): $($_.Exception.Message)"
    }
  }

  $failureBody = @(
    "Worker run failed on $(hostname) at $(Get-Date -Format o)."
    ""
    "Error:"
    '```'
    $_.Exception.Message
    '```'
  ) -join "`n"

  Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)/comments" -Body @{
    body = $failureBody
  } | Out-Null

  throw
}
