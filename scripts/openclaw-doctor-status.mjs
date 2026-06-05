import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'openclaw-doctor';
const args =
  process.platform === 'win32'
    ? ['/d', '/s', '/c', 'openclaw-doctor status --json']
    : ['status', '--json'];
const child = spawn(command, args, {
  stdio: ['ignore', 'pipe', 'pipe'],
});

child.stdout.pipe(process.stdout);

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

let finished = false;

function finish(code) {
  if (finished) return;
  finished = true;
  process.exitCode = code;
}

child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  finish(1);
});

child.on('close', (code) => {
  const filtered = stderr
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== "'which' is not recognized as an internal or external command,"
        && trimmed !== 'operable program or batch file.';
    })
    .join('\n')
    .trim();

  if (filtered) {
    process.stderr.write(`${filtered}\n`);
  }
  finish(code ?? 1);
});
