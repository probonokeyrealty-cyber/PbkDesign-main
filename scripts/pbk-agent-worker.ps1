param(
  [string]$RepoPath = "C:\Users\Dell\Documents\New project 2\PbkDesign-main",
  [string]$Repository = "probonokeyrealty-cyber/PbkDesign-main",
  [string]$AgentId = "main",
  [string]$OpenClawProfile = "pbk-worker",
  [string]$FallbackOpenClawProfile = "pbk-worker-openai",
  [string]$FallbackModel = "openai/gpt-5.2",
  [int]$StaleClaimMinutes = 60,
  [int]$IssueNumber = 0,
  [switch]$DryRun,
  [switch]$NoPush
)

$ErrorActionPreference = "Stop"

$claimMarker = "<!-- pbk-agent-worker:claimed -->"
$doneMarker = "<!-- pbk-agent-worker:finished -->"
$allowedRunnerArtifacts = @(
  ".openclaw",
  ".openclaw/",
  "AGENTS.md",
  "HEARTBEAT.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md",
  "USER.md",
  "MEMORY.md",
  "memory",
  "memory/"
)

function Get-EnvironmentValue {
  param([string]$Name)

  foreach ($scope in @("Process", "User", "Machine")) {
    $value = [Environment]::GetEnvironmentVariable($Name, $scope)
    if ($value) {
      return $value
    }
  }

  return $null
}

function ConvertTo-GitHubSafeText {
  param(
    [AllowNull()]
    [string]$Value,
    [int]$MaxChars = 6000
  )

  if ($null -eq $Value) {
    return ""
  }

  $builder = New-Object System.Text.StringBuilder
  foreach ($ch in $Value.ToCharArray()) {
    $code = [int][char]$ch
    if ($code -eq 0) {
      continue
    }
    if ($code -ge 0xD800 -and $code -le 0xDFFF) {
      [void]$builder.Append("?")
      continue
    }
    [void]$builder.Append($ch)
  }

  $clean = $builder.ToString()
  if ($clean.Length -gt $MaxChars) {
    $clean = $clean.Substring(0, $MaxChars - 16) + "`n...[truncated]"
  }

  return $clean
}

