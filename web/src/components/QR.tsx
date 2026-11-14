import { useMemo } from 'react';
import qrcode from '../vendor/qrcode';
import { PUBLIC_SITE } from '../cloudConfig';

/** A QR code as a sharp SVG (prints well at any size). */
export default function QR({ text, size = 200, label }: { text: string; size?: number; label?: string }) {
  const { n, path } = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n, path: d };
  }, [text]);
  return (
    <svg className="qr" width={size} height={size} viewBox={`0 0 ${n + 8} ${n + 8}`} role="img" aria-label={label ?? `QR code for ${text}`} shapeRendering="crispEdges">
      <rect width={n + 8} height={n + 8} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** The address customers open: pos.techplug.co.zw/<web address> (?t=<table> for a table poster).
 *  On a test machine (localhost) it stays on this address so it can be tried without the internet. */
export function publicUrl(slug: string, table?: string): string {
  const t = table ? `?t=${encodeURIComponent(table)}` : '';
  if (/^(localhost|127\.|\[::1\])/.test(location.hostname)) return `${location.origin}${location.pathname}#/r/${slug}${t}`;
  return `${PUBLIC_SITE}/${slug}${t}`;
}
