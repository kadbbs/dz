[CmdletBinding()]
param(
  [string]$EnvFile = "deploy/windows/dz.windows.env"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\dz_common.ps1"

$root = Get-DzRoot
Set-Location $root
Import-DzEnv $EnvFile
Set-DzDefaultEnv

Set-Location (Join-Path $root "mediasoup-server")
node server.js
