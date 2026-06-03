import fs from "node:fs";
import MarkdownIt from "markdown-it";

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

function slugify(text, prefix) {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `sec-${prefix}${slug ? "-" + slug : ""}`;
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
 */
export function markdownToEmuClauses(source, idPrefix) {
  const stripped = stripLeadingToc(source);
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

  let html = "";
  if (preamble.join("\n").trim()) {
    html += md.render(preamble.join("\n")) + "\n";
  }

  const stack = [];
  let counter = 0;

  const closeTo = (targetLevel) => {
    while (stack.length && stack[stack.length - 1] >= targetLevel) {
      html += "</emu-clause>\n";
      stack.pop();
    }
  };

  for (const s of sections) {
    closeTo(s.level);
    counter++;
    const id = slugify(s.title, `${idPrefix}-${counter}`);
    html += `<emu-clause id="${escapeAttr(id)}">\n`;
    // Narrative headings are emitted verbatim, so titles with parentheses
    // (e.g. "TEA Collection object (TCO)") reach ecmarkup as clause headers.
    // ecmarkup's `header-format` lint rule reads "( ... )" as an algorithm
    // parameter list and flags it. This is why the default `build-head` runs
    // `--lint-spec` without `--strict` (see package.json). The strict build is
    // kept as `build-head-strict`; closing these warnings needs either
    // author-side heading edits upstream or a slug/rewrite pass here.
    html += `<h1>${md.renderInline(s.title)}</h1>\n`;
    const body = s.body.join("\n").trim();
    if (body) html += md.render(body) + "\n";
    stack.push(s.level);
  }
  closeTo(0);
  return html;
}

export function markdownFileToEmuClauses(filePath, idPrefix) {
  const src = fs.readFileSync(filePath, "utf-8");
  return markdownToEmuClauses(src, idPrefix);
}
