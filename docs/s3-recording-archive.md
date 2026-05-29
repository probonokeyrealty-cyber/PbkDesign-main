# PBK S3 Recording Archive

PBK uses Supabase Storage as the active recording playback store. S3 is an optional cold archive for raw call audio that Ava, Rex, QA agents, ONNX training, and future memory pipelines can reuse without relying on short-lived provider URLs.

## AWS Setup

Run this in AWS CloudShell from the repo root or after uploading the script:

```bash
PBK_AWS_REGION=us-east-2 bash scripts/aws-s3-pbk-setup.sh
```

The script creates:

- A private S3 bucket named `pbk-ava-recordings-<account>-<region>` unless `PBK_S3_RECORDINGS_BUCKET` is set.
- Public access block, AES256 default encryption, versioning, and lifecycle cost controls.
- A least-privilege IAM user and policy limited to the configured `recordings/` prefix.
- A private CloudShell JSON file at `~/pbk-s3-render-env.json` containing the Render environment variables.

The script does not print the secret access key.

## Render Environment Variables

Set these on the `pbk-openclaw-bridge` Render service:

```text
PBK_S3_RECORDING_ARCHIVE_ENABLED=true
PBK_S3_RECORDINGS_BUCKET=<bucket>
PBK_S3_RECORDINGS_PREFIX=recordings
PBK_AWS_REGION=us-east-2
PBK_AWS_ACCESS_KEY_ID=<from CloudShell JSON>
PBK_AWS_SECRET_ACCESS_KEY=<from CloudShell JSON>
```

Then redeploy the bridge and verify:

```bash
curl -H "Authorization: Bearer $PBK_BRIDGE_API_KEY" \
  "https://pbk-openclaw-bridge.onrender.com/api/storage/s3/status?verify=1"
```

## Runtime Behavior

- Normal recordings still upload to Supabase first.
- If S3 is configured, PBK also archives the same audio bytes to S3.
- Recording delete attempts delete from both Supabase and S3.
- `/api/recordings/:messageId?s3=1` can return a signed S3 URL for archived audio.

## Why This Matters

This gives Ava and Rex a durable long-term memory dataset for:

- Recording replay and QA.
- Emotion/prosody model training.
- Objection and script outcome analysis.
- Future S3-to-vector memory pipelines.
