$ErrorActionPreference = "Stop"
$sourcePath = Join-Path $PSScriptRoot "UTrustNtag216EraseInitial.cs"
$wrapperVersion = "utrust-erase-initial-wrapper-v1"
$stage = "load_eraser"
try {
  if (-not (Test-Path -LiteralPath $sourcePath)) { throw "eraser_source_not_found" }
  $source = Get-Content -Raw -LiteralPath $sourcePath
  Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop

  # C# emits one JSON result to stdout and independently checks both environment
  # guards before opening PC/SC. Never set/derive the destructive authorization here.
  $stage = "execute_eraser"
  $exitCode = [int][UTrustNtag216EraseInitial]::Main()
  exit $exitCode
}
catch {
  $safeResult = if (-not (Test-Path -LiteralPath $sourcePath)) { "eraser_source_not_found" } elseif ($stage -eq "load_eraser") { "eraser_load_failed" } else { "eraser_invocation_failed" }
  @{ success = $false; erased = $false; verified = $false; initialNdef = $false; writeProtectionChanged = $false; cardUidFingerprint = ""; writerVersion = "unknown"; wrapperVersion = $wrapperVersion; writeAttempted = $false; failedPage = -1; stage = $stage; result = $safeResult } | ConvertTo-Json -Compress
  exit 1
}
