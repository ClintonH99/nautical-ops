// Shared by the static website and Expo's generated app shell.
export const WEB_ICON_FILES = [
  'favicon-vessel.png',
  'apple-touch-icon.png',
  'nautical-ops-icon-192.png',
  'nautical-ops-icon-512.png',
  'site.webmanifest',
];

export function withWebIcons(html) {
  if (!/<\/head>/i.test(html)) throw new Error('Missing HTML head for web icons');
  // Replace Expo's generated favicon declaration and make repeat builds idempotent.
  const clean = html.replace(
    /<link\b[^>]*\brel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon|manifest)["'][^>]*>\s*/gi,
    ''
  );
  return clean.replace(
    /<\/head>/i,
    '<link rel="icon" type="image/png" sizes="96x96" href="/favicon-vessel.png"/>\n' +
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>\n' +
      '<link rel="manifest" href="/site.webmanifest"/>\n</head>'
  );
}
