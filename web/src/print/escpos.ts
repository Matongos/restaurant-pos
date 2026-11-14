/**
 * Turns the ticket HTML (print/tickets.ts) into ESC/POS bytes for a thermal printer,
 * so a linked printer prints straight away with no print screen.
 *
 * The ticket layouts stay in one place: this walks the same HTML and maps its few
 * classes (num, type, line, table rows, hr …) to printer text sizes, bold and alignment.
 */

export type PaperWidth = 58 | 80;

const ESC = 0x1b;
const GS = 0x1d;

/** Characters per line in the printer's normal font. */
export const colsFor = (w: PaperWidth) => (w === 58 ? 32 : 48);
const dotsFor = (w: PaperWidth) => (w === 58 ? 384 : 576);

/** Printers here use plain ASCII safely; swap the few special characters the tickets use. */
export function ascii(s: string): string {
  return s
    .replace(/[   ]/g, ' ')
    .replace(/×/g, 'x')
    .replace(/»/g, '>>')
    .replace(/[·•]/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/€/g, 'EUR')
    .replace(/£/g, 'GBP')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '?');
}

type Seg = { text: string; bold: boolean };
type Align = 0 | 1 | 2;

class Out {
  bytes: number[] = [];
  constructor(public width: PaperWidth) {
    this.raw(ESC, 0x40); // initialise
  }
  raw(...b: number[]) {
    for (const x of b) this.bytes.push(x & 0xff);
  }
  text(s: string) {
    for (const ch of ascii(s)) this.bytes.push(ch.charCodeAt(0));
  }
  align(a: Align) {
    this.raw(ESC, 0x61, a);
  }
  bold(on: boolean) {
    this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** Text size: 1–8 times wider and taller. */
  size(w: number, h: number) {
    this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  }
  nl(n = 1) {
    for (let i = 0; i < n; i++) this.bytes.push(0x0a);
  }
  /** Writes segments word-wrapped to the line width at this text width. */
  para(segs: Seg[], opts: { align?: Align; w?: number; h?: number; indent?: number; bold?: boolean } = {}) {
    const w = opts.w ?? 1;
    const h = opts.h ?? 1;
    const cols = Math.max(8, Math.floor(colsFor(this.width) / w));
    const indent = ' '.repeat(opts.indent ?? 0);
    // Split into words keeping bold per word.
    const words: Seg[] = [];
    for (const s of segs)
      for (const part of ascii(s.text).split(/(\s+)/))
        if (part) words.push({ text: part, bold: s.bold || !!opts.bold });
    const lines: Seg[][] = [];
    let cur: Seg[] = [];
    let len = 0;
    const push = () => {
      while (cur.length && /^\s+$/.test(cur[cur.length - 1].text)) cur.pop();
      lines.push(cur);
      cur = [];
      len = 0;
    };
    for (const wd of words) {
      if (/^\s+$/.test(wd.text)) {
        if (len > 0 && len < cols) {
          cur.push({ text: ' ', bold: wd.bold });
          len++;
        }
        continue;
      }
      let t = wd.text;
      const room = cols - indent.length;
      if (len + t.length > room && len > 0) push();
      while (t.length > room) {
        cur.push({ text: t.slice(0, room - len), bold: wd.bold });
        t = t.slice(room - len);
        push();
      }
      cur.push({ text: t, bold: wd.bold });
      len += t.length;
    }
    if (cur.length || !lines.length) push();
    this.align(opts.align ?? 0);
    this.size(w, h);
    for (const ln of lines) {
      if (indent) this.text(indent);
      for (const s of ln) {
        this.bold(s.bold);
        this.text(s.text);
      }
      this.bold(false);
      this.nl();
    }
    this.size(1, 1);
    this.align(0);
  }
  /** Left text and right text on one line (prices). Long left text wraps above. */
  row(left: string, right: string, bold = false) {
    const cols = colsFor(this.width);
    const l = ascii(left).trim();
    const r = ascii(right).trim();
    this.align(0);
    this.bold(bold);
    const room = cols - r.length - 1;
    const words = l.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const wd of words) {
      if ((cur ? cur.length + 1 : 0) + wd.length > room && cur) {
        lines.push(cur);
        cur = wd;
      } else cur = cur ? `${cur} ${wd}` : wd;
    }
    lines.push(cur);
    lines.forEach((ln, i) => {
      if (i < lines.length - 1) this.text(ln.slice(0, cols));
      else this.text(ln.slice(0, room).padEnd(room, ' ') + ' ' + r);
      this.nl();
    });
    this.bold(false);
  }
  rule(ch = '-') {
    this.align(0);
    this.text(ch.repeat(colsFor(this.width)));
    this.nl();
  }
  /** Black-and-white picture (logo), printed as a raster image. */
  image(px: Uint8Array, wDots: number, hDots: number) {
    const bw = Math.ceil(wDots / 8);
    this.align(1);
    this.raw(GS, 0x76, 0x30, 0, bw & 0xff, bw >> 8, hDots & 0xff, hDots >> 8);
    for (let y = 0; y < hDots; y++)
      for (let xb = 0; xb < bw; xb++) {
        let b = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit;
          if (x < wDots && px[y * wDots + x]) b |= 0x80 >> bit;
        }
        this.bytes.push(b);
      }
    this.align(0);
  }
  feedAndCut(cut: boolean) {
    this.nl(4);
    if (cut) this.raw(GS, 0x56, 0x42, 0x00); // feed and partial cut
  }
}

