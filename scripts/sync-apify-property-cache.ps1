param(
  [Parameter(Mandatory)][ValidatePattern('^[0-9]{5}$')][string]$Zip,
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9]+$')][string]$DatasetId,
  [Parameter(Mandatory)][DateTimeOffset]$CapturedAt,
  [string]$CsvPath,
  [string]$DatasetJsonPath,
  [string]$AddressReferenceCsv,
  [string]$BridgeUrl = $env:PBK_BRIDGE_URL,
  [switch]$KeepExistingAtCapacity,
  [switch]$ExistingDatasetOnly,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$source = 'apify-for-sale'
$capacity = 320
$suffixes = @{drive='dr';road='rd';avenue='ave';street='st';place='pl';court='ct';lane='ln';boulevard='blvd';terrace='ter';circle='cir';trail='trl';parkway='pkwy';north='n';south='s';east='e';west='w';apartment='unit';apt='unit';suite='unit';ste='unit'}

function Get-StreetKey([string]$Street) {
  $value = $Street.ToLowerInvariant().Replace('.', '').Replace('#', ' unit ') -replace '[^a-z0-9 -]', ' '
  return (($value.Trim() -split '\s+' | ForEach-Object {
    if ($suffixes.ContainsKey($_)) { $suffixes[$_] } else { $_ }
  }) -join ' ') -replace '\bunit unit\b', 'unit'
}

function Get-BridgeKey([string]$Address) {
  return (($Address -replace '\b(usa|united states)\b', '').ToLowerInvariant() -replace '[^a-z0-9]+', '-').Trim('-')
}

function Get-ListingFacts($row) {
  @{
    beds=$row.bedrooms; baths=$row.bathrooms; year=$row.extras.yearBuilt; dom=$row.extras.daysOnMarket
    sqft=if ($row.areaUnit -eq 'sqft') { $row.livingArea }
    lotSqft=if ($row.areaUnit -eq 'sqft') { $row.landArea }
  }
}

function Read-ApifyRows {
  if (-not $env:PBK_APIFY_API_TOKEN) { throw 'Set PBK_APIFY_API_TOKEN for dataset API access, or provide -CsvPath.' }
  $url = "https://api.apify.com/v2/datasets/$DatasetId/items"
  $headers = @{Authorization="Bearer $env:PBK_APIFY_API_TOKEN"}
  $fields = 'address,price,offerType,source,propertyType,bedrooms,bathrooms,livingArea,landArea,areaUnit,extras,pictures'
  for ($offset = 0; $offset -le 1000; $offset += 100) {
    $items = Invoke-RestMethod -Uri "${url}?limit=100&offset=$offset&fields=$fields" -Headers $headers -TimeoutSec 20 -MaximumRedirection 0
    $page = @($items | Where-Object { $null -ne $_ })
    if ($offset -eq 1000 -and $page.Count) { throw 'Dataset exceeds the 1,000-row sync limit.' }
    foreach ($row in $page) {
      if ($row.offerType -ne 'sale' -or $row.price.currency -ne 'USD') { continue }
      [pscustomobject]@{
        street = $row.address.street; city = $row.address.city; state = $row.address.state; zip = $row.address.zip
        price = $row.price.value; type = $row.propertyType; links = @($row.source.url)
        facts = Get-ListingFacts $row; photos = @($row.pictures)
      }
    }
    if ($page.Count -lt 100) { break }
  }
}

if ($CsvPath -and $DatasetJsonPath) { throw 'Choose one source file format.' }
if ($CsvPath) {
  $rows = @(Import-Csv -LiteralPath $CsvPath | ForEach-Object {
    [pscustomobject]@{
      street = $_.street_address; city = $_.city; state = $_.state; zip = $_.zip
      price = $_.asking_price_usd; type = $_.property_type
      links = @(($_.realtor_urls, $_.zillow_urls, $_.redfin_urls -join ' | ') -split ' \| ' | Where-Object { $_ })
    }
  })
} elseif ($DatasetJsonPath) {
  $rows = @(Get-Content -LiteralPath $DatasetJsonPath -Raw | ConvertFrom-Json | Where-Object {
    $_.offerType -eq 'sale' -and $_.'price.currency' -eq 'USD'
  } | ForEach-Object {
    $street = [string]$_.'address.street'
    # Redfin omitted the suffix in the address field but preserved it in the listing URL.
    if ($street -eq '1311 Braeridge' -and $_.'source.url' -eq 'https://www.redfin.com/CA/Beverly-Hills/1311-Braeridge-Dr-90210/home/6823405') {
      $street = '1311 Braeridge Dr'
    }
    [pscustomobject]@{
      street=$street; city=$_.'address.city'; state=$_.'address.state'; zip=$_.'address.zip'
      price=$_.'price.value'; type=$_.propertyType; links=@($_.'source.url')
      facts=@{
        beds=$_.bedrooms; baths=$_.bathrooms; year=$_.'extras.yearBuilt'; dom=$_.'extras.daysOnMarket'
        sqft=if ($_.areaUnit -eq 'sqft') { $_.livingArea }
        lotSqft=if ($_.areaUnit -eq 'sqft') { $_.landArea }
      }
      photos=@($_.pictures)
    }
  })
} else {
  $rows = @(Read-ApifyRows)
}

