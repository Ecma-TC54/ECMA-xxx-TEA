/**
 * Shared functions for generated content
 * */

import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true, linkify: true });

export function esc(s) {
  if (s === undefined || s === null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escAttr(s) {
  return esc(s).replace(/"/g, "&quot;");
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function renderDescription(text) {
  if (!text) return "";
  return md.render(String(text));
}

/**
 * Renders a description for use inside a table cell. Single-paragraph text is
 * rendered inline (no wrapping <p>) so table rows stay compact; multi-paragraph
 * or list-bearing text is rendered as blocks. `extra` is an optional trailing
 * fragment (e.g. constraints) appended after the description.
 */
export function renderCell(text, extra = "") {
  const s = text === undefined || text === null ? "" : String(text).trim();
  const block = /\n\s*\n/.test(s) || /^\s*([-*]|\d+\.)\s/m.test(s);
  let out = block ? md.render(s) : md.renderInline(s.replace(/\s*\n\s*/g, " "));
  if (extra) out += block ? `<p>${extra}</p>` : out ? `<br>${extra}` : extra;
  return out;
}

export function constraintsForSchema(schema) {
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

export function renderPropertiesTable(properties, required, typeForSchema) {
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

