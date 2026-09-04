$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "UTrustBridgeSupport.cs")
try {
  Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
  $exitCode = [int][UTrustBridgeSupport]::ReadUid()
  exit $exitCode
} catch {
  @{ success = $false; cardPresent = $false; result = "uid_reader_load_failed" } | ConvertTo-Json -Compress
  exit 1
}
