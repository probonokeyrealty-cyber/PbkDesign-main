#!/usr/bin/env bash
set -euo pipefail

REGION="${PBK_AWS_REGION:-${AWS_REGION:-us-east-2}}"
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
BUCKET="${PBK_S3_RECORDINGS_BUCKET:-pbk-ava-recordings-${ACCOUNT_ID}-${REGION}}"
PREFIX="${PBK_S3_RECORDINGS_PREFIX:-recordings}"
IAM_USER="${PBK_S3_IAM_USER:-pbk-render-s3-archive}"
POLICY_NAME="${PBK_S3_POLICY_NAME:-PBKRenderS3RecordingArchivePolicy}"
ENV_FILE="${PBK_S3_ENV_FILE:-$HOME/pbk-s3-render-env.json}"

echo "PBK S3 archive setup"
echo "Account: ${ACCOUNT_ID}"
echo "Region: ${REGION}"
echo "Bucket: ${BUCKET}"
echo "Prefix: ${PREFIX}"

if aws s3api head-bucket --bucket "${BUCKET}" >/dev/null 2>&1; then
  echo "Bucket already exists: ${BUCKET}"
else
  if [[ "${REGION}" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "${BUCKET}" --region "${REGION}" >/dev/null
  else
    aws s3api create-bucket \
      --bucket "${BUCKET}" \
      --region "${REGION}" \
      --create-bucket-configuration "LocationConstraint=${REGION}" >/dev/null
  fi
  echo "Created bucket: ${BUCKET}"
fi

aws s3api put-public-access-block \
  --bucket "${BUCKET}" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true >/dev/null

aws s3api put-bucket-encryption \
  --bucket "${BUCKET}" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"},"BucketKeyEnabled":true}]}' >/dev/null

aws s3api put-bucket-versioning \
  --bucket "${BUCKET}" \
  --versioning-configuration Status=Enabled >/dev/null

cat > /tmp/pbk-s3-lifecycle.json <<JSON
{
  "Rules": [
    {
      "ID": "pbk-recording-archive-cost-control",
      "Status": "Enabled",
      "Filter": { "Prefix": "${PREFIX}/" },
      "Transitions": [
        { "Days": 30, "StorageClass": "STANDARD_IA" },
        { "Days": 180, "StorageClass": "GLACIER_IR" }
      ],
      "NoncurrentVersionTransitions": [
        { "NoncurrentDays": 30, "StorageClass": "STANDARD_IA" }
      ],
      "AbortIncompleteMultipartUpload": { "DaysAfterInitiation": 7 }
    }
  ]
}
JSON
aws s3api put-bucket-lifecycle-configuration \
  --bucket "${BUCKET}" \
  --lifecycle-configuration file:///tmp/pbk-s3-lifecycle.json >/dev/null

if aws iam get-user --user-name "${IAM_USER}" >/dev/null 2>&1; then
  echo "IAM user already exists: ${IAM_USER}"
else
  aws iam create-user --user-name "${IAM_USER}" >/dev/null
  echo "Created IAM user: ${IAM_USER}"
fi

cat > /tmp/pbk-s3-policy.json <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListOnlyPbkRecordingPrefix",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": "arn:aws:s3:::${BUCKET}",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["${PREFIX}/*", "${PREFIX}"]
        }
      }
    },
    {
      "Sid": "ReadWriteOnlyPbkRecordingObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::${BUCKET}/${PREFIX}/*"
    }
  ]
}
JSON

POLICY_ARN="$(aws iam list-policies --scope Local --query "Policies[?PolicyName=='${POLICY_NAME}'].Arn | [0]" --output text)"
if [[ -z "${POLICY_ARN}" || "${POLICY_ARN}" == "None" ]]; then
  POLICY_ARN="$(aws iam create-policy \
    --policy-name "${POLICY_NAME}" \
    --policy-document file:///tmp/pbk-s3-policy.json \
    --query Policy.Arn \
    --output text)"
  echo "Created policy: ${POLICY_ARN}"
else
  DEFAULT_VERSION="$(aws iam get-policy --policy-arn "${POLICY_ARN}" --query Policy.DefaultVersionId --output text)"
  VERSION_COUNT="$(aws iam list-policy-versions --policy-arn "${POLICY_ARN}" --query 'length(Versions)' --output text)"
  if [[ "${VERSION_COUNT}" -ge 5 ]]; then
    OLDEST_VERSION="$(aws iam list-policy-versions --policy-arn "${POLICY_ARN}" --query 'Versions[?IsDefaultVersion==`false`] | sort_by(@,&CreateDate)[0].VersionId' --output text)"
    aws iam delete-policy-version --policy-arn "${POLICY_ARN}" --version-id "${OLDEST_VERSION}" >/dev/null
  fi
  aws iam create-policy-version \
    --policy-arn "${POLICY_ARN}" \
    --policy-document file:///tmp/pbk-s3-policy.json \
    --set-as-default >/dev/null
  echo "Updated policy: ${POLICY_ARN} (previous default ${DEFAULT_VERSION})"
fi

aws iam attach-user-policy --user-name "${IAM_USER}" --policy-arn "${POLICY_ARN}" >/dev/null

ACTIVE_KEYS="$(aws iam list-access-keys --user-name "${IAM_USER}" --query 'AccessKeyMetadata[?Status==`Active`].AccessKeyId' --output text)"
if [[ -n "${ACTIVE_KEYS}" && "${PBK_FORCE_NEW_S3_ACCESS_KEY:-false}" != "true" ]]; then
  echo "Active access key already exists for ${IAM_USER}."
  echo "Set PBK_FORCE_NEW_S3_ACCESS_KEY=true to rotate and create a new key."
else
  KEY_JSON="$(aws iam create-access-key --user-name "${IAM_USER}")"
  ACCESS_KEY_ID="$(echo "${KEY_JSON}" | jq -r '.AccessKey.AccessKeyId')"
  SECRET_ACCESS_KEY="$(echo "${KEY_JSON}" | jq -r '.AccessKey.SecretAccessKey')"
  umask 077
  cat > "${ENV_FILE}" <<JSON
{
  "PBK_S3_RECORDING_ARCHIVE_ENABLED": "true",
  "PBK_S3_RECORDINGS_BUCKET": "${BUCKET}",
  "PBK_S3_RECORDINGS_PREFIX": "${PREFIX}",
  "PBK_AWS_REGION": "${REGION}",
  "PBK_AWS_ACCESS_KEY_ID": "${ACCESS_KEY_ID}",
  "PBK_AWS_SECRET_ACCESS_KEY": "${SECRET_ACCESS_KEY}"
}
JSON
  echo "Created a new access key and wrote Render env JSON to: ${ENV_FILE}"
  echo "Secret key was not printed. Open that file in CloudShell only long enough to paste into Render env vars."
fi

echo "Done."
echo "Bucket=${BUCKET}"
echo "Region=${REGION}"
echo "Prefix=${PREFIX}"
