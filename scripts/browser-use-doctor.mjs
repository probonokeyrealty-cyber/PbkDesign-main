import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function print(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const tempDir = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Temp')
    : os.tmpdir();
  const tempPackagePath = path.join(tempDir, 'package.json');

  const result = {
    ok: true,
    tempDir,
    tempPackagePath,
    found: false,
    type: null,
    browserUseSafe: true,
    message: 'No temp package.json detected. Browser-use should not inherit an unexpected module type from Temp.',
    remediation: [],
  };

  if (!existsSync(tempPackagePath)) {
    print(result);
    return;
  }

  result.found = true;

  try {
    const raw = await readFile(tempPackagePath, 'utf8');
    const parsed = JSON.parse(raw);
    result.type = typeof parsed?.type === 'string' ? parsed.type : null;

    if (result.type === 'module') {
      result.ok = false;
      result.browserUseSafe = false;
      result.message =
        'Browser-use node_repl is likely to crash because Temp/package.json sets type=module, causing the REPL kernel file to be interpreted as ESM.';
      result.remediation = [
        'Rename or remove %LOCALAPPDATA%\\\\Temp\\\\package.json if it is not intentionally needed.',
        'Or change only that temp package.json type field away from "module".',
        'Then retry the @browser-use verification flow.',
      ];
    } else {
      result.message = `Temp/package.json exists but does not force ESM (type=${result.type || 'unset'}).`;
    }
  } catch (error) {
    result.ok = false;
    result.browserUseSafe = false;
    result.message = error instanceof Error ? error.message : 'Could not parse Temp/package.json';
    result.remediation = [
      'Inspect %LOCALAPPDATA%\\\\Temp\\\\package.json manually.',
      'Make sure it is valid JSON and does not set "type": "module" unless you truly want Temp-wide ESM semantics.',
    ];
  }

  print(result);
}

main().catch((error) => {
  print({
    ok: false,
    browserUseSafe: false,
    message: error instanceof Error ? error.message : 'Unexpected browser-use doctor failure',
  });
  process.exitCode = 1;
});
