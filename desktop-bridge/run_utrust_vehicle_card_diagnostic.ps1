$ErrorActionPreference = "Stop"
$source = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "UTrustVehicleCardDiagnostic.cs")
Add-Type -TypeDefinition $source -Language CSharp
[void][UTrustVehicleCardDiagnostic]::Main()
