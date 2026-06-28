import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, resolve, sep } from 'node:path';

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

function resolveScriptImport(importer, relativePath) {
  const resolved = normalize(join(dirname(importer), relativePath));
  if (resolved.startsWith(`..${sep}`) || resolved === '..') {
    throw new Error(`Bridge import escapes scripts/: ${importer} -> ${relativePath}`);
  }
  return resolved.replace(/\\/g, '/');
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
    const resolvedPath = resolveScriptImport(relativeFile, relativePath);
    relativeImports.push(resolvedPath);
    visit(resolvedPath);
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
