# Import DocuSign from the PowerShell Quickstart Bundle

PBK can import DocuSign JWT settings directly from the official DocuSign PowerShell sample bundle instead of manually copying each field.

## Supported source

- Zipped bundle, for example: `C:\Users\Dell\Downloads\PBK -powershell.zip`
- Extracted folder, for example: `C:\Users\Dell\Downloads\PBK-powershell`

The importer reads:

- `config/settings.json`
- `config/private.key`

## Run it

```powershell
cd C:\Users\Dell\Documents\New project 2\PbkDesign-main
powershell -ExecutionPolicy Bypass -File .\scripts\import-docusign-powershell.ps1 `
  -ZipPath "C:\Users\Dell\Downloads\PBK -powershell.zip" `
  -ApplyUserEnv `
  -ResolveAccount
```

What it does:

- Imports the JWT integration key and impersonation user GUID.
- Imports the RSA private key PEM.
- Sets local PBK bridge env vars:
  - `PBK_DOCUSIGN_INTEGRATION_KEY`
  - `PBK_DOCUSIGN_USER_ID`
  - `PBK_DOCUSIGN_PRIVATE_KEY`
  - `PBK_DOCUSIGN_AUTH_HOST`
  - `PBK_DOCUSIGN_REST_BASE`
- Attempts JWT auth to resolve:
  - `PBK_DOCUSIGN_ACCOUNT_ID`
  - the correct REST base URI for the account

## If consent is still required

If the script returns:

```json
{
  "resolutionState": "failed",
  "resolutionDetail": {
    "body": "{\"error\":\"consent_required\"}"
  }
}
```

then the DocuSign user still needs to approve impersonation for the integration key.

Use the importer output to confirm the integration key loaded, then open the DocuSign consent URL for that key and user. After approval, rerun:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\import-docusign-powershell.ps1 `
  -ZipPath "C:\Users\Dell\Downloads\PBK -powershell.zip" `
  -ApplyUserEnv `
  -ResolveAccount
```

Once consent is granted, the importer will populate `PBK_DOCUSIGN_ACCOUNT_ID`.

## Render handoff

After the local importer has resolved all values, set these env vars on Render:

- `PBK_DOCUSIGN_INTEGRATION_KEY`
- `PBK_DOCUSIGN_USER_ID`
- `PBK_DOCUSIGN_ACCOUNT_ID`
- `PBK_DOCUSIGN_PRIVATE_KEY`
- `PBK_DOCUSIGN_AUTH_HOST`
- `PBK_DOCUSIGN_REST_BASE`

Then redeploy and verify:

```bash
curl -s https://pbk-openclaw-bridge.onrender.com/health | jq '.providers.docusign'
```

Expected result:

```json
{
  "configured": true,
  "ready": true,
  "missing": []
}
```
