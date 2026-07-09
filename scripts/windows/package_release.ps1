[CmdletBinding()]
param(
  [string]$Configuration = "Release",
  [string]$BuildDir = "build-windows",
  [string]$OutputDir = "dist",
  [string]$PackageName = "dz-windows-x64"
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\dz_common.ps1"

$root = Get-DzRoot
Set-Location $root

$gameExe = Resolve-DzGameExe -BuildDir $BuildDir -Configuration $Configuration
$mediaNodeModules = Join-Path $root "mediasoup-server\node_modules"
if (-not (Test-Path $mediaNodeModules)) {
  throw "Missing mediasoup-server\node_modules. Run npm ci --omit=dev in mediasoup-server first."
}

$outputPath = Resolve-DzPath $OutputDir
$staging = Join-Path $outputPath $PackageName
$archive = Join-Path $outputPath "$PackageName.zip"

Remove-Item -Path @($staging, $archive) -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $staging "bin") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $staging "mediasoup-server") | Out-Null

Copy-Item -Path $gameExe -Destination (Join-Path $staging "bin\web_texas_webrtc.exe")
foreach ($item in @("web", "deploy", "scripts")) {
  Copy-Item -Path $item -Destination $staging -Recurse
}
foreach ($item in @("README.md", "CMakeLists.txt", "docker-compose.yml")) {
  Copy-Item -Path $item -Destination $staging
}
foreach ($item in @("package.json", "package-lock.json", "server.js")) {
  Copy-Item -Path (Join-Path "mediasoup-server" $item) -Destination (Join-Path $staging "mediasoup-server")
}
Copy-Item -Path $mediaNodeModules -Destination (Join-Path $staging "mediasoup-server\node_modules") -Recurse

$commit = try {
  git rev-parse --short HEAD
} catch {
  "unknown"
}

@(
  "package=$PackageName",
  "configuration=$Configuration",
  "commit=$commit",
  "built_at=$((Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"))"
) | Set-Content -Encoding UTF8 (Join-Path $staging "VERSION.txt")

Compress-Archive -Path $staging -DestinationPath $archive -Force
Write-Host "Created $archive"
