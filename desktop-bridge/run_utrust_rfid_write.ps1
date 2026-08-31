$ErrorActionPreference = "Stop"
$sourcePath = Join-Path $PSScriptRoot "UTrustNtag216RfidWrite.cs"
if (-not (Test-Path -LiteralPath $sourcePath)) { throw "writer_source_not_found" }

$source = Get-Content -Raw -LiteralPath $sourcePath
Add-Type -TypeDefinition $source -Language CSharp

# Console.WriteLine emitted by the C# program remains on stdout for the local bridge.
# The process exit code must match Main() so structured failures are never reported as success.
$exitCode = [int][UTrustNtag216RfidWrite]::Main()
exit $exitCode
