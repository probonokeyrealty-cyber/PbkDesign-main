import { AGENT_LABEL_SPECS, ensureAgentLabels, getGitHubToken, getRepoConfig } from './pbk-agent-lib.mjs';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  const repoConfig = getRepoConfig();
  const token = getGitHubToken();
  const actions = await ensureAgentLabels({ token, repoConfig, dryRun });

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun,
        repository: repoConfig.fullName,
        labels: AGENT_LABEL_SPECS.map((label) => label.name),
        actions,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