$inZip = @($rows | Where-Object { $_.zip -eq $Zip })
$addressable = @($inZip | Where-Object { $_.street -and $_.city -and $_.state })
$reference = @{}
if ($AddressReferenceCsv) {
  foreach ($row in (Import-Csv -LiteralPath $AddressReferenceCsv | Where-Object { $_.zip -eq $Zip -and $_.street_address -and $_.city -and $_.state })) {
    $reference["$(Get-StreetKey $row.street_address)|$($row.state)"] = "$($row.street_address.Trim()), $($row.city.Trim()), $($row.state.Trim()) $Zip"
  }
}
$listings = @(foreach ($group in ($addressable | Group-Object -Property { "$(Get-StreetKey $_.street)|$($_.state)" })) {
  $row = $group.Group | Select-Object -First 1
  $prices = @($group.Group | ForEach-Object { [decimal]$_.price } | Sort-Object -Unique)
  if ($prices.Count -ne 1 -or $prices[0] -le 0) { throw "Invalid or conflicting asking prices for $($row.street)." }
  $links = @($group.Group | ForEach-Object { $_.links } | Where-Object { $_ } | Sort-Object -Unique)
  if (-not $links.Count -or @($links | Where-Object { $_ -notmatch '^https://(?:www\.)?(?:realtor\.com|redfin\.com|zillow\.com)/' }).Count) {
    throw "Missing or unexpected source links for $($row.street)."
  }
  $types = @($group.Group | ForEach-Object { $_.type -split ' \| ' } | Where-Object { $_ -and $_ -ne 'other' } | Sort-Object -Unique)
  $facts = [ordered]@{}
  foreach ($field in @('beds','baths','sqft','lotSqft','year','dom')) {
    $values = @($group.Group | ForEach-Object { if ($_.facts) { $_.facts[$field] } } |
      Where-Object { $_ -is [ValueType] -and $_ -gt 0 } | Sort-Object -Unique)
    # A one-square-foot rounding difference is not a material lot-size disagreement.
    if ($values.Count -eq 1 -or ($field -eq 'lotSqft' -and $values.Count -eq 2 -and ($values[1] - $values[0]) -le 1)) {
      $facts[$field] = $values[0]
    }
  }
  $photos = @($group.Group | ForEach-Object { $_.photos } |
    Where-Object { $_ -is [string] -and $_ -match '^https://ap\.rdcpix\.com/[a-z0-9_-]+\.(?:jpe?g|png|webp)$' } |
    Select-Object -Unique -First 6)
  [ordered]@{
    address = if ($reference[$group.Name]) { $reference[$group.Name] } else { "$($row.street.Trim()), $($row.city.Trim()), $($row.state.Trim()) $Zip" }
    zip = $Zip
    propertyType = if ($types.Count) { $types -join ' | ' } else { 'other' }
    askingPriceUsd = $prices[0]
    priceBasis = 'asking_price'
    datasetId = $DatasetId
    capturedAt = $CapturedAt.UtcDateTime.ToString('o')
    sourceLinks = $links
    listingFacts = $facts
    photoUrls = $photos
  }
})

if (-not $listings.Count) { throw "No addressable listings in ZIP $Zip." }
$summary = [ordered]@{ zip=$Zip; datasetId=$DatasetId; candidates=$listings.Count; withFacts=@($listings | Where-Object {$_.listingFacts.Count}).Count; withPhotos=@($listings | Where-Object {$_.photoUrls.Count}).Count; missingAddress=$inZip.Count-$addressable.Count; applied=0; unchanged=0; skippedExisting=0; skippedCapacity=0 }
if (-not $Apply) {
  $summary | ConvertTo-Json
  return
}

