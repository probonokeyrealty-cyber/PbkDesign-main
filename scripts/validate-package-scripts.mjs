import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = resolve(root, 'package.json');
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
const scripts = packageJson.scripts || {};
const failures = [];

function addFailure(scriptName, message) {
  failures.push({ scriptName, message });
}

function stripQuotes(value = '') {
  return String(value).replace(/^['"]|['"]$/g, '');
}

function validatePath(scriptName, rawPath) {
  const cleanPath = stripQuotes(rawPath);
  const fullPath = resolve(root, cleanPath);
  if (!existsSync(fullPath)) {
    addFailure(scriptName, `referenced file does not exist: ${cleanPath}`);
  }
}

function validateNestedNpmScript(scriptName, prefixPath, nestedScript) {
  const nestedPackagePath = resolve(root, stripQuotes(prefixPath), 'package.json');
  if (!existsSync(nestedPackagePath)) {
    addFailure(scriptName, `npm --prefix target has no package.json: ${prefixPath}`);
    return;
  }
  const nestedPackage = JSON.parse(readFileSync(nestedPackagePath, 'utf8'));
  if (!nestedPackage.scripts?.[nestedScript]) {
    addFailure(scriptName, `npm --prefix ${prefixPath} is missing script: ${nestedScript}`);
  }
}

for (const [scriptName, command] of Object.entries(scripts)) {
  const text = String(command || '');

  for (const match of text.matchAll(
    /\bnode\s+((?:\.\/)?(?:scripts|node_modules)\/[^\s"'&|;]+?\.(?:mjs|js|cjs))/g
  )) {
    validatePath(scriptName, match[1]);
  }

  for (const match of text.matchAll(
    /(?:-File|\.|pwsh\s+-File|powershell\s+[^&|;]*-File)\s+((?:\.\/)?scripts\/[^\s"'&|;]+?\.ps1)/gi
  )) {
    validatePath(scriptName, match[1]);
  }

  for (const match of text.matchAll(/\bnpm\s+--prefix\s+([^\s]+)\s+run\s+([^\s&|;]+)/g)) {
    validateNestedNpmScript(scriptName, match[1], match[2]);
  }
}

if (failures.length) {
  console.error('Package script validation failed:');
  for (const failure of failures) {
    console.error(`- ${failure.scriptName}: ${failure.message}`);
  }
  process.exit(1);
}

console.log(`Package script validation passed: ${Object.keys(scripts).length} scripts checked.`);
