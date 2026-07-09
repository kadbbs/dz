function Import-DzEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) {
    Write-Warning "Env file not found: $Path. Using current process environment."
    return
  }

  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) { return }
    $parts = $line -split "=", 2
    if ($parts.Length -ne 2) { return }
    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
  }
}

function Set-DzDefaultEnv {
  if (-not $env:DZ_LISTEN_HOST) { $env:DZ_LISTEN_HOST = "::1" }
  if (-not $env:DZ_WEB_PORT) { $env:DZ_WEB_PORT = "8080" }
  if (-not $env:MEDIASOUP_SIGNAL_HOST) { $env:MEDIASOUP_SIGNAL_HOST = "::1" }
  if (-not $env:MEDIASOUP_SIGNAL_PORT) { $env:MEDIASOUP_SIGNAL_PORT = "3001" }
  if (-not $env:MEDIASOUP_MIN_PORT) { $env:MEDIASOUP_MIN_PORT = "40000" }
  if (-not $env:MEDIASOUP_MAX_PORT) { $env:MEDIASOUP_MAX_PORT = "49999" }
}

function Get-DzRoot {
  return (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

function Resolve-DzPath {
  param([string]$Path)
  if ([IO.Path]::IsPathRooted($Path)) {
    return $Path
  }
  return (Join-Path (Get-DzRoot) $Path)
}

function Resolve-DzGameExe {
  param(
    [string]$BuildDir = "build-windows",
    [string]$Configuration = "Release"
  )

  $root = Get-DzRoot
  $buildPath = Resolve-DzPath $BuildDir
  $candidates = @(
    (Join-Path $buildPath "$Configuration\web_texas_webrtc.exe"),
    (Join-Path $root "bin\web_texas_webrtc.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return (Resolve-Path $candidate).Path
    }
  }

  throw "Missing web_texas_webrtc.exe. Run scripts/windows/build_native.ps1 first, or use a packaged release with bin\web_texas_webrtc.exe."
}
