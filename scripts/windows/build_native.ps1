[CmdletBinding()]
param(
  [string]$Configuration = "Release",
  [string]$BuildDir = "build-windows",
  [string]$Generator = "Visual Studio 17 2022",
  [string]$Platform = "x64",
  [string]$VcpkgRoot = "$env:USERPROFILE\vcpkg",
  [string]$VcpkgTriplet = "x64-windows-static",
  [switch]$SkipMediasoupInstall
)

$ErrorActionPreference = "Stop"
if ($PSVersionTable.PSVersion.Major -ge 7) {
  $PSNativeCommandUseErrorActionPreference = $true
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing command '$Name'. Install it and retry."
  }
}

Require-Command cmake
Require-Command git

if (-not $SkipMediasoupInstall) {
  Require-Command node
  Require-Command npm

  $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]") | Select-Object -First 1)
  if ($nodeMajor -lt 22) {
    throw "Node.js 22+ is required for mediasoup. Current major version: $nodeMajor"
  }
}

if (-not (Test-Path (Join-Path $VcpkgRoot "vcpkg.exe"))) {
  git clone https://github.com/microsoft/vcpkg.git $VcpkgRoot
  & (Join-Path $VcpkgRoot "bootstrap-vcpkg.bat")
}

$vcpkgExe = Join-Path $VcpkgRoot "vcpkg.exe"
& $vcpkgExe install "boost-system:$VcpkgTriplet"

$toolchain = Join-Path $VcpkgRoot "scripts\buildsystems\vcpkg.cmake"
$webRoot = (Resolve-Path "web").Path.Replace("\", "/")

cmake -S . -B $BuildDir -G $Generator -A $Platform `
  -DCMAKE_TOOLCHAIN_FILE="$toolchain" `
  -DVCPKG_TARGET_TRIPLET="$VcpkgTriplet" `
  -DWEB_ROOT_PATH="$webRoot"
cmake --build $BuildDir --config $Configuration

if (-not $SkipMediasoupInstall) {
  Push-Location mediasoup-server
  try {
    npm ci --omit=dev
  } finally {
    Pop-Location
  }
}

$builtExe = Get-ChildItem -Path $BuildDir -Recurse -Filter "web_texas_webrtc.exe" -File |
  Select-Object -First 1
if (-not $builtExe) {
  throw "Build finished but web_texas_webrtc.exe was not found under $BuildDir."
}
Write-Host "Windows native build finished: $($builtExe.FullName)"
