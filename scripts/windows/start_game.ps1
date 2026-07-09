[CmdletBinding()]
param(
  [string]$EnvFile = "deploy/windows/dz.windows.env",
  [string]$Configuration = "Release",
  [string]$BuildDir = "build-windows"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\dz_common.ps1"

$root = Get-DzRoot
Set-Location $root
Import-DzEnv $EnvFile
Set-DzDefaultEnv

$gameExe = Resolve-DzGameExe -BuildDir $BuildDir -Configuration $Configuration

& $gameExe $env:DZ_LISTEN_HOST $env:DZ_WEB_PORT
