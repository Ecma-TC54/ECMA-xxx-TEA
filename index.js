#!/usr/bin/env node

/**
 * This script generates the TEA API clause from the Open API yaml file on GitHub (or, alternatively, from a local clone
 * of the GitHub Repo) as well as the well-known schema annex. Those files are ignored by Git.
 * */
import * as fs from "node:fs/promises";
import path from "node:path";
import beautify from "js-beautify";
import { closeMermaidRenderer } from "./lib/mermaid.js";
import { openApiToEmu } from "./lib/openapi-to-emu.js";
import { jsonSchemaToEmuAnnex } from "./lib/json-schema-to-emu.js";

const OUTDIR = 'clauses';

// TODO: create an npm run-script to generate content from a specific hash or tag to provide for reproducible builds.

/**
 * Suggested approach for reproducible builds: pin versions between Ecma and CycloneDX repos, using the `npm version`
 * command. Use an environment variable indicating that a build should be generated from the current version. Use
 * the url https://github.com/CycloneDX/transparency-exchange-api/tree/${CURRENT_TAG}
 * */

const TEA_REPO = "transparency-exchange-api";
const TEA_SOURCE_REF = "main";
const CYCLONEDX_TEA_GITHUB = `https://raw.githubusercontent.com/CycloneDX/${TEA_REPO}/${TEA_SOURCE_REF}`;

const fetchFilePaths = {
  "Open API": {
    local: path.join('..', TEA_REPO, "spec", "openapi.yaml"),
    remote: `${CYCLONEDX_TEA_GITHUB}/spec/openapi.yaml`,
    destination: path.join(OUTDIR, "spec", "openapi.yaml")
  },
  "JSON Schema": {
    local: path.join('..', TEA_REPO, "discovery", "tea-well-known.schema.json"),
    remote: `${CYCLONEDX_TEA_GITHUB}/discovery/tea-well-known.schema.json`,
    destination: path.join(OUTDIR, "spec", "tea-well-known.schema.json")
  }
};

const NORMATIVE_OPTIONAL_TAGS = ["TEA Authentication"];

/**
 * Prince sizes a table column to at least its longest unbreakable run of text, whatever `overflow-wrap` says, so a long
 * opaque token in a cell (a digest, a Base64URL identifier, an encoded query string) pushes the table past the printed
 * page. Offer break points inside such runs in table code: after "?", "&", "=" and ".", then every 16 characters where
 * that is not enough. <wbr> renders as nothing and is not copied with the text.
 * */
const LONG_RUN = /(?:&[#a-z0-9]+;|[^\s/&<-]){32,}/gi;
const RUN_CHUNK = /(?:&[#a-z0-9]+;|.){1,16}/gi;

function breakLongTableCode(html) {
  const breakRun = run => run
    .replace(/(&amp;|[?=.])(?!$)/g, "$1<wbr>")
    .split("<wbr>")
    .map(piece => piece.length > 24 ? piece.match(RUN_CHUNK).join("<wbr>") : piece)
    .join("<wbr>");
  return html.replace(/<emu-table\b[\s\S]*?<\/emu-table>/g, table =>
    table.replace(/(<code>)([^<]*)(<\/code>)/g, (m, open, text, close) =>
      open + text.replace(LONG_RUN, breakRun) + close));
}

/**
 * Fetches source from GitHub repo owned by CycloneDX org
 * @param {"Open API"|"JSON Schema"} clause
 * @returns {string}
 * */
async function fetchCycloneDXSource(clause) {
  console.log(`Removing previously fetched ${clause} file, if any . . .`)

  if (process.env.TEA_ENV === 'localdev') {
    return fs.rm(fetchFilePaths[clause].destination, {force: true})
      // .then(() => fs.readFile(fetchFilePaths[clause].local, {encoding: 'utf-8'}));
      .then(() => fs.link(fetchFilePaths[clause].local, fetchFilePaths[clause].destination))
      .then(() => fs.readFile(fetchFilePaths[clause].destination, {encoding: 'utf-8'}));
  }

  return fs.rm(fetchFilePaths[clause].destination, {force: true})
    .then(() => fetch(fetchFilePaths[clause].remote).then((res) => {
      if (!res.ok) {
        throw new Error(`Failed to fetch ${fetchFilePaths[clause].remote}: ${res.status} ${res.statusText}`);
      }

      return res.text();
    }))
    .then((text) => fs.writeFile(fetchFilePaths[clause].destination, text)
      .then(() => text)
    )
}

async function build() {
  if (process.env.TEA_ENV === 'localdev') {
    const res = await fetch('https://raw.githubusercontent.com');
    if (!res.ok) {
      throw new Error('GitHub is down, failing before any locally saved data is deleted.');
    }
  }

  return fs.mkdir(path.join(OUTDIR, "spec"), {recursive: true})
    .then(() => {
      console.log('Fetching and reading OpenAPI . . .');

      return fetchCycloneDXSource("Open API");
    })
    .then((apiYaml) => {
      console.log('Converting OpenAPI yaml to ecmarkup . . .');

      return openApiToEmu(apiYaml, {normativeOptionalTags: NORMATIVE_OPTIONAL_TAGS});
    })
    .then((markup) => {
      console.log('Breaking up long OpenAPI tables . . .');

      return breakLongTableCode(markup);
    })
    .then((markup) => {
      console.log('Beautifying OpenAPI markup . . .');

      return safelyBeautifyMarkup(markup);
    })
    .then((apiMarkup) => {
      console.log('Writing OpenAPI clause . . .');

      return fs.writeFile(path.join(OUTDIR, 'API.emu'), apiMarkup)
        .then(() => console.log(`Wrote OpenAPI clause, ${apiMarkup.length} bytes.`));
    })
    .then(() => {
      console.log('Fetching and reading well-known JSON schema . . .');

      return fetchCycloneDXSource("JSON Schema");
    })
    .then((wellknownJson) => {
      console.log('Converting well-known JSON schema to ecmarkup . . .');

      return jsonSchemaToEmuAnnex(JSON.parse(wellknownJson))
    })
    .then((markup) => {
      console.log('Beautifying JSON schema markup . . .');

      return safelyBeautifyMarkup(markup)
    })
    .then((schemaMarkup) => {
      console.log('Writing JSON schema annex . . .');

      return fs.writeFile(path.join(OUTDIR, 'tea-well-known-schema.emu'), schemaMarkup)
        .then(() => console.log(`Wrote JSON schema annex, ${schemaMarkup.length} bytes.`));
    })
}

/**
 * js-beautify will mangle <pre>/<code>/<script>. Stash them before pretty-printing and restore afterwards.
 */
function safelyBeautifyMarkup(markup) {
  const TAGS_TO_SKIP = ["pre", "code", "script", "svg"];
  const placeholders = {};
  let counter = 0;
  let working = markup;
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

  return pretty;
}

build().catch(err => {
  console.error(err);
  return closeMermaidRenderer()
    .catch(() => {})
    .then(() => process.exit(1));
});
