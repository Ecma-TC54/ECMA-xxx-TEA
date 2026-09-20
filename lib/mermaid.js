// Pre-renders Mermaid diagrams to inline SVG at build time.
//
// ecmarkup cannot render Mermaid, and PrinceXML (used for the PDF) does not
// run the DOM APIs that client-side Mermaid needs, so the diagrams are turned
// into static SVG while spec.html is generated. Sequence diagrams render to
// plain <text> elements; `htmlLabels: false` keeps any future flowchart from
// emitting <foreignObject>, which PrinceXML cannot draw.

import puppeteer from "puppeteer";
import { renderMermaid } from "@mermaid-js/mermaid-cli";

const MERMAID_CONFIG = {
  theme: "neutral",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
  // Keep the SVG free of random ids so spec.html stays diff-able across builds.
  deterministicIds: true,
};

let browserPromise = null;

function launchBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      // CI sets PUPPETEER_EXECUTABLE_PATH to the runner's Chrome so that
      // `npm ci` can keep PUPPETEER_SKIP_DOWNLOAD=true. Locally the variable
      // is optional: puppeteer falls back to its own downloaded browser.
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browserPromise;
}

/**
 * Render one Mermaid definition to an SVG string.
 *
 * @param {string} definition - Mermaid source, front matter included.
 * @param {string} svgId - Stable id for the <svg> element.
 * @returns {Promise<{ svg: string, title: string | null }>}
 */
export async function renderMermaidToSvg(definition, svgId) {
  const browser = await launchBrowser();
  const { data, title } = await renderMermaid(browser, definition, "svg", {
    mermaidConfig: MERMAID_CONFIG,
    backgroundColor: "transparent",
    svgId,
  });
  return { svg: expandSelfClosingTags(Buffer.from(data).toString("utf-8")), title };
}

// ecmarkup's HTML lint reports `<line ... />` as an element missing its closing
// tag. Self-closing and explicitly closed forms are equivalent in inline SVG,
// so emit the explicit form.
function expandSelfClosingTags(svg) {
  return svg.replace(/<([a-zA-Z][\w:-]*)((?:\s[^<>]*?)?)\s*\/>/g, "<$1$2></$1>");
}

/** Close the shared browser. Call once when the build is done. */
export async function closeMermaidRenderer() {
  if (browserPromise) {
    const browser = await browserPromise;
    browserPromise = null;
    await browser.close();
  }
}
