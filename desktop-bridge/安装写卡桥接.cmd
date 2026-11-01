@echo off
setlocal DisableDelayedExpansion
title Yuexin RFID Bridge Setup

set "LAUNCHER=%~dp0elevate-utrust-installer.ps1"
set "INSTALLER=%~dp0install-utrust-bridge.ps1"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if not exist "%POWERSHELL_EXE%" (
  echo Windows PowerShell was not found.
  echo Please contact the system administrator.
  pause
  exit /b 2
)

if not exist "%LAUNCHER%" (
  echo Missing elevate-utrust-installer.ps1.
  echo Extract the complete ZIP package, then run this file again.
  pause
  exit /b 2
)

if not exist "%INSTALLER%" (
  echo Missing install-utrust-bridge.ps1.
  echo Keep this launcher and the installer in the same extracted folder.
  pause
  exit /b 2
)

echo.
echo Requesting administrator permission for the Yuexin RFID bridge.
echo Select Yes in the Windows permission dialog.
echo.

"%POWERSHELL_EXE%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%"
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
  echo Installation completed. Return to Yuexin Cloud Management and refresh the RFID card page.
) else (
  echo Installation did not complete. Exit code: %RESULT%.
  echo Capture this window and send it to the administrator.
)
echo.
pause
exit /b %RESULT%
