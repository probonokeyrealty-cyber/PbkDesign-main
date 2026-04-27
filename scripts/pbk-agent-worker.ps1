param(
  [string]$RepoPath = "C:\Users\Dell\Documents\New project 2\PbkDesign-main",
  [string]$Repository = "probonokeyrealty-cyber/PbkDesign-main",
  [string]$AgentId = "main",
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
    $isClaimed = $comments | Where-Object { ($_.body -as [string]) -match [regex]::Escape($claimMarker) }
    $isDone = $comments | Where-Object { ($_.body -as [string]) -match [regex]::Escape($doneMarker) }
    if ((-not $isClaimed) -and (-not $isDone)) {
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
- Run the narrowest useful checks while you work.
- Before finishing, make sure npm run build and npm run test:founder pass unless the issue explicitly limits scope and you explain why.

When you are done:
- Leave the repo with the intended code changes only.
- Print a short summary of what changed and what tests passed.
"@
}

$issue = Get-NextIssue
if (-not $issue) {
  Write-Host "No agent-ready issue available."
  exit 0
}

$issueLabels = Get-IssueLabelNames -Issue $issue
$claimBody = @"
$claimMarker
Worker claimed this issue on $(hostname) at $(Get-Date -Format o).
"@

if (-not $DryRun) {
  Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)/comments" -Body @{ body = $claimBody } | Out-Null
}

Assert-CleanRepo

git -C $RepoPath fetch origin
git -C $RepoPath checkout main
git -C $RepoPath pull --ff-only origin main

$branchName = "agent/$($issue.number)-$(Get-Slug -Value $issue.title)"
git -C $RepoPath checkout -B $branchName origin/main

$prompt = New-AgentPrompt -Issue $issue

if ($DryRun) {
  Write-Host $prompt
  exit 0
}

$raw = (& openclaw.cmd agent --local --agent $AgentId --message $prompt --json 2>&1 | Out-String)
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

Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)/comments" -Body @{
  body = @"
$doneMarker
Worker opened PR $($pr.html_url)

Summary:
$($result.meta.finalAssistantVisibleText)
"@
} | Out-Null

Write-Host "Opened PR $($pr.html_url)"
