const DEFAULT_REPOSITORY = 'probonokeyrealty-cyber/PbkDesign-main';

export const AGENT_LABEL_SPECS = [
  {
    name: 'agent/ready',
    color: '0E8A16',
    description: 'Queued for unattended agent work.',
  },
  {
    name: 'agent/ui',
    color: '1D76DB',
    description: 'Frontend and founder UX work.',
  },
  {
    name: 'agent/runtime',
    color: '5319E7',
    description: 'Bridge, runtime, and hosted operations work.',
  },
  {
    name: 'agent/qa',
    color: 'FBCA04',
    description: 'Testing, smoke gates, and release hardening work.',
  },
  {
    name: 'agent/provider',
    color: '0E8A92',
    description: 'Provider integration and external API work.',
  },
  {
    name: 'agent/human-required',
    color: 'B60205',
    description: 'Blocked on secrets, billing, or account-level changes.',
  },
  {
    name: 'agent/automerge',
    color: '0B5FFF',
    description: 'Safe to auto-merge after passing checks.',
  },
];

export const AGENT_CATEGORY_LABELS = ['agent/ui', 'agent/runtime', 'agent/qa', 'agent/provider'];
export const PLANNER_MARKER = '<!-- pbk-agent-planner:processed -->';
export const WORKER_CLAIM_MARKER = '<!-- pbk-agent-worker:claimed -->';
export const WORKER_DONE_MARKER = '<!-- pbk-agent-worker:finished -->';

export function getRepoConfig(env = process.env) {
  const repoString = String(env.PBK_GITHUB_REPOSITORY || env.GITHUB_REPOSITORY || DEFAULT_REPOSITORY).trim();
  const [owner, repo] = repoString.split('/');
  if (!owner || !repo) {
    throw new Error(`Invalid repository value "${repoString}". Expected owner/repo.`);
  }
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
  };
}

export function getGitHubToken(env = process.env) {
  const token = String(env.PBK_GITHUB_TOKEN || env.GITHUB_TOKEN || env.GH_TOKEN || '').trim();
  if (!token) {
    throw new Error('Missing GitHub token. Set PBK_GITHUB_TOKEN, GITHUB_TOKEN, or GH_TOKEN.');
  }
  return token;
}

export function getGoogleApiKey(env = process.env) {
  const apiKey = String(env.GOOGLE_API_KEY || env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Missing Google API key. Set GOOGLE_API_KEY or GEMINI_API_KEY.');
  }
  return apiKey;
}

export function getLabelNames(issue = {}) {
  return Array.isArray(issue.labels)
    ? issue.labels.map((label) => (typeof label === 'string' ? label : label?.name)).filter(Boolean)
    : [];
}

export function hasLabel(issue = {}, target) {
  return getLabelNames(issue).includes(target);
}

export function appendUniqueLabels(existing = [], additions = []) {
  return [...new Set([...existing, ...additions].filter(Boolean))];
}

export function slugify(value = '') {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48);
}

export async function githubRequest(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(pathname.startsWith('http') ? pathname : `https://api.github.com${pathname}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  const parsed = raw ? tryParseJson(raw) ?? raw : null;

  if (!response.ok) {
    const error = new Error(`GitHub ${method} ${pathname} failed (${response.status}): ${raw.slice(0, 500)}`);
    error.status = response.status;
    error.payload = parsed;
    throw error;
  }

  return parsed;
}

export async function ensureAgentLabels({ token, repoConfig, dryRun = false }) {
  const actions = [];

  for (const label of AGENT_LABEL_SPECS) {
    if (dryRun) {
      actions.push({ action: 'sync-label', label: label.name });
      continue;
    }

    try {
      await githubRequest(`/repos/${repoConfig.fullName}/labels/${encodeURIComponent(label.name)}`, {
        method: 'PATCH',
        token,
        body: label,
      });
      actions.push({ action: 'updated', label: label.name });
    } catch (error) {
      if (error.status !== 404) {
        throw error;
      }

      await githubRequest(`/repos/${repoConfig.fullName}/labels`, {
        method: 'POST',
        token,
        body: label,
      });
      actions.push({ action: 'created', label: label.name });
    }
  }

  return actions;
}

export async function listOpenIssues({ token, repoConfig, perPage = 100 }) {
  const issues = await githubRequest(
    `/repos/${repoConfig.fullName}/issues?state=open&per_page=${perPage}&sort=updated&direction=desc`,
    { token },
  );

  return Array.isArray(issues) ? issues.filter((issue) => !issue.pull_request) : [];
}

export async function listIssueComments({ token, repoConfig, issueNumber, perPage = 100 }) {
  const comments = await githubRequest(
    `/repos/${repoConfig.fullName}/issues/${issueNumber}/comments?per_page=${perPage}`,
    { token },
  );

  return Array.isArray(comments) ? comments : [];
}

export async function addIssueComment({ token, repoConfig, issueNumber, body, dryRun = false }) {
  if (dryRun) {
    return { dryRun: true, issueNumber, body };
  }

  return githubRequest(`/repos/${repoConfig.fullName}/issues/${issueNumber}/comments`, {
    method: 'POST',
    token,
    body: { body },
  });
}

export async function replaceIssueLabels({ token, repoConfig, issueNumber, labels, dryRun = false }) {
  if (dryRun) {
    return { dryRun: true, issueNumber, labels };
  }

  return githubRequest(`/repos/${repoConfig.fullName}/issues/${issueNumber}`, {
    method: 'PATCH',
    token,
    body: { labels },
  });
}

export async function createIssue({ token, repoConfig, title, body, labels, dryRun = false }) {
  if (dryRun) {
    return {
      dryRun: true,
      title,
      body,
      labels,
      html_url: `https://github.com/${repoConfig.fullName}/issues/dry-run`,
      number: 0,
    };
  }

  return githubRequest(`/repos/${repoConfig.fullName}/issues`, {
    method: 'POST',
    token,
    body: { title, body, labels },
  });
}

export function tryParseJson(value = '') {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function extractJsonBlock(value = '') {
  const trimmed = String(value || '').trim();
  const firstBrace = trimmed.indexOf('{');
  const firstBracket = trimmed.indexOf('[');
  const starts = [firstBrace, firstBracket].filter((index) => index >= 0).sort((left, right) => left - right);
  if (!starts.length) {
    throw new Error('Expected JSON output but could not find a JSON object or array.');
  }

  const startIndex = starts[0];
  const endBrace = trimmed.lastIndexOf('}');
  const endBracket = trimmed.lastIndexOf(']');
  const endIndex = Math.max(endBrace, endBracket);
  if (endIndex < startIndex) {
    throw new Error('Expected JSON output but could not find a matching closing token.');
  }

  return trimmed.slice(startIndex, endIndex + 1);
}

export async function callGeminiJson({ apiKey, prompt }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    },
  );

  const raw = await response.text();
  const parsed = tryParseJson(raw);

  if (!response.ok) {
    throw new Error(`Gemini request failed (${response.status}): ${raw.slice(0, 500)}`);
  }

  const text =
    parsed?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('').trim() ||
    parsed?.candidates?.[0]?.output?.trim() ||
    raw;

  return JSON.parse(extractJsonBlock(text));
}

export async function postSlackWebhook({ webhookUrl, text }) {
  if (!webhookUrl) {
    return { skipped: true };
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`Slack webhook failed (${response.status}): ${raw.slice(0, 500)}`);
  }

  return { ok: true };
}
