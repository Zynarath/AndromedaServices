# Makes your game domain (e.g. play.example.com) point to THIS PC, on this PC only.
# Why: most home routers can't connect from inside your network back to your own public IP
# ("NAT loopback"). Friends on the internet are unaffected; they keep using your public IP.
# With this, you can use the exact same address/client as your friends (WoW realmlist, Minecraft, CoD...).
#
# Run in an elevated PowerShell (right-click > Run as administrator):
#   powershell -ExecutionPolicy Bypass -File scripts\use-domain-on-this-pc.ps1 -Hostname play.example.com
# Undo:
#   powershell -ExecutionPolicy Bypass -File scripts\use-domain-on-this-pc.ps1 -Hostname play.example.com -Remove
param(
  [Parameter(Mandatory = $true)][string]$Hostname,
  [switch]$Remove
)
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Error "Run this as Administrator (right-click PowerShell > Run as administrator)."
  exit 1
}
if ($Hostname -notmatch '^[A-Za-z0-9.-]+$') { Write-Error "Not a valid hostname: $Hostname"; exit 1 }
$hosts = "$env:SystemRoot\System32\drivers\etc\hosts"
$marker = "# Andromeda Hosting"
$lines = Get-Content $hosts -ErrorAction SilentlyContinue | Where-Object { -not ($_ -match "\s$([regex]::Escape($Hostname))\s+$marker$") }
if (-not $Remove) { $lines += "127.0.0.1 $Hostname $marker" }
Set-Content -Path $hosts -Value $lines -Encoding ASCII
ipconfig /flushdns | Out-Null
if ($Remove) { Write-Host "$Hostname no longer points to this PC." }
else { Write-Host "$Hostname now points to this PC (127.0.0.1) on this computer only. Test: ping $Hostname" }
