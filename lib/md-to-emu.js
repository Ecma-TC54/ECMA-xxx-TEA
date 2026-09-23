import fs from "node:fs";
import MarkdownIt from "markdown-it";
import { renderMermaidToSvg } from "./mermaid.js";

// ecmarkup syntax-highlights fenced blocks via highlight.js. Languages that
// highlight.js does not recognize (e.g. `mermaid`, `abnf`, `bnf`, `webidl`,
// `http`, `cmd`, `console`, `text`) crash the build. Strip the language hint
// for anything we know highlight.js can't handle; render as a plain pre.
const KNOWN_HLJS_LANGS = new Set([
  "bash", "cjs", "css", "html", "javascript", "js", "json", "markdown",
  "mjs", "python", "sh", "shell", "ts", "typescript", "xml", "yaml",
]);

const md = new MarkdownIt({ html: true, linkify: true });

const defaultFence = md.renderer.rules.fence || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options, env));
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  const info = (token.info || "").trim().split(/\s+/)[0].toLowerCase();
  if (info && !KNOWN_HLJS_LANGS.has(info)) {
    token.info = "";
  }
  return defaultFence(tokens, idx, options, env, self);
};

// ecmarkup numbers and styles tables only inside <emu-table>: borders, padding,
// header shading, and cell wrapping and page-break rules in print. A bare
// <table> from Markdown gets none of that, so wrap each one.
//
// A paragraph "Table: <title>" directly before a table is its caption (the
// Pandoc convention), so it renders as "Table N: <title>" rather than a bare
// "Table N". The paragraph itself is dropped.
md.core.ruler.push("table_caption", (state) => {
  const tokens = state.tokens;
  for (let i = 3; i < tokens.length; i++) {
    if (tokens[i].type !== "table_open") continue;
    const [open, inline, close] = tokens.slice(i - 3, i);
    if (open.type !== "paragraph_open" || close.type !== "paragraph_close") continue;
    const m = /^Table:\s+([\s\S]+)$/.exec(inline.content);
    if (!m) continue;
    tokens[i].meta = { ...tokens[i].meta, caption: m[1].trim() };
    tokens.splice(i - 3, 3);
    i -= 3;
  }
});
md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
  const caption = tokens[idx].meta?.caption;
  return "<emu-table>\n"
    + (caption ? `<emu-caption>${md.renderInline(caption)}</emu-caption>\n` : "")
    + self.renderToken(tokens, idx, options);
};
md.renderer.rules.table_close = (tokens, idx, options, env, self) =>
  self.renderToken(tokens, idx, options) + "</emu-table>\n";

const MERMAID_FENCE = /^```mermaid[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;

/**
 * Replace every ```mermaid fence with a placeholder paragraph and render the
 * diagram to an <emu-figure> holding inline SVG. The figures are substituted
 * back after markdown-it has run, so the SVG never passes through the Markdown
 * parser (which would end an HTML block at the first blank line).
 *
 * @returns {Promise<{ source: string, figures: Map<string, string> }>}
 */
async function extractMermaidFences(source, idPrefix) {
  const figures = new Map();
  const matches = [...source.matchAll(MERMAID_FENCE)];
  if (matches.length === 0) return { source, figures };
  let out = "";
  let last = 0;
  let n = 0;
  for (const m of matches) {
    n++;
    const definition = m[1].trim();
    const svgId = `fig-${idPrefix}-${n}`;
    const { svg, title } = await renderMermaidToSvg(definition, svgId);
    let figure = `<emu-figure id="${escapeAttr(svgId)}">\n`;
    if (title) figure += `<emu-caption>${md.renderInline(title)}</emu-caption>\n`;
    figure += svg.trim() + "\n</emu-figure>\n";
    // Keep the definition next to the figure so spec.html shows what was rendered.
    figure += "<!-- mermaid source:\n" + definition.replace(/--/g, "- -") + "\n-->\n";
    const token = `MERMAIDFIGURE${n}PLACEHOLDER`;
    figures.set(token, figure);
    out += source.slice(last, m.index) + "\n" + token + "\n";
    last = m.index + m[0].length;
  }
  return { source: out + source.slice(last), figures };
}

function substituteFigures(html, figures) {
  for (const [token, figure] of figures) {
    html = html.replace(new RegExp(`<p>${token}</p>\\n?`), figure);
  }
  return html;
}

function slugify(text, prefix) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `sec-${prefix}${slug ? "-" + slug : ""}`;
}

