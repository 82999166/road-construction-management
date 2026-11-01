@echo off
setlocal EnableExtensions
title 悦信云智管 - 写卡桥接安装

set "LAUNCHER=%~dp0elevate-utrust-installer.ps1"
set "SCRIPT=%~dp0install-utrust-bridge.ps1"
if not exist "%LAUNCHER%" (
  echo.
  echo 未找到管理员启动脚本：elevate-utrust-installer.ps1
  echo 请重新解压完整安装包后再运行。
  echo.
  pause
  exit /b 1
)
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

rem 用 -File 启动独立辅助脚本，而非用 -Command 传递下载目录路径。
rem 这可兼容含中文、空格或括号的下载目录，避免 PowerShell 5.1 将路径当作命令解析。
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LAUNCHER%"
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
