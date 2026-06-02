import type { Handler } from '@netlify/functions';
import chromium from '@sparticuz/chromium';
import puppeteer, { Browser } from 'puppeteer-core';
import { existsSync } from 'node:fs';

type DocumentRequest = {
  documentType?: string;
  documentTitle?: string;
  content?: string;
  propertyAddress?: string;
  selectedPathLabel?: string;
  companyName?: string;
  masterPackageQuery?: string;
};

const MAX_CONCURRENT_PDFS = 2;
let activeJobs = 0;
const queue: Array<() => void> = [];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeFilename(value: string) {
  return String(value || 'PBK_Document')
    .replace(/[^a-z0-9_-]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

function getHeader(event: Parameters<Handler>[0], name: string) {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (key.toLowerCase() === wanted) return String(value || '').trim();
  }
  return '';
}

function getRequestId(event: Parameters<Handler>[0]) {
  return getHeader(event, 'x-request-id')
    || `pbk-documents-pdf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function pdfEscape(value: string) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '');
}

function wrapPdfText(value: string, width = 88) {
  const words = String(value || '').replace(/\r/g, '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['No document content available.'];
}

function buildSimplePdf(payload: DocumentRequest) {
  const title = payload.documentTitle || payload.documentType || 'PBK Document';
  const company = payload.companyName || 'Probono Key Realty';
  const address = payload.propertyAddress || 'No property loaded';
  const pathLabel = payload.selectedPathLabel || 'Selected Path';
  const bodyLines = wrapPdfText(payload.content || 'No document content available.');
  const lines = [
    { size: 18, text: title },
    { size: 10, text: company },
    { size: 10, text: `${pathLabel} | ${address} | ${new Date().toLocaleDateString('en-US')}` },
    { size: 10, text: '' },
    ...bodyLines.slice(0, 48).map((text) => ({ size: 10, text })),
  ];

  const commands = ['BT', '72 760 Td'];
  let previousSize = 0;
  lines.forEach((line, index) => {
    if (line.size !== previousSize) {
      commands.push(`/F1 ${line.size} Tf`);
      previousSize = line.size;
    }
    if (index > 0) commands.push(`0 -${line.size + 6} Td`);
    commands.push(`(${pdfEscape(line.text)}) Tj`);
  });
  commands.push('ET');

  const stream = commands.join('\n');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream\nendobj\n`,
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, 'ascii'));
    pdf += object;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

function getLocalChromePath() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  return candidates.find((candidate) => {
    try {
      return Boolean(candidate && existsSync(candidate));
    } catch {
      return false;
    }
  });
}

async function launchBrowserWithRetry(): Promise<Browser> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const localChromePath = process.env.NETLIFY ? '' : getLocalChromePath();
      return await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: localChromePath || (await chromium.executablePath()),
        headless: 'new' as never,
      });
    } catch (error) {
      lastError = error;
      console.error(`PBK PDF browser launch failed on attempt ${attempt}`, error);
      if (attempt < 3) await sleep(1000);
    }
  }

  throw lastError;
}

