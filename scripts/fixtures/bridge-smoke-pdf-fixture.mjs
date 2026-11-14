// Synthetic one-page PDF: this checks route transport, not Chromium rendering.
const content = 'BT /F1 12 Tf 72 720 Td (PBK isolated smoke PDF fixture) Tj ET';
const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
];
let pdf = '%PDF-1.4\n';
const offsets = [0];
objects.forEach((object, index) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

export default {
  args: [], defaultViewport: null, executablePath: async () => 'offline-smoke-fixture',
  async launch() {
    return {
      close: async () => {},
      newPage: async () => ({
        setDefaultNavigationTimeout() {}, setDefaultTimeout() {},
        goto: async () => { throw new Error('Offline PDF fixture never navigates'); },
        setContent: async () => {}, emulateMediaType: async () => {}, evaluate: async () => {},
        pdf: async () => Buffer.from(pdf),
      }),
    };
  },
};
