# Installs cloudflared and connects it to your Cloudflare Tunnel as a Windows service,
# so https://panel.example.com reaches Andromeda Hosting even after reboots.
# 1. Create the tunnel in the Cloudflare dashboard and copy the token (the long "eyJ..." string).
# 2. In an elevated PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\setup-cloudflare-tunnel.ps1 -Token eyJ...
param([Parameter(Mandatory = $true)][string]$Token)

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Run this as Administrator (right-click PowerShell > Run as administrator)."
  exit 1
}

function Find-Cloudflared {
  $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($p in @("$env:ProgramFiles\cloudflared\cloudflared.exe", "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe")) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

$exe = Find-Cloudflared
if (-not $exe) {
  Write-Host "Installing cloudflared with winget..."
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  $exe = Find-Cloudflared
}
if (-not $exe) {
  Write-Error "cloudflared not found. Install it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and run this again."
  exit 1
}

if (Get-Service cloudflared -ErrorAction SilentlyContinue) {
  Write-Host "Removing the existing cloudflared service first..."
  & $exe service uninstall | Out-Null
  Start-Sleep -Seconds 2
}
& $exe service install $Token
Start-Sleep -Seconds 3
Get-Service cloudflared | Format-Table Name, Status, StartType
Write-Host "Done. The tunnel should show as HEALTHY in the Cloudflare dashboard within a minute."
