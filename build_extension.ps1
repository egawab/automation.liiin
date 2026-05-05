$ext = 'c:\Users\lenovo\Downloads\clonelink\extension'
$zip = 'c:\Users\lenovo\Downloads\clonelink\LinkedInExtension.zip'

if (Test-Path $zip) { Remove-Item $zip -Force }

$files = @(
  'manifest.json','background.js','content.js','popup.html','popup.js',
  'dashboard-bridge.js','icon-48.png',
  'interceptor.js','fiberSpy.js','postScraper.js',
  'src\config.js','src\logger.js','src\layout-detector.js',
  'src\dom-adapter.js','src\extractor.js','src\filter.js',
  'src\transport.js','src\observer.js','src\interceptor.js','src\core-engine.js'
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zipObj = [System.IO.Compression.ZipFile]::Open($zip, 'Create')

foreach ($f in $files) {
  $full = Join-Path $ext $f
  if (Test-Path $full) {
    $entry = $f.Replace('\','/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zipObj, $full, $entry) | Out-Null
    Write-Host "Added: $entry"
  } else {
    Write-Host "MISSING: $f" -ForegroundColor Red
  }
}

$zipObj.Dispose()
Write-Host ""
Write-Host "Done. Size: $(([math]::Round((Get-Item $zip).Length / 1KB, 1))) KB"
