[CmdletBinding()]
param(
  [int]$MinMediaPort = 40000,
  [int]$MaxMediaPort = 49999
)

$ErrorActionPreference = "Stop"

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
  throw "Run this script from an elevated PowerShell session."
}

New-NetFirewallRule -DisplayName "DZ HTTPS" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 80,443 -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "DZ mediasoup UDP" -Direction Inbound -Action Allow -Protocol UDP -LocalPort "$MinMediaPort-$MaxMediaPort" -ErrorAction SilentlyContinue | Out-Null
New-NetFirewallRule -DisplayName "DZ mediasoup TCP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort "$MinMediaPort-$MaxMediaPort" -ErrorAction SilentlyContinue | Out-Null

Write-Host "Firewall rules added for HTTPS and mediasoup media ports $MinMediaPort-$MaxMediaPort."
