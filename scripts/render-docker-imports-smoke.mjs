import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const server = readFileSync(resolve(root, 'scripts/openclaw-local-server.mjs'), 'utf8');
const dockerfile = readFileSync(resolve(root, 'Dockerfile.openclaw'), 'utf8');

const relativeImports = [
  ...server.matchAll(/from\s+['"]\.\/([^'"]+)['"]/g),
].map((match) => match[1]);

const missing = relativeImports.filter((relativePath) => {
  const segments = relativePath.split('/');
  const packaged = segments.some((_, index) => {
    const packagedPath = segments.slice(0, index + 1).join('/');
    return dockerfile.includes(
      `COPY scripts/${packagedPath} ./scripts/${packagedPath}`
    );
  });
  return !packaged;
});

if (missing.length) {
  throw new Error(
    `Dockerfile.openclaw does not package bridge imports: ${missing.join(', ')}`
  );
}

console.log(
  JSON.stringify(
    {
      ok: true,
      result: 'render_docker_imports_ready',
      checkedImports: relativeImports.length,
    },
    null,
    2
  )
);
