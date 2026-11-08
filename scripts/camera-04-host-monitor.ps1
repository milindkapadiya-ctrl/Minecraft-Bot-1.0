param([Parameter(Mandatory=$true)][string]$ObsRoot,[Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference='Stop'
$destination=(Resolve-Path -LiteralPath $EvidenceDirectory).Path
$deadline=[DateTime]::UtcNow.AddMinutes(10)
$stop=Join-Path $destination 'host-monitor.stop'
$snapshot=Join-Path $destination 'host-state.json'
$temporary=Join-Path $destination 'host-state.pending'
while([DateTime]::UtcNow -lt $deadline -and !(Test-Path -LiteralPath $stop)) {
    & (Join-Path $PSScriptRoot 'camera-04-host-state.ps1') -ObsRoot $ObsRoot | Set-Content -LiteralPath $temporary
    Move-Item -LiteralPath $temporary -Destination $snapshot -Force
    Start-Sleep -Milliseconds 1000
}
'Read-only host monitor exited normally'
