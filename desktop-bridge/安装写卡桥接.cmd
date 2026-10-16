@echo off
setlocal EnableExtensions
title 悦信云智管 - 写卡桥接安装

set "SCRIPT=%~dp0install-utrust-bridge.ps1"
if not exist "%SCRIPT%" (
  echo.
  echo 未找到安装脚本：install-utrust-bridge.ps1
  echo 请确保本文件与安装脚本位于同一解压目录后再运行。
  echo.
  pause
  exit /b 1
)

echo.
echo 正在请求管理员权限安装悦信云智管写卡桥接，请在弹出的系统窗口选择“是”。
echo 安装完成后，本窗口会显示安装结果。
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$scriptPath = $args[0]; $powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'; $process = Start-Process -FilePath $powershellPath -Verb RunAs -PassThru -Wait -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File `"{0}`"' -f $scriptPath); exit $process.ExitCode" "%SCRIPT%"
set "RESULT=%ERRORLEVEL%"

echo.
if "%RESULT%"=="0" (
  echo 安装已完成。请返回悦信云智管后台，刷新“运输管理 - 车辆射频卡”页面后继续操作。
) else (
  echo 安装未完成，退出代码：%RESULT%。请确认已在系统弹窗中选择“是”，并将本窗口截图发送给管理员。
)
echo.
pause
exit /b %RESULT%