// The anchor GitHub gives a heading: its rendered text lower-cased, with
// punctuation other than "-" and "_" dropped and each space turned into "-".
// Repeats within a document get "-1", "-2", ... suffixes (see caller).
function githubAnchor(inlineHtml) {
  return inlineHtml
    .replace(/<[^>]+>/g, "")
    .replace(/&[#a-z0-9]+;/gi, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function isLikelyTocLine(line) {
  // Matches: "- [Some Heading](#some-heading)" optionally with leading indent.
  return /^\s*[-*]\s+\[[^\]]+\]\(#[^)]+\)\s*$/.test(line);
}

function stripLeadingToc(source) {
  const lines = source.split("\n");
  const out = [];
  // Skip until first non-TOC, non-blank line. We only strip the leading block
  // that appears immediately after the H1 (a TOC), to keep authoring intent.
  let firstHeading = -1;
  for (let j = 0; j < lines.length; j++) {
    if (/^#\s+/.test(lines[j])) { firstHeading = j; break; }
  }
  if (firstHeading < 0) return source;
  for (let i = 0; i <= firstHeading; i++) out.push(lines[i]);
  let k = firstHeading + 1;
  while (k < lines.length && lines[k].trim() === "") k++;
  let stripped = false;
  while (k < lines.length && isLikelyTocLine(lines[k])) {
    k++;
    stripped = true;
  }
  if (stripped) {
    while (k < lines.length && lines[k].trim() === "") k++;
  } else {
    k = firstHeading + 1;
  }
  for (; k < lines.length; k++) out.push(lines[k]);
  return out.join("\n");
}

/**
 * Convert a markdown string into a nested <emu-clause> tree.
 *
 * Headings define clause nesting. Levels 1..6 map onto nested clauses.
 * Content between headings is rendered as HTML via markdown-it.
 *
 * `rootId`, when given, replaces the generated ID of the document's leading
 * level-1 heading, so the excerpts can cross-reference the chapter by an ID
 * that does not change when the heading is reworded upstream. The generated
 * ID is kept as an ecmarkup `oldids` alias, so existing deep links still
 * resolve. The other clauses keep their generated IDs.
 *
 * In-document links written against GitHub's heading anchors
 * (e.g. `[Requirements](#requirements)`) are pointed at the clause IDs.
 *
 * `element` is the clause element to emit. Content placed inside an
 * <emu-annex> passes "emu-annex", since ecmarkup does not allow clauses
 * inside annexes.
 */
export async function markdownToEmuClauses(source, idPrefix, { rootId, element = "emu-clause" } = {}) {
  const { source: stripped, figures } = await extractMermaidFences(stripLeadingToc(source), idPrefix);
  const lines = stripped.split("\n");

  const sections = [];
  const preamble = [];
  let current = null;
  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { level: m[1].length, title: m[2].trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    } else {
      preamble.push(line);
    }
  }
  if (current) sections.push(current);

  const anchorIds = new Map();
  const anchorCounts = new Map();
  const ids = sections.map((s, i) => {
    const generated = slugify(s.title, `${idPrefix}-${i + 1}`);
    const id = rootId && i === 0 && s.level === 1 ? rootId : generated;
    const anchor = githubAnchor(md.renderInline(s.title));
    const n = anchorCounts.get(anchor) || 0;
    anchorCounts.set(anchor, n + 1);
    anchorIds.set(n ? `${anchor}-${n}` : anchor, id);
    return { id, generated };
  });
  const render = (text) => md.render(text).replace(/href="#([^"]+)"/g, (match, anchor) => {
    let key = anchor;
    try { key = decodeURIComponent(anchor); } catch { /* keep as written */ }
    return anchorIds.has(key) ? `href="#${escapeAttr(anchorIds.get(key))}"` : match;
  });

  let html = "";
  if (preamble.join("\n").trim()) {
    html += render(preamble.join("\n")) + "\n";
  }

  const stack = [];
  let counter = 0;

  const closeTo = (targetLevel) => {
    while (stack.length && stack[stack.length - 1] >= targetLevel) {
      html += `</${element}>\n`;
      stack.pop();
    }
  };

  for (const s of sections) {
    closeTo(s.level);
    const { id, generated } = ids[counter++];
    const oldids = id !== generated ? ` oldids="${escapeAttr(generated)}"` : "";
    html += `<${element} id="${escapeAttr(id)}"${oldids}>\n`;
    // Narrative headings are emitted verbatim, so titles with parentheses
    // (e.g. "TEA Collection object (TCO)") reach ecmarkup as clause headers.
    // ecmarkup's `header-format` lint rule reads "( ... )" as an algorithm
    // parameter list and flags it. This is why the default `build-head` runs
    // `--lint-spec` without `--strict` (see package.json). The strict build is
    // kept as `build-head-strict`; closing these warnings needs either
    // author-side heading edits upstream or a slug/rewrite pass here.
    html += `<h1>${md.renderInline(s.title)}</h1>\n`;
    const body = s.body.join("\n").trim();
    if (body) html += render(body) + "\n";
    stack.push(s.level);
  }
  closeTo(0);
  return substituteFigures(html, figures);
}

export async function markdownFileToEmuClauses(filePath, idPrefix, options) {
  const src = fs.readFileSync(filePath, "utf-8");
  return await markdownToEmuClauses(src, idPrefix, options);
}
