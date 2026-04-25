import type { Config, Context } from '@netlify/functions';
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

function buildMasterPackageUrl(req: Request, payload: DocumentRequest) {
  if (!payload.masterPackageQuery) return '';

  const url = new URL('/PBK_Master_Deal_Package.html', req.url);
  url.search = payload.masterPackageQuery.startsWith('?') ? payload.masterPackageQuery : `?${payload.masterPackageQuery}`;
  url.searchParams.set('pbk_preview', '1');
  url.searchParams.delete('pbk_print');

  return url.toString();
}

async function generatePdf(payload: DocumentRequest, req: Request) {
  let browser: Browser | undefined;

  try {
    browser = await launchBrowserWithRetry();
    const page = await browser.newPage();
    const masterPackageUrl = buildMasterPackageUrl(req, payload);

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

export default async (req: Request, _context: Context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const payload = (await req.json()) as DocumentRequest;
    const pdf = await enqueuePdf(() => generatePdf(payload, req));
    const filename = `${safeFilename(payload.masterPackageQuery ? 'PBK_Master_Deal_Package' : payload.documentTitle || payload.documentType || 'PBK_Document')}_${timestamp()}.pdf`;

    return new Response(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('PBK Documents PDF generation failed', error);
    return Response.json(
      {
        error: 'PDF generation failed',
        message: error instanceof Error ? error.message : 'Unknown PDF generation error',
      },
      { status: 500 },
    );
  }
};

export const config: Config = {
  path: '/api/documents/pdf',
  method: ['POST'],
};
