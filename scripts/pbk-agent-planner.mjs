import {
  AGENT_CATEGORY_LABELS,
  PLANNER_MARKER,
  addIssueComment,
  appendUniqueLabels,
  callGeminiJson,
  createIssue,
  ensureAgentLabels,
  getGitHubToken,
  getGoogleApiKey,
  getLabelNames,
  getRepoConfig,
  hasLabel,
  listIssueComments,
  listOpenIssues,
  postSlackWebhook,
  replaceIssueLabels,
} from './pbk-agent-lib.mjs';

const READY_QUEUE_TARGET = 5;
const MAX_PARENT_ISSUES = 3;
const MAX_CHILD_ISSUES = 3;
const dryRun = process.argv.includes('--dry-run');

function stripPlannerMarker(text = '') {
  return String(text || '').replace(PLANNER_MARKER, '').trim();
}

function issueBody(issue = {}) {
  return stripPlannerMarker(issue.body || '').trim() || '_No body provided._';
}

function formatChildIssueBody(parentIssue, child) {
  return [
    `Parent issue: #${parentIssue.number}`,
    '',
    child.body?.trim() || '',
  ]
    .join('\n')
    .trim();
}

function buildPlannerPrompt(issue) {
  const labels = getLabelNames(issue);
  return `
You are planning safe unattended work for PBK Wholesale Paradise.

Return JSON only with this shape:
{
  "decision": "ready" | "split" | "human",
  "summary": "one short sentence",
  "children": [
    {
      "title": "short task title",
      "labels": ["agent/ui", "agent/ready"],
      "body": "Markdown body with sections: ## Goal, ## Success Criteria, ## Allowed Files, ## Forbidden Files, ## Required Tests, ## Deploy Impact"
    }
  ]
}

Rules:
- This repo is founder-first. Keep runtime contracts stable.
- Never suggest secrets, billing, provider onboarding, dashboard settings, or paid-resource changes as unattended work.
- Use "human" if the issue requires account access, secret changes, or unclear product decisions.
- Use "ready" only if the existing issue is already small enough for one unattended PR.
- Use "split" if the parent issue is too large and should become 1-${MAX_CHILD_ISSUES} child issues.
- Each child issue must be one PR worth of work.
- Allowed labels are: ${['agent/ready', 'agent/human-required', ...AGENT_CATEGORY_LABELS, 'agent/automerge'].join(', ')}.
- Every child must include exactly one category label from ${AGENT_CATEGORY_LABELS.join(', ')} and must include agent/ready.
- Keep deploy impact explicit and conservative.

Issue #${issue.number}: ${issue.title}
Labels: ${labels.join(', ') || 'none'}

Body:
${issueBody(issue)}
  `.trim();
}

function normalizeChildLabels(parentIssue, child) {
  const requested = Array.isArray(child.labels) ? child.labels.filter(Boolean) : [];
  const categoryFromChild = requested.find((label) => AGENT_CATEGORY_LABELS.includes(label));
  const categoryFromParent = getLabelNames(parentIssue).find((label) => AGENT_CATEGORY_LABELS.includes(label));
  const category = categoryFromChild || categoryFromParent || 'agent/runtime';

  return appendUniqueLabels([category, 'agent/ready'], requested.filter((label) => label !== 'agent/human-required'));
}

function summarizeReadyQueue(issues) {
  const ready = issues.filter((issue) => hasLabel(issue, 'agent/ready') && !hasLabel(issue, 'agent/human-required'));
  return ready.length;
}

async function isPlannerProcessed({ token, repoConfig, issueNumber }) {
  const comments = await listIssueComments({ token, repoConfig, issueNumber });
  return comments.some((comment) => String(comment.body || '').includes(PLANNER_MARKER));
}

