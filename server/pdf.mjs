export const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_PDF_BYTES = 4 * 1024 * 1024;

export function parsePdfInput(body) {
  if (typeof body === "string") {
    if (Buffer.byteLength(body) > MAX_HTML_BYTES)
      throw new Error("Invalid document");
    body = JSON.parse(body);
  }
  if (
    !body ||
    typeof body.html !== "string" ||
    !body.html.trim() ||
    Buffer.byteLength(body.html) > MAX_HTML_BYTES
  )
    throw new Error("Invalid document");
  return body.html;
}

export async function authorizePdf(
  authorization,
  env = process.env,
  fetcher = fetch,
) {
  if (typeof authorization !== "string" || !/^Bearer \S+$/.test(authorization))
    return false;
  const url = env.SUPABASE_URL || env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_ANON_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("PDF authentication is not configured");
  const headers = {
    Authorization: authorization,
    apikey: key,
    "Content-Type": "application/json",
  };
  const user = await fetcher(`${url}/auth/v1/user`, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!user.ok || !(await user.json()).id) return false;
  // Authenticate the registered session too: possession of a login must not bypass the two-device cap.
  const access = await fetcher(
    `${url}/rest/v1/rpc/current_session_has_device_access`,
    {
      method: "POST",
      headers,
      body: "{}",
      signal: AbortSignal.timeout(8000),
    },
  );
  return access.ok && (await access.json()) === true;
}

/** Render only the supplied document. No page scripts, network requests or filesystem URLs. */
export async function renderPdf(html, launch) {
  const browser = await launch();
  const timeout = setTimeout(() => {
    void browser.close().catch(() => {});
  }, 30_000);
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(15_000);
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      // Data images/fonts are embedded by our builders. Nothing remote is needed.
      const allowed =
        /^data:(image\/(png|jpeg|gif|webp)|font\/|application\/(x-font|font))/i.test(
          request.url(),
        );
      void (allowed ? request.continue() : request.abort()).catch(() => {});
    });
    const policy =
      "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    await page.setContent(
      `<meta http-equiv="Content-Security-Policy" content="${policy}">${html}`,
      { waitUntil: "load" },
    );
    const bytes = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      timeout: 15_000,
    });
    if (bytes.byteLength > MAX_PDF_BYTES)
      throw new Error("Document is too large");
    return bytes;
  } finally {
    clearTimeout(timeout);
    await browser.close();
  }
}

export function createPdfHandler({ authorize = authorizePdf, render } = {}) {
  let busy = false;
  return async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!req.headers["content-type"]?.startsWith("application/json")) {
      return res.status(415).json({ error: "JSON required" });
    }
    let html;
    try {
      html = parsePdfInput(req.body);
    } catch {
      return res.status(400).json({ error: "Invalid document" });
    }
    try {
      if (!(await authorize(req.headers.authorization)))
        return res
          .status(403)
          .json({ error: "Sign in on an authorized device" });
      // Bound Chromium memory per warm instance. The caller can retry, without a silent duplicate job.
      if (busy) {
        res.setHeader("Retry-After", "5");
        return res.status(429).json({ error: "Please retry shortly" });
      }
      busy = true;
      try {
        const pdf = await render(html);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          'attachment; filename="Nautical_Ops.pdf"',
        );
        return res.status(200).send(Buffer.from(pdf));
      } finally {
        busy = false;
      }
    } catch {
      // Never log crew details, document content or bearer tokens.
      return res
        .status(503)
        .json({ error: "PDF export unavailable. Please try again." });
    }
  };
}
