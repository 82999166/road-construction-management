$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "UTrustBridgeSupport.cs")
try {
  Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
  $exitCode = [int][UTrustBridgeSupport]::Probe()
  exit $exitCode
} catch {
  @{ success = $false; SmartCardService = "unavailable"; Readers = @(); result = "reader_probe_load_failed" } | ConvertTo-Json -Compress
  exit 1
}
