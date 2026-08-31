$ErrorActionPreference = "Stop"
$source = Get-Content -Raw -Path "D:\manus\UTrustVehicleCardDiagnostic.cs"
Add-Type -TypeDefinition $source -Language CSharp
[void][UTrustVehicleCardDiagnostic]::Main()
