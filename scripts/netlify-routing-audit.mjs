export function checkNetlifyCommandCenterRouting(config) {
  const redirects = config
    .split(/^(?=[ \t]*\[{1,2}[\w.-]+\]{1,2}[ \t]*\r?$)/m)
    .filter((block) => /^[ \t]*\[\[redirects\]\][ \t]*\r?$/m.test(block));

  // Netlify uses the first matching redirect, so a later correct rule is not enough.
  const findRule = (from) => redirects.findIndex(
    (block) => block.match(/^[ \t]*from[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*\r?$/m)?.[1] === from
  );
  const rewritesTo = (index, target, force = false) => {
    const block = redirects[index] || '';
    return block.match(/^[ \t]*to[ \t]*=[ \t]*"([^"\r\n]+)"[ \t]*\r?$/m)?.[1] === target &&
      /^[ \t]*status[ \t]*=[ \t]*200[ \t]*\r?$/m.test(block) &&
      (!force || /^[ \t]*force[ \t]*=[ \t]*true[ \t]*\r?$/m.test(block));
  };

  const brain = findRule('/brain');
  const brainApi = findRule('/brain/*');
  const api = findRule('/api/*');
  const fallback = findRule('/*');
  return {
    brain: rewritesTo(brain, '/index.shell.html', true) && brain < brainApi,
    brainApi: rewritesTo(brainApi, '/.netlify/functions/pbk-bridge-proxy?path=/brain/:splat', true) && brainApi < fallback,
    api: rewritesTo(api, '/.netlify/functions/pbk-bridge-proxy?path=/api/:splat', true) && api < fallback,
    fallback: rewritesTo(fallback, '/index.shell.html'),
  };
}
