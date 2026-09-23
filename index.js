#!/usr/bin/env node
// Assembles spec.html by fetching the TEA source repository (Markdown + OpenAPI)
// and stitching it together with the hand-authored excerpts/ files.
//
// Mirrors the ECMA-424 build model: the spec.html file is committed to the
// repository as a generated artefact; running `npm run generate-spec`
// regenerates it from upstream sources.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import beautify from "js-beautify";
import MarkdownIt from "markdown-it";
import { markdownToEmuClauses } from "./lib/md-to-emu.js";
import { closeMermaidRenderer } from "./lib/mermaid.js";
import { openApiToEmu } from "./lib/openapi-to-emu.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

// TODO: pin TEA_SOURCE_REF to a tag or commit SHA before the first ECMA
// publication build. Tracking `main` is acceptable for working-group review
// drafts but is not reproducible: re-running the build at a later date may
// produce different output. See discussion at
// https://github.com/Ecma-TC54/ECMA-xxx-TEA/pull/<TBD>.
const TEA_SOURCE_REPO = "CycloneDX/transparency-exchange-api";
const TEA_SOURCE_REF = "main";
const RAW_BASE = `https://raw.githubusercontent.com/${TEA_SOURCE_REPO}/${TEA_SOURCE_REF}`;

// Cache fetched TEA sources here so subsequent builds don't re-download.
const CACHE_DIR = path.join(HERE, "tea-source");
const OUT_FILE = path.join(HERE, "spec.html");

// Paths inside the TEA source repository, relative to its root.
const TEA_OPENAPI = "spec/openapi.yaml";
const TEA_README = "README.md";

// Informative narrative chapters, in the order they should appear in the spec.
// Each entry is [pathInTeaRepo, idPrefix]. The idPrefix namespaces clause IDs
// so unrelated chapters can use the same heading text without collision.
const NARRATIVE_DOCS = [
  ["doc/tea-requirements.md", "req"],
  ["api-flow/consumer.md", "flow-consumer"],
  ["tea-product/tea-product.md", "tea-product"],
  ["tea-product/tea-product-release.md", "tea-product-release"],
  ["tea-component/tea-component.md", "tea-component"],
  ["tea-component/tea-release.md", "tea-release"],
  ["tea-collection/tea-collection.md", "tea-collection"],
  ["tea-artifact/tea-artifact.md", "tea-artifact"],
];

// Normative chapters, each a top-level clause following the narrative, in
// this order. Each entry is [pathInTeaRepo, idPrefix, rootId]. rootId is the
// fixed ID of the chapter's top clause, which the scope and conformance
// excerpts reference.
const NORMATIVE_DOCS = [
  ["discovery/readme.md", "discovery", "sec-discovery"],
  ["auth/readme.md", "auth", "sec-authentication"],
];

async function fetchTeaFile(relPath) {
  const cached = path.join(CACHE_DIR, relPath);
  if (fs.existsSync(cached)) return fs.readFileSync(cached, "utf-8");
  const url = `${RAW_BASE}/${relPath}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  fs.writeFileSync(cached, text);
  return text;
}

function readExcerpt(name) {
  return fs.readFileSync(path.join(HERE, "excerpts", name), "utf-8");
}

async function importMarkdown(rel, idPrefix, options) {
  let body;
  try {
    body = await fetchTeaFile(rel);
  } catch (err) {
    console.warn(`skipping ${rel}: ${err.message}`);
    return "";
  }
  return `<!-- imported from ${TEA_SOURCE_REPO}@${TEA_SOURCE_REF}:${rel} -->\n`
    + await markdownToEmuClauses(body, idPrefix, options);
}

async function build() {
  // Refresh the source cache each run so we pick up upstream changes.
  if (fs.existsSync(CACHE_DIR)) fs.rmSync(CACHE_DIR, { recursive: true, force: true });

  let html = "";

  html += readExcerpt("0x00-header.html") + "\n";

  const readme = await fetchTeaFile(TEA_README);
  const introMatch = /## Introduction\n([\s\S]*?)(?=\n## )/.exec(readme);
  const introMd = introMatch ? introMatch[1].trim() : "";
  html += `<emu-intro id="sec-intro">\n<h1>Introduction</h1>\n`;
  if (introMd) {
    const mdi = new MarkdownIt({ html: true, linkify: true });
    html += mdi.render(introMd) + "\n";
  } else {
    html += "<p>The Transparency Exchange API (TEA) standardises the exchange of supply-chain transparency artefacts.</p>\n";
  }
  html += "</emu-intro>\n";

  // Front matter (skeletons authored as excerpts).
  html += readExcerpt("0x20-scope.html") + "\n";
  html += readExcerpt("0x21-conformance.html") + "\n";
  html += readExcerpt("0x22-normative-references.html") + "\n";
  html += readExcerpt("0x23-terms-and-definitions.html") + "\n";

  // Informative narrative leads the body of the spec.
  html += `<emu-clause id="sec-tea-narrative">\n<h1>Specification narrative</h1>\n`;
  html += "<p>This clause is informative. The following sections are derived from the working group's authoring notes maintained as Markdown in the source repository.</p>\n";
  for (const [rel, idPrefix] of NARRATIVE_DOCS) {
    html += await importMarkdown(rel, idPrefix);
  }
  html += "</emu-clause>\n";

  // Normative chapters, each a top-level clause.
  for (const [rel, idPrefix, rootId] of NORMATIVE_DOCS) {
    html += await importMarkdown(rel, idPrefix, { rootId });
  }
  await closeMermaidRenderer();

  // Generated API surface + data model follow the normative chapters.
  const openapiYaml = await fetchTeaFile(TEA_OPENAPI);
  html += await openApiToEmu(openapiYaml);

  // Back matter.
  html += readExcerpt("1x10-bibliography.html") + "\n";
  html += readExcerpt("1x20-colophon.html") + "\n";

  // js-beautify will mangle <pre>/<code>/<script>. Stash them before pretty-
  // printing and restore afterwards.
  const TAGS_TO_SKIP = ["pre", "code", "script", "svg"];
  const placeholders = {};
  let counter = 0;
  let working = html;
  for (const tag of TAGS_TO_SKIP) {
    const re = new RegExp(`<${tag}[^>]*?>[\\s\\S]*?<\\/${tag}>`, "gi");
    working = working.replace(re, m => {
      const k = `__PH_${tag.toUpperCase()}_${counter++}__`;
      placeholders[k] = m;
      return k;
    });
  }
  let pretty = beautify.html(working, {
    indent_size: 2,
    preserve_newlines: false,
    max_preserve_newlines: 1,
    wrap_line_length: 0,
    end_with_newline: true,
  });
  for (const [k, v] of Object.entries(placeholders)) pretty = pretty.replace(k, v);

  fs.writeFileSync(OUT_FILE, pretty);
  console.log(`wrote ${OUT_FILE} (${pretty.length} bytes)`);
}

build().catch(async err => {
  console.error(err);
  await closeMermaidRenderer().catch(() => {});
  process.exit(1);
});
