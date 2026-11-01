[CmdletBinding()]
param()

# 此脚本由双击启动器调用。以独立 -File 脚本方式运行，避免 cmd 的 -Command
# 参数在“下载/含中文目录”等路径下被 PowerShell 5.1 误解析。
$scriptPath = Join-Path $PSScriptRoot "install-utrust-bridge.ps1"
if (-not (Test-Path -LiteralPath $scriptPath)) {
  Write-Error "未找到安装脚本：$scriptPath"
  exit 2
}

$powershellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
# Start-Process 需保留显式双引号，否则路径内的空格会在提升后的进程中被拆分。
$quotedScriptPath = '"{0}"' -f $scriptPath.Replace('"', '""')
$argumentList = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $quotedScriptPath)
$process = Start-Process -FilePath $powershellPath -Verb RunAs -PassThru -Wait -ArgumentList $argumentList
exit $process.ExitCode
