import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true, linkify: true });

export const WELL_KNOWN_SOURCE_PATH = "discovery/tea-well-known.schema.json";
export const WELL_KNOWN_ANNEX_ID = "sec-tea-well-known-schema";
const DEF_ID_PREFIX = "tea-well-known-";

function esc(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function renderDescription(text) {
  if (!text) return "";
  return md.render(String(text));
}

function renderCell(text, extra = "") {
  const s = text === undefined || text === null ? "" : String(text).trim();
  const block = /\n\s*\n/.test(s) || /^\s*([-*]|\d+\.)\s/m.test(s);
  let out = block ? md.render(s) : md.renderInline(s.replace(/\s*\n\s*/g, " "));
  if (extra) out += block ? `<p>${extra}</p>` : out ? `<br>${extra}` : extra;
  return out;
}

function definitionId(name) {
  return `sec-${DEF_ID_PREFIX}${slug(name)}`;
}

function typeForSchema(schema) {
  if (!schema) return "—";
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    return `<emu-xref href="#${escAttr(definitionId(name))}"><code>${esc(name)}</code></emu-xref>`;
  }
  if (schema.type === "array") {
    return `Array of ${typeForSchema(schema.items)}`;
  }
  if (schema.enum) return `${esc(schema.type || "string")} (enum)`;
  if (schema.const !== undefined) return esc(schema.type || typeof schema.const);
  return esc(schema.type || (schema.oneOf ? "oneOf" : schema.anyOf ? "anyOf" : "object"));
}

function constraintsForSchema(schema) {
  if (!schema || schema.$ref) return "";
  const parts = [];
  if (schema.const !== undefined) parts.push(`Constant: <code>${esc(JSON.stringify(schema.const))}</code>.`);
  if (schema.enum) parts.push(`One of: ${schema.enum.map(v => `<code>${esc(v)}</code>`).join(", ")}.`);
  if (schema.default !== undefined) parts.push(`Default: <code>${esc(JSON.stringify(schema.default))}</code>.`);
  if (schema.minimum !== undefined) parts.push(`Minimum: <code>${esc(schema.minimum)}</code>.`);
  if (schema.maximum !== undefined) parts.push(`Maximum: <code>${esc(schema.maximum)}</code>.`);
  if (schema.minLength !== undefined) parts.push(`Minimum length: <code>${esc(schema.minLength)}</code>.`);
  if (schema.maxLength !== undefined) parts.push(`Maximum length: <code>${esc(schema.maxLength)}</code>.`);
  if (schema.minItems !== undefined) parts.push(`Minimum items: <code>${esc(schema.minItems)}</code>.`);
  if (schema.format) parts.push(`Format: <code>${esc(schema.format)}</code>.`);
  if (schema.pattern) parts.push(`Pattern: <code>${esc(schema.pattern)}</code>.`);
  if (schema.items && !schema.items.$ref) {
    const item = schema.items;
    const itemBits = [];
    if (item.description) {
      itemBits.push(md.renderInline(String(item.description).trim().replace(/\s*\n\s*/g, " ")));
    }
    const inner = constraintsForSchema(item);
    if (inner) itemBits.push(inner);
    const examples = item.examples || (item.example !== undefined ? [item.example] : []);
    if (examples.length) {
      itemBits.push(`Examples: ${examples.map(ex => `<code>${esc(typeof ex === "string" ? ex : JSON.stringify(ex))}</code>`).join(", ")}.`);
    }
    if (itemBits.length) parts.push(`Each item: ${itemBits.join(" ")}`);
  }
  return parts.join(" ");
}

function renderPropertiesTable(properties, required) {
  if (!properties || !Object.keys(properties).length) return "";
  let out = "<emu-table><emu-caption>Properties</emu-caption><table>";
  out += "<thead><tr><th>Property</th><th>Type</th><th>Requirement</th><th>Description</th></tr></thead><tbody>";
  for (const [name, prop] of Object.entries(properties)) {
    out += `<tr><td><code>${esc(name)}</code></td>`;
    out += `<td>${typeForSchema(prop)}</td>`;
    out += `<td>${required.has(name) ? "Required" : "Optional"}</td>`;
    out += `<td>${renderCell(prop.description, constraintsForSchema(prop))}</td></tr>`;
  }
  out += "</tbody></table></emu-table>\n";
  return out;
}

function renderObjectBody(schema) {
  let out = "";
  if (schema.description) out += renderDescription(schema.description);
  if (schema.type) out += `<p><strong>Type:</strong> ${esc(schema.type)}</p>\n`;
  if (schema.additionalProperties === false) {
    out += "<p>Additional properties are not permitted.</p>\n";
  }
  const required = new Set(schema.required || []);
  out += renderPropertiesTable(schema.properties, required);
  if (schema.examples || schema.example) {
    const examples = schema.examples || [schema.example];
    for (const ex of examples) {
      out += "<emu-example><pre>" + esc(typeof ex === "string" ? ex : JSON.stringify(ex, null, 2)) + "</pre></emu-example>\n";
    }
  }
  return out;
}

/**
 * Convert a JSON Schema document into a normative annex. Nested
 * `definitions` are child annexes (ecmarkup does not allow clauses inside
 * annexes). `$ref`s of the form `#/definitions/<name>` become xrefs to those
 * child annexes.
 *
 * The source JSON is emitted verbatim as the schema (so the annex cannot
 * drift from the imported file). The tables that follow summarise it.
 */
export function jsonSchemaToEmuAnnex(schema, {
  id = WELL_KNOWN_ANNEX_ID,
  heading = "TEA well-known discovery schema",
  sourceJson,
} = {}) {
  const json = (sourceJson !== undefined ? String(sourceJson) : JSON.stringify(schema, null, 2)).trimEnd();
  let out = `<emu-annex id="${escAttr(id)}" normative>\n<h1>${esc(heading)}</h1>\n`;
  out += `<p>This annex specifies the schema for the TEA <code>/.well-known/tea</code> discovery document. The schema is expressed in JSON Schema draft-07 (<emu-xref href="#json-schema-core"></emu-xref>, <emu-xref href="#json-schema-validation"></emu-xref>).</p>\n`;
  out += "<p>The following JSON document is the schema. The tables that follow summarise it.</p>\n";
  out += `<pre><code class="json">${esc(json)}</code></pre>\n`;
  out += renderObjectBody(schema);

  const definitions = schema.definitions || schema.$defs || {};
  for (const [name, def] of Object.entries(definitions)) {
    out += `<emu-annex id="${escAttr(definitionId(name))}" normative>\n`;
    out += `<h1>${esc(name)}</h1>\n`;
    out += renderObjectBody(def);
    out += "</emu-annex>\n";
  }

  out += "</emu-annex>\n";
  return out;
}

/**
 * Rewrite Markdown links to the well-known schema file into an xref to the
 * generated annex, so the GitHub-relative link becomes a working reference
 * in the published specification.
 */
export function linkWellKnownSchema(html, annexId = WELL_KNOWN_ANNEX_ID) {
  const file = `(?:(?:\\./|(?:\\.{0,2}/)*discovery/)?)tea-well-known\\.schema\\.json`;
  html = html.replace(
    new RegExp(`<a href="${file}"[^>]*>([\\s\\S]*?)</a>`, "g"),
    `<emu-xref href="#${annexId}">$1</emu-xref>`,
  );
  for (const m of html.matchAll(/href="([^"]*tea-well-known\.schema\.json)"/g)) {
    console.warn(`unresolved reference to well-known schema: ${m[1]}`);
  }
  return html;
}
