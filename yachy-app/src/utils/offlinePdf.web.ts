import assets from './pdfEmbeddedAssets.json';
import { pdfPrintOptions, preparePdfHtml, type PdfOrientation } from './pdfLayout';
import { PdfExportError } from './pdfErrors';
// PDFMake's document tree permits nested tables, stacks, inline text and callbacks.
// Keep this boundary local; the library is a pinned browser asset, not a native dependency.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PdfNode = Record<string, any>;
type PdfEngine = {
  addVirtualFileSystem(v: Record<string, string>): void;
  addFonts(v: Record<string, unknown>): void;
  createPdf(v: PdfNode): { getBuffer(): Promise<Uint8Array> };
};
type PdfWindow = Window & {
  pdfMake?: PdfEngine;
  htmlToPdfmake?: (html: string, options: PdfNode) => PdfNode[];
};
let loading: Promise<void> | null = null;
async function loadEngine() {
  if (loading) return loading;
  loading = (async () => {
    for (const name of [
      'pdfmake-0.3.14.min.js',
      'pdfmake-fonts-0.3.14.js',
      'html-to-pdfmake-2.5.36.js',
    ])
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `/offline-pdf/${name}`;
        script.async = false;
        const timer = setTimeout(() => {
          script.remove();
          reject(
            new PdfExportError(
              'PDF tools are not downloaded yet. Reconnect and let offline preparation finish.'
            )
          );
        }, 15000);
        script.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        script.onerror = () => {
          clearTimeout(timer);
          script.remove();
          reject(
            new PdfExportError(
              'PDF tools are not downloaded yet. Reconnect and let offline preparation finish.'
            )
          );
        };
        document.head.appendChild(script);
      });
    const engine = (window as PdfWindow).pdfMake;
    if (!engine) throw new Error('PDF engine unavailable');
    engine.addVirtualFileSystem({ 'AlexBrush.ttf': assets.signatureFont });
    engine.addFonts({
      Alexbrush: {
        normal: 'AlexBrush.ttf',
        bold: 'AlexBrush.ttf',
        italics: 'AlexBrush.ttf',
        bolditalics: 'AlexBrush.ttf',
      },
    });
  })();
  try {
    await loading;
  } catch (e) {
    loading = null;
    throw e;
  }
}
const number = (s: string) => Number.parseFloat(s) || 0;
const colour = (s: string) => {
  const m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/);
  return m && (m[4] === undefined || Number(m[4]) > 0)
    ? '#' +
        m
          .slice(1, 4)
          .map((x) => Number(x).toString(16).padStart(2, '0'))
          .join('')
    : null;
};
/** Layout is measured in a script-disabled, network-disabled frame. Only embedded images/fonts enter the PDF. */
export async function renderOfflinePdf(
  html: string,
  title: string,
  orientation: PdfOrientation,
  headerInContent: boolean
): Promise<Uint8Array> {
  await loadEngine();
  const parsed = new DOMParser().parseFromString(
    preparePdfHtml(html, title, orientation, false, headerInContent),
    'text/html'
  );
  parsed
    .querySelectorAll('script,iframe,object,embed,link,base,meta[http-equiv],video,audio,source')
    .forEach((n) => n.remove());
  for (const el of Array.from(parsed.querySelectorAll('*')))
    for (const attr of Array.from(el.attributes))
      if (/^on/i.test(attr.name) || ['srcset', 'href', 'action', 'formaction'].includes(attr.name))
        el.removeAttribute(attr.name);
  for (const img of Array.from(parsed.images))
    if (!/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\s]+$/.test(img.src))
      throw new PdfExportError(
        'An image in this document is not available offline. Reconnect and download it before exporting.'
      );
  const walker = parsed.createTreeWalker(parsed.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode())
    walker.currentNode.textContent = walker.currentNode.textContent?.replace(/→/g, 'to') ?? '';
  const csp = parsed.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'";
  parsed.head.prepend(csp);
  const options = pdfPrintOptions(orientation, headerInContent),
    contentWidth = options.width - options.margins.left - options.margins.right;
  const frame = document.createElement('iframe');
  frame.title = 'Preparing PDF';
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    width: `${contentWidth / 0.75}px`,
    height: '1000px',
    border: '0',
  });
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('PDF layout timed out')), 15000);
      frame.onload = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    frame.srcdoc = parsed.documentElement.outerHTML;
    document.body.appendChild(frame);
    await loaded;
    const doc = frame.contentDocument!,
      view = frame.contentWindow!;
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images).map((img) => img.decode()));
    // Preserve measured CSS before conversion to a flowing PDF document. No screenshot slicing.
    const measurements = Array.from(doc.body.querySelectorAll<HTMLElement>('*')).map((el) => {
      const c = view.getComputedStyle(el),
        rect = el.getBoundingClientRect();
      if (c.display === 'none')
        return { el, hidden: true, style: '', layout: '', table: '', width: 0, height: 0 };
      const style = [
        'font-size',
        'font-weight',
        'font-style',
        'color',
        'text-align',
        'text-decoration',
        'white-space',
        'margin-top',
        'margin-bottom',
        'margin-left',
        'margin-right',
      ]
        .map((k) => {
          const value = c.getPropertyValue(k);
          return `${k}:${k === 'text-align' ? value.replace('start', 'left').replace('end', 'right') : value}`;
        })
        .join(';');
      const layout = JSON.stringify({
        display: c.display,
        direction: c.flexDirection,
        justify: c.justifyContent,
        width: rect.width * 0.75,
        height: rect.height * 0.75,
        gap: number(c.columnGap) * 0.75,
        keepTogether: c.breakInside === 'avoid' || el.classList.contains('sigrow'),
        margin: [c.marginLeft, c.marginTop, c.marginRight, c.marginBottom].map(
          (x) => number(x) * 0.75
        ),
        padding: [c.paddingLeft, c.paddingTop, c.paddingRight, c.paddingBottom].map(
          (x) => number(x) * 0.75
        ),
        border: [c.borderLeftWidth, c.borderTopWidth, c.borderRightWidth, c.borderBottomWidth].map(
          (x) => number(x) * 0.75
        ),
        borderColor: colour(c.borderTopColor),
        background:
          colour(c.backgroundColor) ??
          (['TD', 'TH'].includes(el.tagName) && el.parentElement
            ? colour(view.getComputedStyle(el.parentElement).backgroundColor)
            : null),
        children: Array.from(el.children).map(
          (child) => child.getBoundingClientRect().width * 0.75
        ),
      });
      const measuredStyle =
        style +
        `;font-family:${c.fontFamily.includes('AlexBrush') ? 'AlexBrush' : 'Roboto'};line-height:${number(c.lineHeight) / number(c.fontSize) || 1.2}`;
      let measuredTable = '';
      if (el.tagName === 'TABLE') {
        const table = el as HTMLTableElement;
        const row = Array.from(table.rows).sort((a, b) => b.cells.length - a.cells.length)[0];
        const widths = row
          ? Array.from(row.cells).flatMap((cell) =>
              Array.from(
                { length: cell.colSpan },
                () => (cell.getBoundingClientRect().width * 0.75) / cell.colSpan
              )
            )
          : [];
        measuredTable = JSON.stringify({ widths, headerRows: table.tHead?.rows.length ?? 0 });
      }
      return {
        el,
        hidden: false,
        style: measuredStyle,
        layout,
        table: measuredTable,
        width: rect.width,
        height: rect.height,
      };
    });
    // Apply only after every descendant was measured against the original CSS.
    for (const m of measurements) {
      if (m.hidden) {
        m.el.remove();
        continue;
      }
      m.el.dataset.pdfLayout = m.layout;
      m.el.setAttribute('style', m.style);
      if (m.table) m.el.dataset.pdfTable = m.table;
      if (m.el.tagName === 'IMG') {
        m.el.style.width = `${m.width}px`;
        m.el.style.height = `${m.height}px`;
      }
    }
    // Indentation between block elements is not printable content. Preserve inline word spaces.
    for (const parent of Array.from(doc.body.querySelectorAll<HTMLElement>('*')).concat(doc.body)) {
      const display = JSON.parse(parent.dataset.pdfLayout ?? '{}').display;
      for (const node of Array.from(parent.childNodes))
        if (node.nodeType === 3 && !node.textContent?.trim()) {
          const block = (n: ChildNode | null) =>
            n?.nodeType === 1 &&
            [
              'block',
              'grid',
              'flex',
              'table',
              'table-row-group',
              'table-header-group',
              'table-row',
            ].includes(JSON.parse((n as HTMLElement).dataset.pdfLayout ?? '{}').display);
          if (
            display === 'flex' ||
            display === 'grid' ||
            block(node.previousSibling) ||
            block(node.nextSibling)
          )
            node.remove();
        }
    }
    const converter = (window as PdfWindow).htmlToPdfmake!;
    const content = converter(doc.body.innerHTML, {
      window: view,
      tableAutoSize: false,
      defaultStyles: {
        h1: {},
        h2: {},
        h3: {},
        p: { margin: 0 },
        table: { margin: 0 },
        th: {},
        ul: { margin: 0 },
      },
      customTag: ({ element, ret }: { element: HTMLElement; ret: PdfNode }) => {
        const info = JSON.parse(element.dataset.pdfLayout ?? '{}'),
          tag = element.tagName;
        if (info.margin && ['block', 'grid', 'flex', 'table'].includes(info.display)) {
          ret.margin = info.margin;
          delete ret.marginLeft;
          delete ret.marginTop;
          delete ret.marginRight;
          delete ret.marginBottom;
        }
        if (
          info.keepTogether &&
          info.height < options.height - options.margins.top - options.margins.bottom - 30
        )
          ret.unbreakable = true;
        if (ret.table) {
          const t = JSON.parse(element.dataset.pdfTable ?? '{}');
          if (t.widths?.length) {
            const total = t.widths.reduce((a: number, b: number) => a + b, 0);
            ret.table.widths = t.widths.map((w: number) =>
              Math.max(1, (w / total) * (Math.min(info.width, contentWidth) - t.widths.length * 3))
            );
          }
          ret.table.headerRows = t.headerRows ?? 0;
          ret.table.dontBreakRows = false;
          ret.layout = {
            hLineWidth: () => 0.4,
            vLineWidth: () => 0.4,
            hLineColor: () => '#cbd5e1',
            vLineColor: () => '#cbd5e1',
            paddingLeft: () => 1.1,
            paddingRight: () => 1.1,
            paddingTop: () => (headerInContent ? 0.75 : 1.5),
            paddingBottom: () => (headerInContent ? 0.75 : 1.5),
          };
          return ret;
        }
        if (tag === 'TD' || tag === 'TH') {
          if (info.background) ret.fillColor = info.background;
          return ret;
        }
        // Structural table nodes must remain intact for the converter's row assembly.
        if (['THEAD', 'TBODY', 'TFOOT', 'TR', 'COLGROUP', 'COL'].includes(tag)) return ret;
        if (
          tag === 'IMG' ||
          (['SPAN', 'STRONG', 'B', 'EM', 'I', 'A', 'BR'].includes(tag) &&
            !['block', 'flex', 'grid'].includes(info.display))
        )
          return ret;
        if (['block', 'flex', 'grid'].includes(info.display)) ret.nodeName = 'DIV';
        let children = ret.stack ?? ret.text;
        if (
          (info.display === 'grid' || (info.display === 'flex' && info.direction !== 'column')) &&
          Array.isArray(children) &&
          children.length
        ) {
          children = children.filter((v: PdfNode | string) =>
            typeof v === 'string'
              ? !!v.trim()
              : !(typeof v.text === 'string' && !v.text.trim() && !v.nodeName)
          );
          const widths = info.children ?? [];
          const sum = widths.reduce((a: number, b: number) => a + b, 0) || 1;
          const available = Math.max(
            1,
            info.width - (info.padding?.[0] ?? 0) - (info.padding?.[2] ?? 0)
          );
          const gap =
            info.justify === 'space-between' && children.length > 1
              ? Math.max(info.gap ?? 0, (available - sum) / (children.length - 1))
              : (info.gap ?? 0);
          const scale = Math.min(1, (available - (children.length - 1) * gap) / sum);
          ret = {
            ...ret,
            nodeName: 'DIV',
            columns: children.map((child: PdfNode, i: number) => ({
              stack: [child],
              width: Math.max(1, (widths[i] ?? sum / children.length) * scale),
            })),
            columnGap: gap,
          };
          delete ret.stack;
          delete ret.text;
          if (info.justify === 'center')
            ret.margin = [
              Math.max(0, (available - sum - (children.length - 1) * gap) / 2),
              0,
              0,
              0,
            ];
        }
        if (
          (info.border?.some((n: number) => n > 0) ||
            info.padding?.some((n: number) => n > 0) ||
            info.background) &&
          !['BODY', 'UL', 'OL', 'LI'].includes(tag)
        ) {
          const [left, top, right, bottom] = info.padding ?? [0, 0, 0, 0],
            b = info.border ?? [0, 0, 0, 0],
            margin = ret.margin;
          delete ret.margin;
          return {
            nodeName: 'DIV',
            unbreakable: ret.unbreakable,
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    ...ret,
                    fillColor: info.background ?? undefined,
                    border: b.map((n: number) => n > 0),
                  },
                ],
              ],
            },
            margin,
            layout: {
              hLineWidth: (i: number) => (i === 0 ? b[1] : b[3]),
              vLineWidth: (i: number) => (i === 0 ? b[0] : b[2]),
              hLineColor: () => info.borderColor ?? '#cbd5e1',
              vLineColor: () => info.borderColor ?? '#cbd5e1',
              paddingLeft: () => left,
              paddingTop: () => top,
              paddingRight: () => right,
              paddingBottom: () => bottom,
            },
          };
        }
        return ret;
      },
    });
    const engine = (window as PdfWindow).pdfMake!;
    return new Uint8Array(
      await engine
        .createPdf({
          pageSize: { width: options.width, height: options.height },
          pageMargins: [
            options.margins.left,
            options.margins.top,
            options.margins.right,
            options.margins.bottom,
          ],
          defaultStyle: { font: 'Roboto', fontSize: 9, color: '#0f172a' },
          content,
          info: { title, creator: 'Nautical Ops' },
        })
        .getBuffer()
    );
  } finally {
    frame.remove();
  }
}
