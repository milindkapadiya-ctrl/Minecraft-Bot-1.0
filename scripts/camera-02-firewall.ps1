param([ValidateSet('Install', 'Inspect', 'Rollback')][string]$Action = 'Inspect')
$ErrorActionPreference = 'Stop'
$ruleName = 'MCBOT-CAMERA-02-OBS-4457-Remote-Deny'
$obsExecutable = Join-Path $env:LOCALAPPDATA 'MCBotCamera\OBS-33.0.1-arm64\bin\64bit\obs64.exe'
$expectedHash = '6C59965304BF33B5803E992E9FF835EEDE7EFD5FA9AA4432A97BDE32EFE999B4'
$reportPath = Join-Path $PSScriptRoot '..\output\camera-02\firewall-result.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $reportPath) -Force | Out-Null
$report = [ordered]@{ utc = [DateTime]::UtcNow.ToString('o'); action = $Action; ruleName = $ruleName; success = $false; created = $false }
try {
    if ((Get-FileHash -LiteralPath $obsExecutable -Algorithm SHA256).Hash -ne $expectedHash) { throw 'OBS executable hash mismatch' }
    if ((Get-AuthenticodeSignature -LiteralPath $obsExecutable).Status -ne 'Valid') { throw 'OBS signature is not valid' }
    $profiles = @(Get-NetFirewallProfile -PolicyStore ActiveStore)
    if ($profiles.Count -ne 3 -or @($profiles | Where-Object { $_.Enabled -ne 'True' -or $_.AllowLocalFirewallRules -eq 'False' }).Count) { throw 'Firewall profile enforcement unavailable' }
    $existing = Get-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -ErrorAction SilentlyContinue
    if ($Action -eq 'Install') {
        if ($existing) { throw 'Rule already exists; inspect instead of replacing it' }
        New-NetFirewallRule -PolicyStore PersistentStore -Name $ruleName -DisplayName $ruleName -Description 'MCBOT-CAMERA-02: block non-loopback IPv4 control traffic for verified portable OBS only; requires verified IPv4-only OBS launch.' -Enabled True -Direction Inbound -Action Block -Profile Any -Program $obsExecutable -Protocol TCP -LocalPort 4457 -RemoteAddress '0.0.0.1-126.255.255.255','128.0.0.0-255.255.255.255' -EdgeTraversalPolicy Block | Out-Null
        $report.created = $true
    } elseif ($Action -eq 'Rollback') {
        # Stop OBS and disable its WebSocket configuration before removing protection.
        if (Get-Process -Name obs64 -ErrorAction SilentlyContinue) { throw 'Stop OBS normally before rollback' }
        $configPath = Join-Path $env:LOCALAPPDATA 'MCBotCamera\OBS-33.0.1-arm64\config\obs-studio\plugin_config\obs-websocket\config.json'
        $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
        if ($config.server_enabled -ne $false) { throw 'Disable WebSocket before rollback' }
        if (!$existing) { throw 'Named rule is absent; nothing to remove' }
        $app = $existing | Get-NetFirewallApplicationFilter
        $port = $existing | Get-NetFirewallPortFilter
        if ($app.Program -ne $obsExecutable -or $port.LocalPort -ne '4457' -or $existing.Action -ne 'Block') { throw 'Rule scope mismatch; refusing rollback' }
        $existing | Remove-NetFirewallRule
    }
    $effective = Get-NetFirewallRule -PolicyStore ActiveStore -Name $ruleName -ErrorAction SilentlyContinue
    if ($Action -ne 'Rollback' -and !$effective) { throw 'Rule absent from effective policy' }
    $report.profiles = @($profiles | Select-Object Name,Enabled,DefaultInboundAction,AllowLocalFirewallRules)
    if ($effective) {
        $report.rule = $effective | Select-Object Name,Enabled,Direction,Action,Profile,EnforcementStatus,PrimaryStatus,PolicyStoreSourceType
        $report.application = $effective | Get-NetFirewallApplicationFilter | Select-Object Program
        $report.port = $effective | Get-NetFirewallPortFilter | Select-Object Protocol,LocalPort,RemotePort
        $report.address = $effective | Get-NetFirewallAddressFilter | Select-Object LocalAddress,RemoteAddress
    }
    $report.success = $true
} catch {
    $report.error = $_.Exception.Message
} finally {
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath
}
if (!$report.success) { exit 1 }
