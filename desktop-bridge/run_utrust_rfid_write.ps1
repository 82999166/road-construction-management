$ErrorActionPreference = "Stop"
$sourcePath = Join-Path $PSScriptRoot "UTrustNtag216RfidWrite.cs"
$wrapperVersion = "utrust-writer-wrapper-diagnostic-v3"
$stage = "load_writer"
try {
  if (-not (Test-Path -LiteralPath $sourcePath)) { throw "writer_source_not_found" }
  $source = Get-Content -Raw -LiteralPath $sourcePath
  Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop

  # Console.WriteLine emitted by the C# program remains on stdout for the local bridge.
  # The process exit code must match Main() so structured failures are never reported as success.
  $stage = "execute_writer"
  $exitCode = [int][UTrustNtag216RfidWrite]::Main()
  exit $exitCode
}
catch {
  $safeResult = if (-not (Test-Path -LiteralPath $sourcePath)) { "writer_source_not_found" } elseif ($stage -eq "load_writer") { "writer_load_failed" } else { "writer_invocation_failed" }
  @{ success = $false; written = $false; verified = $false; committed = $false; wrapperVersion = $wrapperVersion; writerVersion = "unknown"; failedPage = -1; stage = $stage; result = $safeResult } | ConvertTo-Json -Compress
  exit 1
}