function Get-Token {
  foreach ($name in @("PBK_GITHUB_TOKEN", "GITHUB_TOKEN", "GH_TOKEN")) {
    $value = Get-EnvironmentValue -Name $name
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

function Add-IssueComment {
  param(
    [int]$Number,
    [string]$Body
  )

  $tempPath = Join-Path $env:TEMP ("pbk-issue-comment-{0}.md" -f [guid]::NewGuid().ToString())
  $safeBody = ConvertTo-GitHubSafeText -Value $Body
  Set-Content -Path $tempPath -Value $safeBody -Encoding utf8

  try {
    & cmd /c ("gh issue comment {0} --repo {1} --body-file ""{2}""" -f $Number, $Repository, $tempPath) | Out-Null
  }
  finally {
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Ensure-GitIdentity {
  param([string]$Repo)

  $name = (git -C $Repo config --get user.name 2>$null | Out-String).Trim()
  $email = (git -C $Repo config --get user.email 2>$null | Out-String).Trim()

  if (-not $name) {
    git -C $Repo config user.name "PBK Agent Worker" | Out-Null
  }
  if (-not $email) {
    git -C $Repo config user.email "pbk-agent@local.invalid" | Out-Null
  }
}

function Get-OrCreatePullRequest {
  param(
    [string]$Title,
    [string]$BranchName,
    [string]$Body
  )

  $existingJson = (& gh pr list --repo $Repository --head $BranchName --json number,url 2>$null | Out-String).Trim()
  if ($existingJson) {
    $existing = @(ConvertFrom-JsonCompat -JsonText $existingJson)
    if ($existing.Count -gt 0) {
      return [pscustomobject]@{
        number = $existing[0].number
        html_url = $existing[0].url
      }
    }
  }

  $tempPath = Join-Path $env:TEMP ("pbk-pr-body-{0}.md" -f [guid]::NewGuid().ToString())
  $safeBody = ConvertTo-GitHubSafeText -Value $Body
  Set-Content -Path $tempPath -Value $safeBody -Encoding utf8

  try {
    & gh pr create --repo $Repository --base main --head $BranchName --title $Title --body-file $tempPath | Out-Null
    $createdJson = (& gh pr view --repo $Repository $BranchName --json number,url | Out-String).Trim()
    if (-not $createdJson) {
      throw "GitHub CLI created the pull request but did not return JSON metadata."
    }

    $created = ConvertFrom-JsonCompat -JsonText $createdJson
    return [pscustomobject]@{
      number = $created.number
      html_url = $created.url
    }
  }
  finally {
    Remove-Item $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Get-AgentPullRequestTitle {
  param([string]$IssueTitle)

  if ($IssueTitle -match '^\[agent\]\s*') {
    return $IssueTitle
  }

  return "[agent] $IssueTitle"
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
  return (ConvertFrom-JsonCompat -JsonText $jsonText)
}

function Normalize-OpenClawResult {
  param([object]$Json)

  if (-not $Json) {
    return $null
  }

  $text = "$($Json.meta.finalAssistantVisibleText)".Trim()
  if (-not $text) {
    $textParts = @($Json.payloads | ForEach-Object { $_.text }) | Where-Object { $_ }
    $text = ($textParts -join "`n").Trim()
  }

  $stopReason = @(
    "$($Json.meta.completion.stopReason)".Trim()
    "$($Json.meta.stopReason)".Trim()
    "$($Json.completion.stopReason)".Trim()
    "$($Json.stopReason)".Trim()
  ) | Where-Object { $_ } | Select-Object -First 1

  if (-not $text) {
    return $null
  }

  if ($stopReason -and $stopReason -eq "error") {
    return $null
  }

  if (-not $Json.meta) {
    $Json | Add-Member -MemberType NoteProperty -Name meta -Value ([pscustomobject]@{}) -Force
  }
  if (-not $Json.meta.finalAssistantVisibleText) {
    $Json.meta | Add-Member -MemberType NoteProperty -Name finalAssistantVisibleText -Value $text -Force
  }

  return $Json
}

function ConvertFrom-JsonCompat {
  param([string]$JsonText)

  $command = Get-Command ConvertFrom-Json
  if ($command.Parameters.ContainsKey("Depth")) {
    return ($JsonText | ConvertFrom-Json -Depth 50)
  }

  return ($JsonText | ConvertFrom-Json)
}

function Assert-CleanRepo {
  $status = @(git -C $RepoPath status --porcelain --untracked-files=all)
  $meaningful = @($status | Where-Object {
      $line = "$_"
      if (-not $line.Trim()) {
        return $false
      }

      $path = if ($line.Length -ge 4) { $line.Substring(3).Trim() } else { $line.Trim() }
      foreach ($allowed in $allowedRunnerArtifacts) {
        $normalizedAllowed = $allowed.TrimEnd("/")
        if ($path -eq $normalizedAllowed -or $path.StartsWith("$normalizedAllowed/")) {
          return $false
        }
      }

      return $true
    })

  if ($meaningful.Count -gt 0) {
    throw ("Agent worker requires a clean repo clone. Pending changes:`n{0}" -f ($meaningful -join "`n"))
  }
}

function Ensure-RunnerPrerequisites {
  $assets = @(
    @{
      Source = Join-Path $RepoPath "public\PBK_Master_Deal_Package.html"
      Destination = Join-Path $HOME "PBK_Master_Deal_Package.html"
    },
    @{
      Source = Join-Path $RepoPath "public\legacy\PBK_Command_Center v5.html"
      Destination = Join-Path $HOME "PBK_Command_Center v5.html"
    }
  )

  foreach ($asset in $assets) {
    if (-not (Test-Path $asset.Source)) {
      continue
    }

    $shouldCopy = -not (Test-Path $asset.Destination)
    if (-not $shouldCopy) {
      $sourceInfo = Get-Item $asset.Source
      $destInfo = Get-Item $asset.Destination
      $shouldCopy = ($sourceInfo.Length -ne $destInfo.Length)
    }

    if ($shouldCopy) {
      Copy-Item -Path $asset.Source -Destination $asset.Destination -Force
    }
  }
}

function Get-OpenClawProfileRoot {
  param([string]$ProfileName)
  return (Join-Path $HOME ".openclaw-$ProfileName")
}

function Ensure-OpenClawProfile {
  param(
    [string]$ProfileName,
    [string]$PrimaryModel
  )

  $profileRoot = Get-OpenClawProfileRoot -ProfileName $ProfileName
  $configPath = Join-Path $profileRoot "openclaw.json"
  New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null

  $config = @{
    agents = @{
      defaults = @{
        workspace = $RepoPath
        model = @{
          primary = $PrimaryModel
        }
        models = @{
          $PrimaryModel = @{}
        }
      }
    }
    env = @{
      shellEnv = @{
        enabled = $true
        timeoutMs = 5000
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

function Get-OpenClawSessionFile {
  param(
    [string]$ProfileName,
    [string]$SessionId
  )

  $profileRoot = Get-OpenClawProfileRoot -ProfileName $ProfileName
  return (Join-Path $profileRoot "agents\$AgentId\sessions\$SessionId.jsonl")
}

function Get-OpenClawSessionResult {
  param([string]$SessionFile)

  if (-not (Test-Path $SessionFile)) {
    return $null
  }

  $lastAssistant = $null
  foreach ($line in Get-Content $SessionFile) {
    try {
      $entry = ConvertFrom-JsonCompat -JsonText $line
    }
    catch {
      continue
    }

    if ($entry.type -eq "message" -and $entry.message -and $entry.message.role -eq "assistant") {
      $lastAssistant = $entry.message
    }
  }

  if (-not $lastAssistant) {
    return $null
  }

  $textParts = @($lastAssistant.content | Where-Object { $_.type -eq "text" } | ForEach-Object { $_.text }) | Where-Object { $_ }
  $text = ($textParts -join "`n").Trim()
  $stopReason = "$($lastAssistant.stopReason)"
  $errorMessage = "$($lastAssistant.errorMessage)".Trim()

  return [pscustomobject]@{
    Success = ($stopReason -ne "error" -and -not [string]::IsNullOrWhiteSpace($text))
    Text = $text
    StopReason = $stopReason
    ErrorMessage = $errorMessage
  }
}

function Set-OpenClawProcessEnvironment {
  foreach ($name in @("GOOGLE_API_KEY", "OPENAI_API_KEY")) {
    $value = Get-EnvironmentValue -Name $name
    if ($value) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

function Quote-ProcessArgument {
  param([string]$Value)

  if ($null -eq $Value -or $Value.Length -eq 0) {
    return '""'
  }

  if ($Value -notmatch '[\s"]') {
    return $Value
  }

  $escaped = $Value -replace '(\\*)"', '$1$1\"'
  $escaped = $escaped -replace '(\\+)$', '$1$1'
  return '"' + $escaped + '"'
}

function Invoke-OpenClawTurn {
  param(
    [string]$ProfileName,
    [string]$Prompt,
    [string]$SessionId,
    [int]$TimeoutSeconds = 600
  )

  $sessionFile = Get-OpenClawSessionFile -ProfileName $ProfileName -SessionId $SessionId
  $stdoutPath = Join-Path $env:TEMP "pbk-openclaw-$SessionId.stdout.log"
  $stderrPath = Join-Path $env:TEMP "pbk-openclaw-$SessionId.stderr.log"

  foreach ($path in @($sessionFile, "$sessionFile.lock", $stdoutPath, $stderrPath)) {
    if (Test-Path $path) {
      Remove-Item $path -Force -ErrorAction SilentlyContinue
    }
  }

  Set-OpenClawProcessEnvironment

  $argumentList = @(
    $openClawEntrypoint,
    "--profile",
    $ProfileName,
    "agent",
    "--local",
    "--agent",
    $AgentId,
    "--session-id",
    $SessionId,
    "--message",
    $Prompt,
    "--json"
  )
  $quotedArguments = ($argumentList | ForEach-Object { Quote-ProcessArgument -Value "$_" }) -join " "

  $process = Start-Process `
    -FilePath "node" `
    -ArgumentList $quotedArguments `
    -WorkingDirectory $RepoPath `
    -NoNewWindow `
    -PassThru `
    -RedirectStandardOutput $stdoutPath `
    -RedirectStandardError $stderrPath

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $sessionResult = $null

  while ((Get-Date) -lt $deadline) {
    $sessionResult = Get-OpenClawSessionResult -SessionFile $sessionFile
    if ($sessionResult -and ($sessionResult.Success -or $sessionResult.StopReason -eq "error")) {
      break
    }

    if ($process.HasExited) {
      break
    }

    Start-Sleep -Seconds 2
  }

  if ($sessionResult -and $sessionResult.Success) {
    Start-Sleep -Seconds 2
    if (-not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }

    return [pscustomobject]@{
      meta = [pscustomobject]@{
        finalAssistantVisibleText = $sessionResult.Text
      }
    }
  }

  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }

  $stdout = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw } else { "" }
  $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { "" }

  foreach ($rawText in @($stdout, $stderr)) {
    if (-not $rawText) {
      continue
    }

    try {
      $json = Get-OpenClawJson -RawText $rawText
      $normalized = Normalize-OpenClawResult -Json $json
      if ($normalized) {
        return $normalized
      }
    }
    catch {
      Write-Warning ("OpenClaw result parse failed for profile {0}: {1}" -f $ProfileName, $_.Exception.Message)
    }
  }

  if ($sessionResult -and $sessionResult.StopReason -eq "error") {
    throw ("OpenClaw session failed for profile {0}: {1}" -f $ProfileName, $sessionResult.ErrorMessage)
  }

  $combinedText = (@($stdout, $stderr) | Where-Object { $_ }) -join "`n"
  if ($combinedText) {
    try {
      $json = Get-OpenClawJson -RawText $combinedText
      $normalized = Normalize-OpenClawResult -Json $json
      if ($normalized) {
        return $normalized
      }
    }
    catch {
      Write-Warning ("Combined OpenClaw result parse failed for profile {0}: {1}" -f $ProfileName, $_.Exception.Message)
    }
  }

  $details = (@($stdout, $stderr) | Where-Object { $_ } | ForEach-Object { $_.Trim() }) -join "`n"
  if (-not $details) {
    $details = "No JSON output captured before timeout."
  }

  throw "OpenClaw run failed for profile $ProfileName. $details"
}

Assert-CleanRepo
Ensure-RunnerPrerequisites
Ensure-OpenClawProfile -ProfileName $OpenClawProfile -PrimaryModel "google/gemini-2.5-flash"
$fallbackAvailable = $false
if (Get-EnvironmentValue -Name "OPENAI_API_KEY") {
  Ensure-OpenClawProfile -ProfileName $FallbackOpenClawProfile -PrimaryModel $FallbackModel
  $fallbackAvailable = $true
}

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
Ensure-GitIdentity -Repo $RepoPath

$prompt = Get-CommandSafePrompt -Value (New-AgentPrompt -Issue $issue)
$openClawEntrypoint = Get-OpenClawEntrypoint
$runSessionId = [guid]::NewGuid().ToString()

if ($DryRun) {
  Write-Host $prompt
  exit 0
}

$claimComment = $null

try {
  $usedProfile = $OpenClawProfile
  $primaryFailureMessage = $null

  $claimBody = @"
$claimMarker
Worker claimed this issue on $(hostname) at $(Get-Date -Format o).
"@

  if (-not $DryRun) {
    $claimComment = Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)/comments" -Body @{ body = $claimBody }
  }

  try {
    $result = Invoke-OpenClawTurn -ProfileName $OpenClawProfile -Prompt $prompt -SessionId $runSessionId
  }
  catch {
    $primaryFailureMessage = $_.Exception.Message
    if (-not $fallbackAvailable) {
      throw
    }

    Write-Warning "Primary worker run failed; retrying with fallback profile $FallbackOpenClawProfile. $primaryFailureMessage"
    $usedProfile = $FallbackOpenClawProfile
    $fallbackSessionId = [guid]::NewGuid().ToString()
    $result = Invoke-OpenClawTurn -ProfileName $FallbackOpenClawProfile -Prompt $prompt -SessionId $fallbackSessionId
  }

  $diff = git -C $RepoPath status --porcelain
  if (-not $diff) {
    $summary = $result.meta.finalAssistantVisibleText
    if ($primaryFailureMessage) {
      $summary = "Fallback profile $FallbackOpenClawProfile succeeded after primary failure: $primaryFailureMessage`n`n$summary"
    }
    $summary = ConvertTo-GitHubSafeText -Value $summary

    Add-IssueComment -Number $issue.number -Body "$doneMarker`nWorker completed without code changes. Summary:`n`n$summary"
    if ($claimComment -and $claimComment.id) {
      Remove-IssueComment -CommentId $claimComment.id
    }
    exit 0
  }

  npm --prefix $RepoPath run test:founder

  git -C $RepoPath add -A
  $commitMessage = "[agent] Resolve #$($issue.number) $($issue.title)"
  git -C $RepoPath commit -m $commitMessage

  if (-not $NoPush) {
    git -C $RepoPath push -u origin $branchName
  }

  $summaryText = $result.meta.finalAssistantVisibleText
  $executionNotes = @("- model profile: $usedProfile")
  if ($primaryFailureMessage) {
    $executionNotes += "- primary failure: $primaryFailureMessage"
  }

  $prBody = ConvertTo-GitHubSafeText -Value @"
Closes #$($issue.number)

## Agent summary
$summaryText

## Checks
- npm run test:founder

## Execution
$($executionNotes -join "`n")
"@

  $pr = Get-OrCreatePullRequest -Title (Get-AgentPullRequestTitle -IssueTitle $issue.title) -BranchName $branchName -Body $prBody

  if ($issueLabels -contains "agent/automerge") {
    Invoke-GitHubApi -Method POST -Uri "https://api.github.com/repos/$Repository/issues/$($pr.number)/labels" -Body @{
      labels = @("agent/automerge")
    } | Out-Null
  }

  $updatedIssueLabels = @($issueLabels | Where-Object { $_ -ne "agent/ready" })
  Invoke-GitHubApi -Method PATCH -Uri "https://api.github.com/repos/$Repository/issues/$($issue.number)" -Body @{
    labels = $updatedIssueLabels
  } | Out-Null

  $doneBody = ConvertTo-GitHubSafeText -Value (@(
    $doneMarker
    "Worker opened PR $($pr.html_url)"
    ""
    "Execution:"
    ($executionNotes -join "`n")
    ""
    "Summary:"
    $summaryText
  ) -join "`n")
  Add-IssueComment -Number $issue.number -Body $doneBody
  if ($claimComment -and $claimComment.id) {
    Remove-IssueComment -CommentId $claimComment.id
  }

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

  $failureBody = ConvertTo-GitHubSafeText -Value (@(
    "Worker run failed on $(hostname) at $(Get-Date -Format o)."
    ""
    "Error:"
    '```'
    $_.Exception.Message
    '```'
  ) -join "`n")

  Add-IssueComment -Number $issue.number -Body $failureBody

  throw
}
