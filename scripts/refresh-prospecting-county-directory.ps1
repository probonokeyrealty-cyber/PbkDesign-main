$ErrorActionPreference = 'Stop'
$source = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2025_Gazetteer/2025_Gaz_counties_national.zip'
Add-Type -AssemblyName System.IO.Compression
$client = [System.Net.WebClient]::new()
try { $bytes = $client.DownloadData($source) } finally { $client.Dispose() }
$stream = [System.IO.MemoryStream]::new($bytes)
$archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read)
try {
    $entries = @($archive.Entries | Where-Object Name -like '*.txt')
    if ($entries.Count -ne 1) { throw 'Unexpected Census archive layout.' }
    $reader = [System.IO.StreamReader]::new($entries[0].Open())
    try {
        $header = $reader.ReadLine()
        $separator = if ($header.Contains('|')) { '\|' } else { '\t' }
        $fields = @($header -split $separator | ForEach-Object { $_.Trim() })
        $state = [Array]::IndexOf($fields, 'USPS')
        $id = [Array]::IndexOf($fields, 'GEOID')
        $name = [Array]::IndexOf($fields, 'NAME')
        if ([Math]::Min($state, [Math]::Min($id, $name)) -lt 0) { throw 'Unexpected Census fields.' }
        $rows = @(
            while ($null -ne ($line = $reader.ReadLine())) {
                if (-not $line.Trim()) { continue }
                $parts = $line -split $separator
                $fips = $parts[$id].Trim()
                $abbr = $parts[$state].Trim()
                $label = $parts[$name].Trim()
                if ($fips -notmatch '^\d{5}$' -or $abbr -notmatch '^[A-Z]{2}$' -or -not $label -or $label.Contains([char]0xFFFD)) {
                    throw 'Invalid county record in the Census Gazetteer.'
                }
                [pscustomobject]@{fips=$fips; state=$abbr; name=$label}
            }
        )
        if ($rows.Count -lt 3200 -or @($rows.fips | Sort-Object -Unique).Count -ne $rows.Count) {
            throw 'County directory is incomplete or contains duplicate FIPS codes.'
        }
        $lines = @($rows | Sort-Object fips | ForEach-Object { '  ' + ($_ | ConvertTo-Json -Compress) })
        $output = "[`n" + ($lines -join ",`n") + "`n]`n"
        $path = Join-Path $PSScriptRoot '../src/app/utils/prospectingCounties2025.json'
        [System.IO.File]::WriteAllText($path, $output, [System.Text.UTF8Encoding]::new($false))
        "Updated $($rows.Count) county records."
    } finally { $reader.Dispose() }
} finally { $archive.Dispose() }