async function main() {
  const repoConfig = getRepoConfig();
  const token = getGitHubToken();
  const googleApiKey = getGoogleApiKey();
  const slackWebhookUrl = String(process.env.PBK_SLACK_WEBHOOK_URL || '').trim();

  const labelActions = await ensureAgentLabels({ token, repoConfig, dryRun });
  const issues = await listOpenIssues({ token, repoConfig });
  const readyQueueBefore = summarizeReadyQueue(issues);
  const readyCapacity = Math.max(0, READY_QUEUE_TARGET - readyQueueBefore);

  const candidates = issues
    .filter((issue) => AGENT_CATEGORY_LABELS.some((label) => hasLabel(issue, label)))
    .filter((issue) => !hasLabel(issue, 'agent/ready'))
    .filter((issue) => !hasLabel(issue, 'agent/human-required'))
    .slice(0, MAX_PARENT_ISSUES);

  const report = {
    repository: repoConfig.fullName,
    dryRun,
    labelActions,
    readyQueueBefore,
    readyQueueAfter: readyQueueBefore,
    decisions: [],
    createdIssues: [],
    skipped: [],
  };

  if (readyCapacity === 0) {
    report.skipped.push('Ready queue already at or above target.');
  }

  if (readyCapacity > 0) {
    for (const issue of candidates) {
      if (report.createdIssues.length >= readyCapacity) {
        break;
      }

      const processed = await isPlannerProcessed({ token, repoConfig, issueNumber: issue.number });
      if (processed) {
        report.skipped.push(`#${issue.number} already processed by planner.`);
        continue;
      }

      const plan = await callGeminiJson({
        apiKey: googleApiKey,
        prompt: buildPlannerPrompt(issue),
      });

      const decision = String(plan?.decision || '').trim().toLowerCase();
      const summary = String(plan?.summary || 'Planner processed this issue.').trim();
      report.decisions.push({ issue: issue.number, decision, summary });

      if (decision === 'ready') {
        const labels = appendUniqueLabels(getLabelNames(issue), ['agent/ready']);
        await replaceIssueLabels({ token, repoConfig, issueNumber: issue.number, labels, dryRun });
        await addIssueComment({
          token,
          repoConfig,
          issueNumber: issue.number,
          dryRun,
          body: `${PLANNER_MARKER}\nPlanner marked this issue as \`agent/ready\`.\n\n${summary}`,
        });
        report.readyQueueAfter += 1;
        continue;
      }

      if (decision === 'human') {
        const labels = appendUniqueLabels(getLabelNames(issue), ['agent/human-required']);
        await replaceIssueLabels({ token, repoConfig, issueNumber: issue.number, labels, dryRun });
        await addIssueComment({
          token,
          repoConfig,
          issueNumber: issue.number,
          dryRun,
          body: `${PLANNER_MARKER}\nPlanner marked this issue as \`agent/human-required\`.\n\n${summary}`,
        });
        continue;
      }

      const children = Array.isArray(plan?.children) ? plan.children.slice(0, MAX_CHILD_ISSUES) : [];
      if (!children.length) {
        throw new Error(`Planner returned decision "${decision}" for #${issue.number} without child issues.`);
      }

      const childLinks = [];
      for (const child of children) {
        const created = await createIssue({
          token,
          repoConfig,
          dryRun,
          title: child.title,
          body: formatChildIssueBody(issue, child),
          labels: normalizeChildLabels(issue, child),
        });

        report.createdIssues.push({
          parent: issue.number,
          title: child.title,
          url: created.html_url,
        });
        childLinks.push(`- ${created.html_url} - ${child.title}`);
        report.readyQueueAfter += 1;
      }

      await addIssueComment({
        token,
        repoConfig,
        issueNumber: issue.number,
        dryRun,
        body: `${PLANNER_MARKER}\nPlanner split this parent issue into agent-ready child issues.\n\n${summary}\n\n${childLinks.join('\n')}`,
      });
    }
  }

  const digestLines = [
    `PBK agent planner ran for ${repoConfig.fullName}.`,
    `Ready queue: ${report.readyQueueBefore} -> ${report.readyQueueAfter}`,
    report.decisions.length
      ? `Decisions: ${report.decisions.map((item) => `#${item.issue} ${item.decision}`).join(', ')}`
      : 'Decisions: none',
    report.createdIssues.length
      ? `Created: ${report.createdIssues.map((item) => item.title).join(' | ')}`
      : 'Created: none',
    report.skipped.length ? `Skipped: ${report.skipped.join(' | ')}` : 'Skipped: none',
  ];

  await postSlackWebhook({
    webhookUrl: slackWebhookUrl,
    text: digestLines.join('\n'),
  });

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