function segsOf(el: Node, bold = false): Seg[] {
  const out: Seg[] = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) out.push({ text: n.textContent ?? '', bold });
    else if (n.nodeType === 1) {
      const e = n as HTMLElement;
      if (e.tagName === 'BR') out.push({ text: ' ', bold });
      else out.push(...segsOf(e, bold || e.tagName === 'B' || e.tagName === 'STRONG'));
    }
  });
  return out;
}

const textOf = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Loads a picture (the logo, a data URL) and turns it into black/white dots. */
async function rasterise(src: string, width: PaperWidth): Promise<{ px: Uint8Array; w: number; h: number } | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const maxW = Math.round(dotsFor(width) * 0.55);
    const maxH = 160;
    const k = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
    const w = Math.max(8, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const px = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const lum = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      px[i] = lum < 150 ? 1 : 0;
    }
    return { px, w, h };
  } catch {
    return null;
  }
}

function leftAligned(el: Element) {
  return /text-align:\s*left/.test(el.getAttribute('style') ?? '');
}

async function ticket(out: Out, root: Element) {
  const big = out.width === 58 ? 3 : 4;
  for (const el of Array.from(root.children)) {
    const cls = el.classList;
    const tag = el.tagName;
    const t = textOf(el);
    if (tag === 'HR') out.rule();
    else if (tag === 'IMG') {
      const src = el.getAttribute('src');
      const r = src ? await rasterise(src, out.width) : null;
      if (r) out.image(r.px, r.w, r.h);
    } else if (tag === 'TABLE') {
      for (const tr of Array.from(el.querySelectorAll('tr'))) {
        const tds = Array.from(tr.querySelectorAll('td'));
        if (!tds.length) continue;
        const bold = tr.classList.contains('tot');
        if (tds.length === 1) out.para(segsOf(tds[0]), { bold });
        else out.row(textOf(tds[0]), textOf(tds[tds.length - 1]), bold);
      }
    } else if (!t) continue;
    else if (cls.contains('num')) {
      const w = t.length * big > colsFor(out.width) ? 2 : big;
      out.para([{ text: t, bold: true }], { align: 1, w, h: big });
    } else if (cls.contains('type')) {
      const w = t.length * 2 > colsFor(out.width) ? 1 : 2;
      out.para([{ text: t, bold: true }], { align: 1, w, h: 2 });
    } else if (cls.contains('name')) out.para([{ text: t, bold: true }], { align: 1, h: 2 });
    else if (cls.contains('training') || cls.contains('addon') || cls.contains('paid')) {
      out.rule('=');
      out.para([{ text: t, bold: true }], { align: 1 });
      out.rule('=');
    } else if (cls.contains('label')) out.para([{ text: t.toUpperCase(), bold: false }], { align: 1 });
    else if (cls.contains('pack') || cls.contains('small') || cls.contains('meta'))
      out.para(segsOf(el), { align: leftAligned(el) ? 0 : 1 });
    else if (cls.contains('line')) out.para(segsOf(el), { h: 2 });
    else if (cls.contains('extra') || cls.contains('without')) out.para([{ text: t, bold: true }], { h: 2, indent: 2 });
    else if (cls.contains('note')) out.para(segsOf(el), { indent: leftAligned(el) || /margin-left:\s*0/.test(el.getAttribute('style') ?? '') ? 0 : 2 });
    else if (cls.contains('dl-to') || cls.contains('dl-phone')) out.para([{ text: t, bold: true }], { h: 2 });
    else out.para(segsOf(el));
  }
}

/** Ticket HTML parts → one ESC/POS byte stream, each ticket cut (or torn) separately. */
export async function ticketsToEscPos(htmlParts: string[], width: PaperWidth, cut: boolean): Promise<Uint8Array> {
  const out = new Out(width);
  const doc = new DOMParser().parseFromString(`<body>${htmlParts.join('')}</body>`, 'text/html');
  const tickets = Array.from(doc.querySelectorAll('.ticket'));
  for (const tk of tickets) {
    await ticket(out, tk);
    out.feedAndCut(cut);
  }
  return new Uint8Array(out.bytes);
}

/** A short test page so the cashier can see the link works and the paper width is right. */
export function testPageHTML(name: string, width: PaperWidth): string {
  return `<div class="ticket"><div class="name">${name.replace(/[<>&]/g, '')}</div><div class="label">PRINTER TEST</div><div class="num">123</div><hr/>
  <table><tr><td>1 × Sadza &amp; Beef</td><td class="r">$5.00</td></tr><tr class="tot"><td>Total</td><td class="r">$5.00</td></tr></table><hr/>
  <div class="small">Paper ${width} mm. Each dashed line above should fit on one row.</div>
  <div class="small">${new Date().toLocaleString()}</div></div>`;
}
