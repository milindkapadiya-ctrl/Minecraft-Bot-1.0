param([Parameter(Mandatory=$true)][string]$VideoPath, [Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$video=(Resolve-Path -LiteralPath $VideoPath).Path
if(Test-Path -LiteralPath $OutputDirectory){throw 'Decoder output directory must be new'}
$before=Get-Item -LiteralPath $video
Add-Type -Path (Join-Path $PSScriptRoot 'windows-video-decode.cs')
$result=[WindowsVideoDecode]::Decode($video,[System.IO.Path]::GetFullPath($OutputDirectory))
$after=Get-Item -LiteralPath $video
if($before.Length -ne $after.Length -or $before.LastWriteTimeUtc -ne $after.LastWriteTimeUtc){throw 'Video changed during decode'}
$distinct=@($result.Samples | Where-Object Nonblank | Select-Object -ExpandProperty Sha256 -Unique)
$report=[ordered]@{utc=[DateTime]::UtcNow.ToString('o');videoPath=$video;bytes=$after.Length;sha256=(Get-FileHash -LiteralPath $video).Hash.ToLowerInvariant();decoder=$result;changingNonblankSamples=($distinct.Count -ge 2);humanReviewed=$false}
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $OutputDirectory 'decode-report.json')
$report | ConvertTo-Json -Depth 6
if(!$report.changingNonblankSamples){exit 2}
