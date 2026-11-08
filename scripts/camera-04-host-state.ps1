param([Parameter(Mandatory=$true)][string]$ObsRoot)
$ErrorActionPreference='Stop'
# Read-only host evidence. No UI automation, launch, termination or configuration writes.
$expected=Join-Path $ObsRoot 'bin\64bit\obs64.exe'
$processes=@(Get-CimInstance Win32_Process -Filter "Name='obs64.exe'" | ForEach-Object {
    $owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner
    [ordered]@{pid=$_.ProcessId;createdUtc=$_.CreationDate.ToUniversalTime().ToString('o');executable=$_.ExecutablePath;owner=($owner.Domain+'\'+$owner.User)}
})
$config=Get-Content -LiteralPath (Join-Path $ObsRoot 'config\obs-studio\plugin_config\obs-websocket\config.json') -Raw | ConvertFrom-Json
$listeners=@(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(4455,4457) -or $_.OwningProcess -in @($processes | ForEach-Object {$_.pid}) })
$scenePath=Join-Path $ObsRoot 'config\obs-studio\basic\scenes\Untitled.json'
$scene=Get-Content -LiteralPath $scenePath -Raw | ConvertFrom-Json
$capture=@($scene.sources | Where-Object id -eq 'window_capture')
$audio=@($scene.sources | Where-Object { $_.id -like 'wasapi*' })
$audio+=@($scene.DesktopAudioDevice1,$scene.AuxAudioDevice1 | Where-Object {$null -ne $_})
[ordered]@{observedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();processes=$processes;exeHash=(Get-FileHash -LiteralPath $expected).Hash.ToLowerInvariant();webSocketEnabled=$config.server_enabled;authenticationRequired=$config.auth_required;controlListeners=$listeners.Count;captures=$capture;audio=$audio;sceneHash=(Get-FileHash -LiteralPath $scenePath).Hash.ToLowerInvariant()} | ConvertTo-Json -Depth 12
