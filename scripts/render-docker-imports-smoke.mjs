import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const dockerfile = readFileSync(resolve(root, 'Dockerfile.openclaw'), 'utf8');
const entrypoint = 'openclaw-local-server.mjs';

function getRelativeScriptImports(relativeFile) {
  const absoluteFile = resolve(root, 'scripts', relativeFile);
  if (!existsSync(absoluteFile)) return [];
  const source = readFileSync(absoluteFile, 'utf8');
  const imports = [];
  const importPattern =
    /(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?from\s+)['"]\.\/([^'"]+)['"]|await\s+import\(['"]\.\/([^'"]+)['"]\)/g;
  for (const match of source.matchAll(importPattern)) {
    const relativePath = match[1] || match[2] || '';
    if (/\.(?:mjs|js)$/.test(relativePath)) imports.push(relativePath);
  }
  return imports;
}

function dockerfilePackages(relativePath) {
  const segments = relativePath.split('/');
  return segments.some((_, index) => {
    const packagedPath = segments.slice(0, index + 1).join('/');
    return dockerfile.includes(`COPY scripts/${packagedPath} ./scripts/${packagedPath}`);
  });
}

const seen = new Set();
const relativeImports = [];

function visit(relativeFile) {
  if (seen.has(relativeFile)) return;
  seen.add(relativeFile);

  for (const relativePath of getRelativeScriptImports(relativeFile)) {
    relativeImports.push(relativePath);
    visit(relativePath);
  }
}

visit(entrypoint);

const missing = [...new Set(relativeImports.filter((relativePath) => !dockerfilePackages(relativePath)))];

if (missing.length) {
  throw new Error(
    `Dockerfile.openclaw does not package bridge imports reachable from ${entrypoint}: ${missing.join(', ')}`
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'render_docker_imports_ready',
      checkedImports: relativeImports.length,
      checkedFiles: seen.size,
    },
    null,
    2
  )
);
