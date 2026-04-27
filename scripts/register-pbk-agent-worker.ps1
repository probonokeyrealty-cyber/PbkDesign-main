param(
  [string]$RepoPath = "C:\Users\Dell\Documents\New project 2\PbkDesign-main",
  [string]$TaskName = "PBK-Agent-Worker",
  [int]$IntervalMinutes = 15
)

$ErrorActionPreference = "Stop"

$workerScript = Join-Path $RepoPath "scripts\pbk-agent-worker.ps1"
if (-not (Test-Path $workerScript)) {
  throw "Worker script not found at $workerScript"
}

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$workerScript`" -RepoPath `"$RepoPath`""
$arguments = @(
  '/Create',
  '/TN', $TaskName,
  '/SC', 'MINUTE',
  '/MO', "$IntervalMinutes",
  '/TR', $taskCommand,
  '/F'
)

$createOutput = & schtasks.exe @arguments 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Failed to register task via schtasks.exe: $createOutput"
}

$registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if (-not $registered) {
  throw "Task $TaskName was not found after registration."
}

Write-Host "Registered scheduled task $TaskName"
