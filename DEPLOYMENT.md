# PBK Deployment Runbook

This runbook explains how to safely redeploy PBK Command Center, the PBK OpenClaw bridge, and the supporting provider configuration.

## Current Production Shape

- Frontend: Netlify site at `https://pbkcommandcenter.netlify.app`
- Backend bridge: Render service `pbk-openclaw-bridge`
- State backend: Render Postgres
- Provider writes: approval-gated
- Voice stack: Deepgram STT, ElevenLabs TTS
- Contract stack: DocuSign production endpoints

## Safe Deploy Order

1. Commit and push code to GitHub `main`.
2. Run local checks:

```powershell
npm.cmd run test:founder
```

3. Deploy the Render bridge:
   - Open Render.
   - Go to `pbk-openclaw-bridge`.
   - Click `Manual Deploy`.
   - Choose `Deploy latest commit`.

4. Verify hosted bridge:

```powershell
npm.cmd run test:hosted
```

5. Verify live providers:

```powershell
$h = Invoke-RestMethod -Uri https://pbk-openclaw-bridge.onrender.com/health
$h.providers
```

6. Deploy Netlify only when frontend files changed:

```powershell
npm.cmd run build
npx.cmd netlify deploy --prod
```

## Required Production Environment Variables

Do not paste secret values into logs or chat. Set them directly in Render.

Core:

- `PBK_BRIDGE_API_KEY`
- `PBK_DATABASE_URL`
- `PBK_PUBLIC_BASE_URL`
- `PBK_PROTECTED_OPS_PASSCODE`

Voice:

- `PBK_DEEPGRAM_API_KEY`
- `PBK_BROWSER_VOICE_ENABLED=true`
- `PBK_ELEVENLABS_API_KEY`
- `PBK_ELEVENLABS_TTS_ENABLED=true`

AI:

- `PBK_OPENAI_API_KEY`
- Optional: `PBK_OPENAI_BASE_URL` for a compatible proxy

Provider actions:

- `PBK_TELNYX_API_KEY`
- `PBK_TELNYX_FROM_NUMBER`
- `PBK_TELNYX_CONNECTION_ID`
- `PBK_TELNYX_MESSAGING_PROFILE_ID`
- `PBK_INSTANTLY_API_KEY`
- `PBK_STREAK_API_KEY`
- `PBK_DOCUSIGN_*`

Optional:

- `PBK_BATCHDATA_API_KEY`
- `PBK_TOTP_SECRET`
- `PBK_TOTP_REQUIRED=true`

## Production Health Expectations

Expected ready providers:

- `telnyx`
- `deepgram`
- `browserVoice`
- `elevenLabs`
- `openAiWebSearch`
- `instantly`
- `googleCalendar`
- `supabaseStorage`
- `n8nWorkflows`
- `streak`
- `crmSync`
- `docusign`
- `slack`
- `render`

Known optional gap until configured:

- `batchdata`: missing `PBK_BATCHDATA_API_KEY`

## Rollback

If a deploy causes issues:

1. Open Render deploy history.
2. Select the last known good deploy.
3. Redeploy that commit.
4. Run:

```powershell
npm.cmd run test:hosted
```

## Security Notes

- Do not expose provider keys through BrowserOS snapshots or terminal output.
- Rotate any key that appears in a browser snapshot.
- Keep provider writes approval-gated until PBK has passed real production call and campaign proofs.
- Enable TOTP only after the admin has enrolled the authenticator secret.
