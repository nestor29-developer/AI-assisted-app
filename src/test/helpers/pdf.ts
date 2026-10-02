const escapePdf = (text: string) => text.replace(/[\\()]/g, (char) => `\\${char}`);

function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (line && line.length + word.length + 1 > width) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function contentStream(text: string): string {
  if (text === '') return '';
  const operations = wrap(text, 80).map(
    (line, index) => `${index === 0 ? '' : '0 -16 Td '}(${escapePdf(line)}) Tj`,
  );
  return `BT\n/F1 12 Tf\n72 740 Td\n${operations.join('\n')}\nET`;
}

/** A real, minimal PDF with one Helvetica text page per entry (ASCII only); an empty string is a blank page. */
export function buildPdf(pages: readonly string[]): Uint8Array {
  const pageObjects = pages.map((_, index) => 4 + index * 2);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pageObjects.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, index) => {
    const stream = contentStream(text);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObjects[index]! + 1} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
