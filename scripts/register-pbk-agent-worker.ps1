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

Import-Module ScheduledTasks -ErrorAction Stop

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$workerScript`" -RepoPath `"$RepoPath`""

$trigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Runs the PBK away-mode worker every $IntervalMinutes minutes." `
  -Force | Out-Null

$registered = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
if (-not $registered) {
  throw "Task $TaskName was not found after registration."
}

Write-Host "Registered scheduled task $TaskName"
