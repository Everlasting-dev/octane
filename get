# Download the latest Octane installer, install it, then delete the setup files.
$ErrorActionPreference = 'Stop'
$repo = 'Everlasting-dev/octane'
$dir = Join-Path $env:TEMP 'octane-setup'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$setupPath = Join-Path $dir 'Octane-Setup.exe'

try {
  $release = Invoke-RestMethod -Headers @{ 'User-Agent' = 'octane-download' } -Uri "https://api.github.com/repos/$repo/releases/latest"
  $setup = $release.assets | Where-Object { $_.name -like 'Octane-Setup-*.exe' } | Select-Object -First 1
  if (-not $setup) { throw 'No Octane installer is attached to the latest release.' }

  Write-Host "Downloading $($setup.name)..."
  Invoke-WebRequest -Uri $setup.browser_download_url -OutFile $setupPath

  Write-Host 'Installing Octane...'
  $proc = Start-Process -FilePath $setupPath -ArgumentList '/S' -Wait -PassThru
  if ($proc.ExitCode -ne 0) { throw "Installer exited with code $($proc.ExitCode)." }
  Write-Host 'Octane installed.'
}
finally {
  if (Test-Path -LiteralPath $dir) {
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
