import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { createPdfHandler, renderPdf } from "../server/pdf.mjs";

export default createPdfHandler({
  render: (html) =>
    renderPdf(html, async () =>
      puppeteer.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: "shell",
        timeout: 10_000,
      }),
    ),
});
