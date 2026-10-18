/*
 * Gerador mínimo de PDF com uma imagem JPEG por página (sem dependências).
 * Cada página tem o tamanho da arte: 1 px = 0,75 pt (96 dpi), então o PDF abre
 * no mesmo tamanho visual e as imagens mantêm a resolução exportada.
 */

export type PdfPage = {
  /** Bytes de um JPEG (baseline ou progressivo). */
  jpeg: Uint8Array;
  /** Dimensões do JPEG em pixels. */
  pixelWidth: number;
  pixelHeight: number;
  /** Tamanho da página em pixels da arte (define o tamanho em pontos). */
  width: number;
  height: number;
};

const enc = new TextEncoder();

export function buildPdf(pages: PdfPage[], info: { title?: string } = {}): Uint8Array {
  if (!pages.length) throw new Error("PDF sem páginas.");
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n: number, body: () => void) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push("\nendobj\n");
  };

  // 1: catálogo, 2: árvore de páginas, 3: informações; depois 3 objetos por página.
  const pageObj = (i: number) => 4 + i * 3;
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
  object(2, () =>
    push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`),
  );
  object(3, () => push(`<< /Producer (Aragonez Builder) /Title ${pdfString(info.title ?? "Arte")} >>`));
  pages.forEach((p, i) => {
    const w = round(p.width * 0.75);
    const h = round(p.height * 0.75);
    const n = pageObj(i);
    object(n, () =>
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im${i} ${n + 1} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${n + 2} 0 R >>`,
      ),
    );
    object(n + 1, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${p.pixelWidth} /Height ${p.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      );
      push(p.jpeg);
      push("\nendstream");
    });
    const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im${i} Do\nQ`;
    object(n + 2, () => push(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`));
  });
  const count = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Texto PDF em UTF-16BE (aceita acentos) com escape. */
function pdfString(s: string) {
  let hex = "FEFF";
  for (const ch of s.slice(0, 200)) {
    const code = ch.codePointAt(0)!;
    if (code > 0xffff) {
      const v = code - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, "0");
    } else hex += code.toString(16).padStart(4, "0");
  }
  return `<${hex.toUpperCase()}>`;
}