function renderDocumentHtml(payload: DocumentRequest) {
  const title = payload.documentTitle || 'PBK Document';
  const company = payload.companyName || 'Probono Key Realty';
  const address = payload.propertyAddress || 'No property loaded';
  const pathLabel = payload.selectedPathLabel || 'Selected Path';
  const body = payload.content || 'No document content available.';

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: Letter; margin: 0.5in; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        color: #111827;
        background: #f8fafc;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        line-height: 1.5;
      }
      .page {
        min-height: 10in;
        border: 1px solid #dbe3ef;
        border-radius: 22px;
        background: rgba(255,255,255,0.94);
        padding: 28px;
        box-shadow: 0 20px 45px rgba(15,23,42,0.08);
      }
      .eyebrow {
        color: #2563eb;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.18em;
        text-transform: uppercase;
      }
      h1 {
        margin: 8px 0 6px;
        font-size: 26px;
        line-height: 1.15;
        letter-spacing: -0.03em;
      }
      .meta {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        margin: 14px 0 20px;
      }
      .pill {
        border: 1px solid #dbeafe;
        border-radius: 999px;
        background: #eff6ff;
        color: #1d4ed8;
        padding: 6px 10px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      pre {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
        font-size: 11.5px;
        line-height: 1.65;
      }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="eyebrow">${escapeHtml(company)}</div>
      <h1>${escapeHtml(title)}</h1>
      <div class="meta">
        <span class="pill">${escapeHtml(pathLabel)}</span>
        <span class="pill">${escapeHtml(address)}</span>
        <span class="pill">${escapeHtml(new Date().toLocaleDateString('en-US'))}</span>
      </div>
      <pre>${escapeHtml(body)}</pre>
    </main>
  </body>
</html>`;
}

function buildMasterPackageUrl(requestUrl: string, payload: DocumentRequest) {
  if (!payload.masterPackageQuery) return '';

  const url = new URL('/PBK_Master_Deal_Package.html', requestUrl || 'https://pbkcommandcenter.netlify.app');
  url.search = payload.masterPackageQuery.startsWith('?') ? payload.masterPackageQuery : `?${payload.masterPackageQuery}`;
  url.searchParams.set('pbk_preview', '1');
  url.searchParams.delete('pbk_print');

  return url.toString();
}

async function generatePdf(payload: DocumentRequest, requestUrl: string) {
  let browser: Browser | undefined;

  try {
    browser = await launchBrowserWithRetry();
    const page = await browser.newPage();
    const masterPackageUrl = buildMasterPackageUrl(requestUrl, payload);

    if (masterPackageUrl) {
      await page.goto(masterPackageUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      await page.emulateMediaType('print');
      await page.evaluate(() => document.fonts?.ready);
      await sleep(500);
    } else {
      await page.setContent(renderDocumentHtml(payload), { waitUntil: 'networkidle0' });
    }

    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.6in',
        left: '0.5in',
      },
      headerTemplate:
        '<div style="width:100%;font-size:9px;color:#64748b;padding:0 0.5in;font-family:Inter,Arial,sans-serif;">PBK Deal Package</div>',
      footerTemplate:
        '<div style="width:100%;font-size:9px;color:#64748b;padding:0 0.5in;font-family:Inter,Arial,sans-serif;text-align:right;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>',
    });
  } finally {
    if (browser) await browser.close();
  }
}

function enqueuePdf<T>(job: () => Promise<T>) {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeJobs += 1;
      job()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          activeJobs -= 1;
          const next = queue.shift();
          if (next) next();
        });
    };

    if (activeJobs < MAX_CONCURRENT_PDFS) run();
    else queue.push(run);
  });
}

export const handler: Handler = async (event) => {
  const requestId = getRequestId(event);

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
      body: 'Method not allowed',
    };
  }

  try {
    const payload = JSON.parse(event.body || '{}') as DocumentRequest;
    const rawUrl = (event as unknown as { rawUrl?: string }).rawUrl;
    const host = event.headers['x-forwarded-host'] || event.headers['host'] || 'pbkcommandcenter.netlify.app';
    const requestUrl = rawUrl || `https://${host}${event.path || '/api/documents/pdf'}`;
    let pdf: Buffer | Uint8Array;
    let fallbackRenderer = false;
    try {
      pdf = await enqueuePdf(() => generatePdf(payload, requestUrl));
    } catch (error) {
      fallbackRenderer = true;
      console.warn('PBK Documents PDF chromium renderer unavailable; using simple PDF fallback', error);
      pdf = buildSimplePdf(payload);
    }
    const filename = `${safeFilename(payload.masterPackageQuery ? 'PBK_Master_Deal_Package' : payload.documentTitle || payload.documentType || 'PBK_Document')}_${timestamp()}.pdf`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Request-ID': requestId,
        ...(fallbackRenderer ? { 'X-PBK-PDF-Renderer': 'simple-fallback' } : {}),
      },
      body: Buffer.from(pdf).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('PBK Documents PDF generation failed', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
      body: JSON.stringify({
        error: 'PDF generation failed',
        message: error instanceof Error ? error.message : 'Unknown PDF generation error',
        requestId,
      }),
    };
  }
};
