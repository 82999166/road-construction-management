$ErrorActionPreference = "Stop"
$source = Get-Content -Raw -Path "D:\manus\UTrustReadVehicleEntry.cs"
Add-Type -TypeDefinition $source -Language CSharp
[void][UTrustReadVehicleEntry]::Main()
