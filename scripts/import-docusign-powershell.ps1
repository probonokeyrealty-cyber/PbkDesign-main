param(
    [string]$ZipPath,
    [string]$FolderPath,
    [switch]$ApplyUserEnv,
    [switch]$ResolveAccount,
    [switch]$OpenConsent
)

$ErrorActionPreference = "Stop"

function Get-MaskedValue {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return '<empty>' }
    if ($Value.Length -le 8) { return ('*' * $Value.Length) }
    return '{0}…{1}' -f $Value.Substring(0, 4), $Value.Substring($Value.Length - 4)
}

function Read-BundleText {
    param(
        [string]$ResolvedZipPath,
        [string]$ResolvedFolderPath,
        [string]$RelativePath
    )

    if ($ResolvedFolderPath) {
        $target = Join-Path $ResolvedFolderPath $RelativePath
        if (-not (Test-Path $target)) { throw "Missing file in bundle folder: $target" }
        return Get-Content -Raw $target
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ResolvedZipPath)
    try {
        $entryPath = ('PBK-powershell/{0}' -f $RelativePath.Replace('\', '/'))
        $entry = $zip.Entries | Where-Object FullName -eq $entryPath | Select-Object -First 1
        if (-not $entry) { throw "Missing file in bundle zip: $entryPath" }
        $reader = [IO.StreamReader]::new($entry.Open())
        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $zip.Dispose()
    }
}

function Resolve-DocusignAccount {
    param(
        [string]$IntegrationKey,
        [string]$UserId,
        [string]$PrivateKey,
        [string]$AuthHost
    )

    $tempDir = Join-Path $env:TEMP ('pbk-docusign-import-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tempDir | Out-Null
    $settingsPath = Join-Path $tempDir 'settings.json'
    $privateKeyPath = Join-Path $tempDir 'private.key'
    try {
        $utf8NoBom = [System.Text.UTF8Encoding]::new($false)

        @{
            integrationKey = $IntegrationKey
            userId = $UserId
            authHost = $AuthHost
        } | ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText($settingsPath, $_, $utf8NoBom) }

        [IO.File]::WriteAllText($privateKeyPath, $PrivateKey, $utf8NoBom)

        $nodeScript = @'
import fs from "node:fs";
import crypto from "node:crypto";

const settings = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const privateKey = fs.readFileSync(process.argv[3], "utf8");

const integrationKey = settings.integrationKey;
const userId = settings.userId;
const authHost = settings.authHost;

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const now = Math.floor(Date.now() / 1000);
const header = { alg: "RS256", typ: "JWT" };
const payload = {
  iss: integrationKey,
  sub: userId,
  aud: authHost,
  iat: now,
  exp: now + 3600,
  scope: "signature impersonation"
};

const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = crypto
  .createSign("RSA-SHA256")
  .update(unsigned)
  .end()
  .sign(privateKey)
  .toString("base64")
  .replace(/=/g, "")
  .replace(/\+/g, "-")
  .replace(/\//g, "_");

const assertion = `${unsigned}.${signature}`;

const tokenRes = await fetch(`https://${authHost}/oauth/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion
  })
});

const tokenText = await tokenRes.text();
if (!tokenRes.ok) {
  console.log(JSON.stringify({
    ok: false,
    stage: "token",
    status: tokenRes.status,
    body: tokenText.slice(0, 500)
  }));
  process.exit(0);
}

const tokenBody = JSON.parse(tokenText);
const infoRes = await fetch(`https://${authHost}/oauth/userinfo`, {
  headers: { Authorization: `Bearer ${tokenBody.access_token}` }
});
const infoText = await infoRes.text();
if (!infoRes.ok) {
  console.log(JSON.stringify({
    ok: false,
    stage: "userinfo",
    status: infoRes.status,
    body: infoText.slice(0, 500)
  }));
  process.exit(0);
}

const info = JSON.parse(infoText);
const accounts = Array.isArray(info.accounts) ? info.accounts.map((account) => ({
  account_id: account.account_id,
  base_uri: account.base_uri,
  is_default: Boolean(account.is_default),
  account_name: account.account_name || ""
})) : [];

console.log(JSON.stringify({
  ok: true,
  accounts
}));
'@

        $resultJson = $nodeScript | & node - $settingsPath $privateKeyPath
        if ($LASTEXITCODE -ne 0) {
            return [pscustomobject]@{
                ok = $false
                stage = 'resolver'
                status = 0
                body = 'Node-based DocuSign account resolver failed on this host. Re-run consent/account lookup outside the importer.'
            }
        }

        if ([string]::IsNullOrWhiteSpace($resultJson)) {
            return [pscustomobject]@{
                ok = $false
                stage = 'resolver'
                status = 0
                body = 'DocuSign account resolver returned no data.'
            }
        }

        return $resultJson | ConvertFrom-Json
    }
    finally {
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

if (-not $ZipPath -and -not $FolderPath) {
    $zipCandidate = 'C:\Users\Dell\Downloads\PBK -powershell.zip'
    $folderCandidate = 'C:\Users\Dell\Downloads\PBK-powershell'
    if (Test-Path $folderCandidate) { $FolderPath = $folderCandidate }
    elseif (Test-Path $zipCandidate) { $ZipPath = $zipCandidate }
    else { throw 'Provide -ZipPath or -FolderPath for the DocuSign PowerShell bundle.' }
}

$resolvedZipPath = $null
$resolvedFolderPath = $null
if ($ZipPath) {
    $resolvedZipPath = (Resolve-Path $ZipPath).Path
}
if ($FolderPath) {
    $resolvedFolderPath = (Resolve-Path $FolderPath).Path
}

$settings = (Read-BundleText -ResolvedZipPath $resolvedZipPath -ResolvedFolderPath $resolvedFolderPath -RelativePath 'config\settings.json') | ConvertFrom-Json
$privateKey = Read-BundleText -ResolvedZipPath $resolvedZipPath -ResolvedFolderPath $resolvedFolderPath -RelativePath 'config\private.key'

$integrationKey = [string]($settings.INTEGRATION_KEY_JWT)
if ([string]::IsNullOrWhiteSpace($integrationKey)) {
    $integrationKey = [string]($settings.INTEGRATION_KEY_AUTH_CODE)
}
$userId = [string]($settings.IMPERSONATION_USER_GUID)
$authHost = 'account-d.docusign.com'
$defaultRestBase = 'https://demo.docusign.net/restapi'
$consentUrl = 'https://{0}/oauth/auth?response_type=code&scope=signature%20impersonation&client_id={1}&redirect_uri=https://www.docusign.com' -f $authHost, $integrationKey

if ([string]::IsNullOrWhiteSpace($integrationKey)) { throw 'No integration key found in bundle settings.' }
if ([string]::IsNullOrWhiteSpace($userId)) { throw 'No impersonation user GUID found in bundle settings.' }
if ([string]::IsNullOrWhiteSpace($privateKey)) { throw 'No private key found in bundle config.' }

$resolvedAccountId = $null
$resolvedRestBase = $defaultRestBase
$resolutionState = 'not-run'
$resolutionDetail = $null

if ($ResolveAccount) {
    $accountResult = Resolve-DocusignAccount -IntegrationKey $integrationKey -UserId $userId -PrivateKey $privateKey -AuthHost $authHost
    if ($accountResult.ok) {
        $defaultAccount = $accountResult.accounts | Where-Object is_default | Select-Object -First 1
        if (-not $defaultAccount) { $defaultAccount = $accountResult.accounts | Select-Object -First 1 }
        if ($defaultAccount) {
            $resolvedAccountId = [string]$defaultAccount.account_id
            if ($defaultAccount.base_uri) {
                $resolvedRestBase = ('{0}/restapi' -f [string]$defaultAccount.base_uri).TrimEnd('/')
            }
        }
        $resolutionState = 'resolved'
        $resolutionDetail = $accountResult.accounts
    }
    else {
        $resolutionState = 'failed'
        $resolutionDetail = $accountResult
    }
}

$envMap = [ordered]@{
    PBK_DOCUSIGN_INTEGRATION_KEY = $integrationKey
    PBK_DOCUSIGN_USER_ID = $userId
    PBK_DOCUSIGN_PRIVATE_KEY = $privateKey
    PBK_DOCUSIGN_AUTH_HOST = $authHost
    PBK_DOCUSIGN_REST_BASE = $resolvedRestBase
}

if ($resolvedAccountId) {
    $envMap['PBK_DOCUSIGN_ACCOUNT_ID'] = $resolvedAccountId
}

if ($ApplyUserEnv) {
    foreach ($pair in $envMap.GetEnumerator()) {
        [Environment]::SetEnvironmentVariable($pair.Key, [string]$pair.Value, 'User')
        Set-Item -Path ("Env:{0}" -f $pair.Key) -Value ([string]$pair.Value)
    }
}

if ($OpenConsent) {
    Start-Process $consentUrl | Out-Null
}

$missing = @()
if (-not $resolvedAccountId) { $missing += 'PBK_DOCUSIGN_ACCOUNT_ID' }
if ($resolutionState -eq 'failed') { $missing += 'DocuSign consent or userinfo resolution' }

[ordered]@{
    source = if ($resolvedFolderPath) { $resolvedFolderPath } else { $resolvedZipPath }
    appliedUserEnv = [bool]$ApplyUserEnv
    openedConsent = [bool]$OpenConsent
    integrationKey = Get-MaskedValue $integrationKey
    userId = Get-MaskedValue $userId
    accountId = Get-MaskedValue $resolvedAccountId
    authHost = $authHost
    restBase = $resolvedRestBase
    privateKey = [ordered]@{
        looksLikePem = ($privateKey -match 'BEGIN RSA PRIVATE KEY' -and $privateKey -match 'END RSA PRIVATE KEY')
        lineCount = (($privateKey -split "`r?`n") | Where-Object { $_ -ne '' }).Count
    }
    resolutionState = $resolutionState
    resolutionDetail = if ($resolutionState -eq 'failed') {
        [ordered]@{
            stage = $resolutionDetail.stage
            status = $resolutionDetail.status
            body = $resolutionDetail.body
        }
    } elseif ($resolutionState -eq 'resolved') {
        $resolutionDetail | ForEach-Object {
            [ordered]@{
                accountId = Get-MaskedValue ([string]$_.account_id)
                baseUri = $_.base_uri
                isDefault = [bool]$_.is_default
                accountName = $_.account_name
            }
        }
    } else { $null }
    missing = $missing
} | ConvertTo-Json -Depth 6