if (-not $BridgeUrl -or -not $env:PBK_BRIDGE_API_KEY) { throw 'Set -BridgeUrl and PBK_BRIDGE_API_KEY before applying.' }
$bridge = [Uri]$BridgeUrl
if (-not $bridge.IsAbsoluteUri -or $bridge.UserInfo -or $bridge.Query -or $bridge.Fragment -or
    ($bridge.Scheme -ne 'https' -and -not ($bridge.Scheme -eq 'http' -and $bridge.IsLoopback))) {
  throw 'The bridge must use HTTPS or HTTP on loopback.'
}
$BridgeUrl = $BridgeUrl.TrimEnd('/')
$auth = @{Authorization="Bearer $env:PBK_BRIDGE_API_KEY"}
try {
  $snapshot = Invoke-RestMethod -Uri "$BridgeUrl/state" -Headers $auth -TimeoutSec 20 -MaximumRedirection 0
} catch {
  throw "PBK sync snapshot failed (HTTP $([int]$_.Exception.Response.StatusCode))."
}
if ($null -eq $snapshot.status.propertyCacheCount) { throw 'Bridge did not report its property-cache count.' }
$current = @{}
foreach ($record in $snapshot.propertyCache) {
  if ($record.address) { $current[(Get-BridgeKey $record.address)] = $record }
}
$pending = @(foreach ($listing in $listings) {
  $key = Get-BridgeKey $listing.address
  $record = $current[$key]
  if (-not $record -and $snapshot.status.propertyCacheCount -gt $current.Count) {
    $encoded = [Uri]::EscapeDataString($listing.address)
    try {
      $record = (Invoke-RestMethod -Uri "$BridgeUrl/api/property-data?address=$encoded" -Headers $auth -TimeoutSec 20 -MaximumRedirection 0).propertyData
    } catch {
      throw "PBK sync lookup failed (HTTP $([int]$_.Exception.Response.StatusCode))."
    }
  }
  if ($ExistingDatasetOnly -and (-not $record -or $record.data.datasetId -ne $DatasetId)) {
    $summary.skippedExisting++
    continue
  }
  if ($record) {
    if ($record.source -ne $source -or -not $record.data.capturedAt -or [DateTimeOffset]$record.data.capturedAt -gt $CapturedAt) {
      $summary.skippedExisting++
      continue
    }
    if ($record.data.datasetId -eq $DatasetId -and $record.data.askingPriceUsd -eq $listing.askingPriceUsd -and
        $record.data.propertyType -eq $listing.propertyType -and
        (ConvertTo-Json -InputObject $record.data.listingFacts -Compress) -eq (ConvertTo-Json -InputObject $listing.listingFacts -Compress) -and
        (ConvertTo-Json -InputObject @($record.data.photoUrls) -Compress) -eq (ConvertTo-Json -InputObject $listing.photoUrls -Compress) -and
        -not (Compare-Object @($record.data.sourceLinks | Sort-Object -Unique) $listing.sourceLinks)) {
      $summary.unchanged++
      continue
    }
  }
  [pscustomobject]@{listing=$listing; isNew=(-not $record)}
})
$free = [Math]::Max(0, $capacity - [int]$snapshot.status.propertyCacheCount)
$newRows = @($pending | Where-Object isNew)
if ($newRows.Count -gt $free) {
  if (-not $KeepExistingAtCapacity) { throw 'Sync would exceed bridge cache capacity and could evict existing property records.' }
  $summary.skippedCapacity = $newRows.Count - $free
  $pending = @($pending | Where-Object { -not $_.isNew }) + @($newRows | Select-Object -First $free)
}

foreach ($item in $pending) {
  $listing = $item.listing
  $payload = @{address=$listing.address; data=$listing; source=$source; provider='apify'; status='listing-only'; requestedBy='PBK operator'} | ConvertTo-Json -Depth 5 -Compress
  try {
    $response = Invoke-RestMethod -Method Post -Uri "$BridgeUrl/api/property-data" -Headers $auth -ContentType 'application/json' -Body $payload -TimeoutSec 30 -MaximumRedirection 0
  } catch {
    throw "PBK sync write failed (HTTP $([int]$_.Exception.Response.StatusCode)) after $($summary.applied) verified writes."
  }
  if (-not $response.ok -or $response.propertyData.data.askingPriceUsd -ne $listing.askingPriceUsd -or
      $response.propertyData.values.arv -ne 0 -or @($response.propertyData.values.comps | Where-Object { $_ }).Count) {
    throw "PBK sync write failed listing-only verification after $($summary.applied) verified writes."
  }
  $summary.applied++
  if ($summary.applied % 25 -eq 0) { Write-Host "Saved $($summary.applied) of $($pending.Count) property records." }
}
$summary | ConvertTo-Json
