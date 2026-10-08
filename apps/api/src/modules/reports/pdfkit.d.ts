/**
 * Minimal ambient typings for pdfkit.
 *
 * pdfkit 0.20 ships TypeScript sources but its `exports` map has no `types`
 * condition, so `moduleResolution: nodenext` cannot resolve them. This declares
 * exactly the surface the report exporter uses.
 */
declare module 'pdfkit' {
  interface PDFDocumentOptions {
    size?: string | [number, number];
    layout?: 'portrait' | 'landscape';
    margin?: number | { top?: number; bottom?: number; left?: number; right?: number };
    info?: Record<string, unknown>;
    autoFirstPage?: boolean;
    /** Required for `switchToPage`, used to stamp page numbers after layout. */
    bufferPages?: boolean;
  }

  interface PDFTextOptions {
    align?: 'left' | 'center' | 'right' | 'justify';
    width?: number;
    height?: number;
    lineBreak?: boolean;
    ellipsis?: boolean;
    continued?: boolean;
  }

  interface PDFPage {
    width: number;
    height: number;
    margins: { top: number; bottom: number; left: number; right: number };
  }

  class PDFDocument {
    constructor(options?: PDFDocumentOptions);
    readonly page: PDFPage;
    y: number;
    fontSize(size: number): this;
    font(name: string): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    text(text: string, x?: number, y?: number, options?: PDFTextOptions): this;
    text(text: string, options?: PDFTextOptions): this;
    moveDown(lines?: number): this;
    addPage(options?: PDFDocumentOptions): this;
    rect(x: number, y: number, width: number, height: number): this;
    fill(color?: string): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    stroke(): this;
    widthOfString(text: string, options?: PDFTextOptions): number;
    bufferedPageRange(): { start: number; count: number };
    switchToPage(pageNumber: number): this;
    end(): void;
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
  }

  export default PDFDocument;
}
