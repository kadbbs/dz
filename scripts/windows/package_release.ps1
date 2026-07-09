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

Remove-Item $staging, $archive -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $staging "bin") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $staging "mediasoup-server") | Out-Null

Copy-Item $gameExe (Join-Path $staging "bin\web_texas_webrtc.exe")
Copy-Item "web", "deploy", "scripts" $staging -Recurse
Copy-Item "README.md", "CMakeLists.txt", "docker-compose.yml" $staging
Copy-Item "mediasoup-server\package.json", "mediasoup-server\package-lock.json", "mediasoup-server\server.js" (Join-Path $staging "mediasoup-server")
Copy-Item $mediaNodeModules (Join-Path $staging "mediasoup-server\node_modules") -Recurse

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
