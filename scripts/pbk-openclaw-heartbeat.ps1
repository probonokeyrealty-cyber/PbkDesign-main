param(
  [ValidateSet('start', 'stop', 'status', 'once', 'install', 'uninstall')]
  [string]$Command = 'status',
  [string]$RepoPath = ''
)

$ErrorActionPreference = 'Stop'

if (-not $RepoPath) {
  $RepoPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

$LocalDir = Join-Path $RepoPath '.pbk-local'
$PidFile = Join-Path $LocalDir 'openclaw-gateway-heartbeat.pid'
$OutLog = Join-Path $LocalDir 'openclaw-gateway-heartbeat.out.log'
$ErrLog = Join-Path $LocalDir 'openclaw-gateway-heartbeat.err.log'
$NodeScript = Join-Path $RepoPath 'scripts\openclaw-gateway-heartbeat.mjs'
$TaskName = 'PBK-OpenClaw-Gateway-Heartbeat'
$StartupFile = Join-Path ([Environment]::GetFolderPath('Startup')) 'PBK-OpenClaw-Gateway-Heartbeat.cmd'

function Ensure-LocalDir {
  New-Item -ItemType Directory -Force -Path $LocalDir | Out-Null
}

function Get-EnvValue {
  param([string]$Name)

  foreach ($scope in @('Process', 'User', 'Machine')) {
    $value = [Environment]::GetEnvironmentVariable($Name, $scope)
    if ($value) { return $value }
  }

  return ''
}

function Hydrate-EnvValue {
  param([string]$Name)

  if ([Environment]::GetEnvironmentVariable($Name, 'Process')) { return }
  $value = Get-EnvValue -Name $Name
  if ($value) {
    [Environment]::SetEnvironmentVariable($Name, $value, 'Process')
  }
}

function Ensure-RequiredEnv {
  foreach ($name in @('PBK_BRIDGE_API_KEY', 'PBK_BRIDGE_URL')) {
    Hydrate-EnvValue -Name $name
  }
  if (-not (Get-EnvValue -Name 'PBK_BRIDGE_API_KEY')) {
    throw 'PBK_BRIDGE_API_KEY is not available in Process/User/Machine environment. Heartbeat cannot authenticate to the hosted bridge.'
  }
}

function Get-HeartbeatProcess {
  if (-not (Test-Path $PidFile)) { return $null }
  $rawPid = (Get-Content $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
  $processId = 0
  if (-not [int]::TryParse($rawPid, [ref]$processId)) { return $null }
  try {
    return Get-Process -Id $processId -ErrorAction Stop
  } catch {
    return $null
  }
}

function Start-Heartbeat {
  Ensure-LocalDir
  Ensure-RequiredEnv
  if (-not (Test-Path $NodeScript)) {
    throw "Heartbeat script not found at $NodeScript"
  }

  $existing = Get-HeartbeatProcess
  if ($existing) {
    Write-Host "PBK OpenClaw heartbeat already running (pid $($existing.Id))."
    return $existing
  }

  $node = Get-Command node -ErrorAction Stop
  Remove-Item $OutLog, $ErrLog -Force -ErrorAction SilentlyContinue
  $process = Start-Process `
    -FilePath $node.Source `
    -ArgumentList @("`"$NodeScript`"") `
    -WorkingDirectory $RepoPath `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru

  $process.Id | Set-Content -Path $PidFile -Encoding ascii
  Write-Host "Started PBK OpenClaw heartbeat (pid $($process.Id))."
  return $process
}

function Stop-Heartbeat {
  $existing = Get-HeartbeatProcess
  if ($existing) {
    Stop-Process -Id $existing.Id -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped PBK OpenClaw heartbeat (pid $($existing.Id))."
  } else {
    Write-Host 'PBK OpenClaw heartbeat is not running.'
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Invoke-HeartbeatOnce {
  Ensure-RequiredEnv
  Push-Location $RepoPath
  try {
    & node $NodeScript --once
    if ($LASTEXITCODE -ne 0) {
      throw "Heartbeat once failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Get-HeartbeatStatus {
  Hydrate-EnvValue -Name 'PBK_BRIDGE_URL'
  Hydrate-EnvValue -Name 'PBK_BRIDGE_API_KEY'
  $process = Get-HeartbeatProcess
  $bridgeUrl = (Get-EnvValue -Name 'PBK_BRIDGE_URL')
  if (-not $bridgeUrl) { $bridgeUrl = 'https://pbk-openclaw-bridge.onrender.com' }
  $bridgeUrl = $bridgeUrl.TrimEnd('/')

  $hosted = $null
  $key = Get-EnvValue -Name 'PBK_BRIDGE_API_KEY'
  if ($key) {
    try {
      $hosted = Invoke-RestMethod `
        -Uri "$bridgeUrl/api/gateway/status?force=true&timeoutMs=1500" `
        -Headers @{ Authorization = "Bearer $key" } `
        -TimeoutSec 20
    } catch {
      $hosted = [pscustomobject]@{
        ok = $false
        error = $_.Exception.Message
      }
    }
  }

  [pscustomobject]@{
    running = [bool]$process
    pid = if ($process) { $process.Id } else { $null }
    pidFile = $PidFile
    outLog = $OutLog
    errLog = $ErrLog
    startupFile = $StartupFile
    startupFileExists = Test-Path $StartupFile
    hostedReady = [bool]($hosted.gateway.ready)
    heartbeatFresh = [bool]($hosted.gateway.heartbeat.fresh)
    heartbeatAgeMs = $hosted.gateway.heartbeat.ageMs
    note = $hosted.gateway.note
    error = $hosted.error
  } | ConvertTo-Json -Depth 8
}

function Install-HeartbeatTask {
  Ensure-RequiredEnv
  $scriptPath = Join-Path $RepoPath 'scripts\pbk-openclaw-heartbeat.ps1'
  $registeredTask = $false
  try {
    Import-Module ScheduledTasks -ErrorAction Stop
    $action = New-ScheduledTaskAction `
      -Execute 'powershell.exe' `
      -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" start -RepoPath `"$RepoPath`""
    $trigger = New-ScheduledTaskTrigger -AtLogOn
    $settings = New-ScheduledTaskSettingsSet `
      -AllowStartIfOnBatteries `
      -DontStopIfGoingOnBatteries `
      -StartWhenAvailable `
      -MultipleInstances IgnoreNew
    $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited

    Register-ScheduledTask `
      -TaskName $TaskName `
      -Action $action `
      -Trigger $trigger `
      -Settings $settings `
      -Principal $principal `
      -Description 'Keeps PBK hosted Render health green by pushing local OpenClaw gateway heartbeat status.' `
      -Force | Out-Null

    $registeredTask = $true
    Write-Host "Registered scheduled task $TaskName."
  } catch {
    $startupDir = Split-Path -Parent $StartupFile
    New-Item -ItemType Directory -Force -Path $startupDir | Out-Null
    @(
      '@echo off',
      "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""$scriptPath"" start -RepoPath ""$RepoPath"""
    ) | Set-Content -Path $StartupFile -Encoding ascii
    Write-Host "Scheduled task registration was unavailable; installed Startup fallback at $StartupFile"
  }

  Start-Heartbeat | Out-Null
  if (-not $registeredTask -and -not (Test-Path $StartupFile)) {
    throw 'Heartbeat startup registration failed.'
  }
}

function Uninstall-HeartbeatTask {
  Stop-Heartbeat
  Remove-Item $StartupFile -Force -ErrorAction SilentlyContinue
  try {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction Stop
    Write-Host "Unregistered scheduled task $TaskName."
  } catch {
    Write-Host "Scheduled task $TaskName was not registered."
  }
}

switch ($Command) {
  'start' { Start-Heartbeat | Out-Null }
  'stop' { Stop-Heartbeat }
  'status' { Get-HeartbeatStatus }
  'once' { Invoke-HeartbeatOnce }
  'install' { Install-HeartbeatTask }
  'uninstall' { Uninstall-HeartbeatTask }
}
