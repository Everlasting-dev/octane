# Download the latest official Octane Windows installer and its license, then start setup.
$ErrorActionPreference = 'Stop'
$repo = 'Everlasting-dev/octane'
$dest = Join-Path $env:USERPROFILE 'Downloads'
New-Item -ItemType Directory -Force -Path $dest | Out-Null

$release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'octane-download' } -Uri "https://api.github.com/repos/$repo/releases/latest"
$setup = $release.assets | Where-Object { $_.name -like 'Octane-Setup-*.exe' } | Select-Object -First 1
if (-not $setup) { throw "No Octane installer is attached to the latest release." }

$setupPath = Join-Path $dest $setup.name
Write-Host "Downloading $($setup.name)..."
Invoke-WebRequest -Uri $setup.browser_download_url -OutFile $setupPath

$license = $release.assets | Where-Object { $_.name -eq 'LICENSE' } | Select-Object -First 1
if ($license) {
  $licensePath = Join-Path $dest 'Octane-LICENSE.txt'
  Invoke-WebRequest -Uri $license.browser_download_url -OutFile $licensePath
  Write-Host "License saved to $licensePath"
}

Write-Host "Installer saved to $setupPath"
Start-Process -FilePath $setupPath
