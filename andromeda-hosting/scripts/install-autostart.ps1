# Starts Andromeda Hosting automatically when you log in to Windows (minimized window).
# Run:  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
# Remove: Unregister-ScheduledTask -TaskName Andromeda Hosting -Confirm:$false
$root = Split-Path -Parent $PSScriptRoot
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c start `"Andromeda Hosting`" /min `"$root\start.bat`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit 0
Register-ScheduledTask -TaskName "Andromeda Hosting" -Action $action -Trigger $trigger -Settings $settings -Description "Andromeda Hosting game server panel" -Force | Out-Null
Write-Host "Andromeda Hosting will now start when $env:USERNAME logs in."
