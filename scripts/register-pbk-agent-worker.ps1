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

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$workerScript`" -RepoPath `"$RepoPath`""

$trigger = New-ScheduledTaskTrigger -Daily -At "12:00AM"
$trigger.Repetition = New-ScheduledTaskRepetitionSettings -Interval (New-TimeSpan -Minutes $IntervalMinutes) -Duration (New-TimeSpan -Days 1)

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "PBK unattended founder worker" `
  -Force | Out-Null

Write-Host "Registered scheduled task $TaskName"
