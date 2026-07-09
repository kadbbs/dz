[CmdletBinding()]
param(
  [string]$Configuration = "Release",
  [string]$BuildDir = "build-windows",
  [string]$OutputDir = "dist",
  [string]$PackageName = "dz-windows-x64",
  [switch]$SkipArchive,
  [switch]$MoveNodeModules
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
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null
New-Item -ItemType Directory -Force -Path $staging | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $staging "bin") | Out-Null
$stagedMediasoup = Join-Path $staging "mediasoup-server"
New-Item -ItemType Directory -Force -Path $stagedMediasoup | Out-Null

Copy-Item -Path $gameExe -Destination (Join-Path $staging "bin\web_texas_webrtc.exe")
foreach ($item in @("web", "deploy", "scripts")) {
  Copy-Item -Path $item -Destination $staging -Recurse
}
foreach ($item in @("README.md", "CMakeLists.txt", "docker-compose.yml")) {
  Copy-Item -Path $item -Destination $staging
}
foreach ($item in @("package.json", "package-lock.json", "server.js")) {
  Copy-Item -Path (Join-Path "mediasoup-server" $item) -Destination $stagedMediasoup
}
$stagedNodeModules = Join-Path $stagedMediasoup "node_modules"
if ($MoveNodeModules) {
  Move-Item -Path $mediaNodeModules -Destination $stagedNodeModules
} else {
  Copy-Item -Path $mediaNodeModules -Destination $stagedNodeModules -Recurse
}

$commit = git rev-parse --short HEAD 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($commit)) {
  $commit = "unknown"
}
$builtAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

@(
  "package=$PackageName",
  "configuration=$Configuration",
  "commit=$commit",
  "built_at=$builtAt"
) | Set-Content -Encoding UTF8 (Join-Path $staging "VERSION.txt")

if (-not $SkipArchive) {
  Compress-Archive -Path $staging -DestinationPath $archive -Force
  Write-Host "Created $archive"
} else {
  Write-Host "Created $staging"
}
