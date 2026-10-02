# win-ocr.ps1 - Windows.Media.Ocr CLI wrapper (JTT table image OCR, geometric output)
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File win-ocr.ps1 -Path <image> [-Lang zh-Hans-CN]
# Output: single-line JSON: { lines: [ { t: text, x, y, w, h, words: [ { t, x, y, w, h } ] } ] }
# Geometry enables table reconstruction (column-wise OCR blobs are unusable as plain text).
# NOTE: ASCII-only on purpose - PowerShell 5.1 mis-parses BOM-less UTF-8 with CJK comments.
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Lang = "zh-Hans-CN"
)
$ErrorActionPreference = "Stop"

# Force UTF-8 stdout: PS 5.1 defaults to the OEM codepage (GBK on zh-CN Windows) when
# redirected, which node would decode as mojibake - all CJK labels would be lost.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream,Windows.Foundation,ContentType=WindowsRuntime]
$null = [Windows.Globalization.Language,Windows.Foundation,ContentType=WindowsRuntime]

# WinRT IAsyncOperation -> sync wait (standard PowerShell/WinRT bridge)
$global:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
        $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
function Await($WinRtTask, $ResultType) {
    $asTaskGeneric = $global:asTask.MakeGenericMethod($ResultType)
    $netTask = $asTaskGeneric.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    $netTask.Result
}

$language = New-Object Windows.Globalization.Language($Lang)
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
if (-not $engine) {
    Write-Error "OCR language $Lang unavailable (check Windows language packs)"
    exit 2
}

$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$out = New-Object System.Collections.ArrayList
foreach ($line in $result.Lines) {
    $words = New-Object System.Collections.ArrayList
    foreach ($wd in $line.Words) {
        $null = $words.Add(@{
            t = $wd.Text
            x = $wd.BoundingRect.X
            y = $wd.BoundingRect.Y
            w = $wd.BoundingRect.Width
            h = $wd.BoundingRect.Height
        })
    }
    $null = $out.Add(@{
        t = $line.Text
        x = $line.BoundingRect.X
        y = $line.BoundingRect.Y
        w = $line.BoundingRect.Width
        h = $line.BoundingRect.Height
        words = $words
    })
}
ConvertTo-Json -Depth 4 -InputObject @{ lines = $out } -Compress
