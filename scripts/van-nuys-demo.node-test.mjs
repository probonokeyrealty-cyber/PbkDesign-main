import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import Papa from 'papaparse';
import { PDFParse } from 'pdf-parse';

const file = (path) => new URL('../' + path, import.meta.url);
const read = (path) => readFileSync(file(path), 'utf8');
const receipt = 'src/assets/van-nuys/receipt';

test('Van Nuys is a staff-shell page linked from the existing Dialer', () => {
  assert.match(read('src/app/shell/router.tsx'), /path: 'dialer\/van-nuys-demo', element: <VanNuysDemo \/>/);
  assert.match(read('src/app/routes/ParcelDialer.tsx'), /to="\/dialer\/van-nuys-demo"/);
  assert.match(read('netlify.toml'), /from = "\/dialer\/van-nuys-demo"\r?\nto = "\/index.shell.html"\r?\nstatus = 200/);
});

test('Van Nuys jump links point to keyboard-focusable headings on the same page', () => {
  const route = read('src/app/routes/VanNuysDemo.tsx');
  const nav = route.match(/<nav [^>]*aria-label="Jump to saved evidence or receipt"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  const targets = [...nav.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(targets, ['van-evidence-title', 'van-receipt-title']);
  for (const target of targets) assert.ok(route.includes(`<h2 id="${target}" tabIndex={-1}>`));
});

test('every export preserves the run ID and Rex-verified shortlist from staging', async () => {
  const saved = JSON.parse(read(receipt + '.json'));
  assert.equal(saved.run_id, 'hermes-dry-dec31223-4f0d-42f7-8ffe-82bdc37d7951');
  assert.equal(saved.mode, 'staging_fixture');
  assert.equal(saved.fixture_reads, 1);
  assert.equal(saved.held_count, 0);
  assert.equal(saved.rechecks.length, 3);
  assert.equal(saved.fits.length, 4);
  assert.ok(saved.rechecks.every(({ first_attempt, recheck }) => first_attempt.status === 'held' && recheck.status === 'verified'));
  assert.ok(saved.fits.every(fit => fit.verification === 'Rex verified'));
  const csv = Papa.parse(read(receipt + '.csv'), { header: true, skipEmptyLines: true });
  assert.deepEqual(csv.errors, []);
  assert.deepEqual(csv.data, saved.fits.map(fit => ({ run_id: saved.run_id, ...fit })));
  const pdf = new PDFParse({ data: readFileSync(file(receipt + '.pdf')) });
  try {
    const { text, total } = await pdf.getText();
    assert.equal(total, 1);
    for (const content of [text, read(receipt + '.txt')]) {
      assert.ok(content.includes(saved.run_id));
      assert.equal(content.match(/\| Rex verified/g)?.length, saved.fits.length);
      for (const { property } of saved.fits) assert.ok(content.includes(property));
      for (const { label } of saved.rechecks) assert.ok(content.includes(label));
      assert.doesNotMatch(content, /Netlify site tools|Make public/);
    }
  } finally {
    await pdf.destroy();
  }
});
