[CmdletBinding()]
param(
  [string]$EnvFile = "deploy/windows/dz.windows.env",
  [string]$Configuration = "Release",
  [string]$BuildDir = "build-windows",
  [switch]$NoCaddy
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\dz_common.ps1"

Import-DzEnv $EnvFile
Set-DzDefaultEnv

$gameExe = Resolve-DzGameExe -BuildDir $BuildDir -Configuration $Configuration

$game = Start-Process -FilePath $gameExe `
  -ArgumentList @($env:DZ_LISTEN_HOST, $env:DZ_WEB_PORT) `
  -PassThru

$media = Start-Process -FilePath "node" `
  -ArgumentList @("server.js") `
  -WorkingDirectory (Resolve-Path "mediasoup-server") `
  -PassThru

Write-Host "Started C++ game service PID=$($game.Id) on [$env:DZ_LISTEN_HOST]:$env:DZ_WEB_PORT"
Write-Host "Started mediasoup service PID=$($media.Id) on [$env:MEDIASOUP_SIGNAL_HOST]:$env:MEDIASOUP_SIGNAL_PORT"

if (-not $NoCaddy) {
  $caddy = Get-Command caddy -ErrorAction SilentlyContinue
  if ($caddy) {
    $caddyProcess = Start-Process -FilePath $caddy.Source `
      -ArgumentList @("run", "--config", "deploy/caddy/Caddyfile.windows") `
      -PassThru
    Write-Host "Started Caddy PID=$($caddyProcess.Id)"
  } else {
    Write-Warning "Caddy not found. Install Caddy or rerun with -NoCaddy for local HTTP-only testing."
  }
}
