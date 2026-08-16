/**
 * Reading text back out of a generated PDF.
 *
 * The avisos are the one export a shareholder receives on paper, so a test that
 * only checks the rows handed to `autoTable` proves nothing about what was
 * printed. jsPDF writes uncompressed content streams, so every string reaches
 * the page as `(texto) Tj` and can be read back exactly.
 */
import type jsPDF from 'jspdf'

const TJ = /\(((?:\\[\s\S]|[^\\()])*)\)\s*Tj/g

/**
 * The bytes jsPDF writes are WinAnsi, which matches latin1 except for this
 * range. Only the characters the exports actually use are mapped.
 */
const WINANSI: Record<number, string> = {
  0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x96: '–', 0x97: '—'
}

function decode(raw: string): string {
  return raw
    // jsPDF escapes some bytes and writes others straight, so both forms appear.
    .replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\([\s\S])/g, '$1')
    .replace(/[\x80-\x9f]/g, ch => WINANSI[ch.charCodeAt(0)] ?? ch)
}

/** Every string the document draws, in the order it draws them. */
export function pdfLineas(doc: jsPDF): string[] {
  const raw = doc.output()
  const out: string[] = []
  for (const match of raw.matchAll(TJ)) out.push(decode(match[1]))
  return out
}

/** The whole document as one searchable string. */
export function pdfTexto(doc: jsPDF): string {
  return pdfLineas(doc).join('\n')
}
