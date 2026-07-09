[CmdletBinding()]
param(
  [string]$EnvFile = "deploy/windows/dz.windows.env",
  [string]$Configuration = "Release",
  [string]$BuildDir = "build-windows"
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  throw "Run this script from an elevated PowerShell session."
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$envPath = if ([IO.Path]::IsPathRooted($EnvFile)) { $EnvFile } else { Join-Path $root $EnvFile }
$buildPath = if ([IO.Path]::IsPathRooted($BuildDir)) { $BuildDir } else { Join-Path $root $BuildDir }
$pwsh = (Get-Command pwsh -ErrorAction SilentlyContinue)
if (-not $pwsh) {
  $pwsh = Get-Command powershell -ErrorAction Stop
}

$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest

function Register-DzTask {
  param(
    [string]$Name,
    [string]$Script,
    [string[]]$ExtraArgs = @()
  )

  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$root\scripts\windows\$Script`"",
    "-EnvFile", "`"$envPath`""
  ) + $ExtraArgs

  $action = New-ScheduledTaskAction -Execute $pwsh.Source -Argument ($args -join " ") -WorkingDirectory $root
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
}

Register-DzTask -Name "DZ Game" -Script "start_game.ps1" -ExtraArgs @(
  "-Configuration", $Configuration,
  "-BuildDir", "`"$buildPath`""
)
Register-DzTask -Name "DZ Mediasoup" -Script "start_mediasoup.ps1"
Register-DzTask -Name "DZ Caddy" -Script "start_caddy.ps1"

Write-Host "Registered startup tasks: DZ Game, DZ Mediasoup, DZ Caddy."
Write-Host "Start now with: Start-ScheduledTask -TaskName 'DZ Game'; Start-ScheduledTask -TaskName 'DZ Mediasoup'; Start-ScheduledTask -TaskName 'DZ Caddy'"
