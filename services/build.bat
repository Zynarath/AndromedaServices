@echo off
rem Builds "Andromeda Services.exe" from services\AndromedaServices.cs with the C# compiler that
rem comes with Windows (.NET Framework 4). Nothing to install. Run with "shortcut" to also put
rem Andromeda Services on the desktop and in the Start menu. Run with "installer" to build
rem install.exe instead (from Installer.cs plus AndromedaServices.cs); it is kept in the repository.
rem Note: text inside ( ) blocks must not contain an unescaped ")" - it ends the block early.
setlocal
cd /d "%~dp0.."
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo The .NET Framework 4 C# compiler wasn't found. It comes with Windows 10 and 11;
  echo on older Windows install .NET Framework 4.8 from Microsoft and run this again.
  exit /b 1
)
set "REFS=/r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Core.dll"
if /i "%~1"=="installer" goto installer
tasklist /FI "IMAGENAME eq Andromeda Services.exe" 2>nul | find /I "Andromeda Services.exe" >nul
if not errorlevel 1 (
  echo Andromeda Services is open. Exit it first - right-click its tray icon, Stop all and exit - then run this again.
  exit /b 1
)
"%CSC%" /nologo /codepage:65001 /target:winexe /optimize+ /win32icon:services\andromeda.ico %REFS% "/out:Andromeda Services.exe" services\AndromedaServices.cs
if errorlevel 1 (
  echo Building Andromeda Services failed - see the message above.
  exit /b 1
)
echo Built "Andromeda Services.exe".
if /i not "%~1"=="shortcut" exit /b 0
powershell -NoProfile -ExecutionPolicy Bypass -Command "$w = New-Object -ComObject WScript.Shell; foreach ($d in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) { $l = $w.CreateShortcut((Join-Path $d 'Andromeda Services.lnk')); $l.TargetPath = Join-Path (Get-Location) 'Andromeda Services.exe'; $l.WorkingDirectory = (Get-Location).Path; $l.Description = 'Start and stop Andromeda Hosting and the websites'; $l.Save() }"
if errorlevel 1 (
  echo Couldn't create the shortcuts; open "Andromeda Services.exe" in this folder instead.
  exit /b 0
)
echo Added Andromeda Services to the desktop and the Start menu.
exit /b 0

:installer
"%CSC%" /nologo /codepage:65001 /target:winexe /optimize+ /define:INSTALLER /main:Andromeda.InstallerProgram /win32icon:services\andromeda.ico %REFS% /out:install.exe services\Installer.cs services\AndromedaServices.cs
if errorlevel 1 (
  echo Building install.exe failed - see the message above.
  exit /b 1
)
echo Built install.exe.
exit /b 0
