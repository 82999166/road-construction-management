$ErrorActionPreference = "Stop"
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "UTrustReadVehicleEntry.cs")
Add-Type -TypeDefinition $source -Language CSharp
[void][UTrustReadVehicleEntry]::Main()
