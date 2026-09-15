param(
  [Parameter(Mandatory = $true)]
  [string]$CertificatePath,

  [switch]$Root,
  [switch]$TrustedPublisher
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from an elevated PowerShell window."
  }
}

function Import-OctaneCertificate {
  param(
    [string]$Path,
    [string]$StoreName
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Certificate file not found: $Path"
  }

  $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Resolve-Path -LiteralPath $Path))
  $store = [System.Security.Cryptography.X509Certificates.X509Store]::new($StoreName, "LocalMachine")
  $store.Open("ReadWrite")
  try {
    $store.Add($cert)
  } finally {
    $store.Close()
  }

  Write-Host "Installed certificate into LocalMachine\$StoreName"
  Write-Host "Subject: $($cert.Subject)"
  Write-Host "Thumbprint: $($cert.Thumbprint)"
}

Assert-Admin

if (-not $Root -and -not $TrustedPublisher) {
  $TrustedPublisher = $true
}

if ($Root) {
  Import-OctaneCertificate -Path $CertificatePath -StoreName "Root"
}

if ($TrustedPublisher) {
  Import-OctaneCertificate -Path $CertificatePath -StoreName "TrustedPublisher"
}
