import yaml from "js-yaml";
import $RefParser from "@apidevtools/json-schema-ref-parser";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: true, linkify: true });

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"];

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

/**
 * Renders a description for use inside a table cell. Single-paragraph text is
 * rendered inline (no wrapping <p>) so table rows stay compact; multi-paragraph
 * or list-bearing text is rendered as blocks. `extra` is an optional trailing
 * fragment (e.g. constraints) appended after the description.
 */
function renderCell(text, extra = "") {
  const s = text === undefined || text === null ? "" : String(text).trim();
  const block = /\n\s*\n/.test(s) || /^\s*([-*]|\d+\.)\s/m.test(s);
  let out = block ? md.render(s) : md.renderInline(s.replace(/\s*\n\s*/g, " "));
  if (extra) out += block ? `<p>${extra}</p>` : out ? `<br>${extra}` : extra;
  return out;
}

/**
 * Loads an OpenAPI document with internal $refs resolved (bundled, not
 * dereferenced — we want to preserve named schema identity for the data-model
 * section).
 */
async function loadOpenApi(yamlText) {
  const raw = yaml.load(yamlText);
  // Bundle so $refs inside parameters/responses resolve to inline structures
  // we can render in place, while leaving named schemas under components.schemas
  // for the data-model section.
  return await $RefParser.bundle(raw);
}

/**
 * Bundling keeps `$ref`s to reusable components (parameters, responses,
 * headers, request bodies) as bare `{ $ref }` objects. Follow such a pointer
 * to the component it names so callers can read its fields. Schema `$ref`s are
 * deliberately not followed by the renderers below: they are turned into links
 * to the data-model clause instead.
 */
function deref(doc, obj) {
  let hops = 0;
  while (obj && typeof obj.$ref === "string" && obj.$ref.startsWith("#/") && hops++ < 16) {
    const target = obj.$ref
      .slice(2)
      .split("/")
      .map(seg => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
      .reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), doc);
    if (!target) {
      console.warn(`[openapi-to-emu] unresolved $ref ${obj.$ref}`);
      return obj;
    }
    obj = target;
  }
  return obj;
}

function typeForSchema(schema) {
  if (!schema) return "—";
  if (schema.$ref) {
    const name = schema.$ref.split("/").pop();
    return `<a href="#sec-tea-schema-${escAttr(slug(name))}"><code>${esc(name)}</code></a>`;
  }
  if (schema.type === "array") {
    const inner = typeForSchema(schema.items);
    return `Array of ${inner}`;
  }
  if (schema.enum) {
    return `${esc(schema.type || "string")} (enum)`;
  }
  if (schema.allOf) return "allOf";
  return esc(schema.type || (schema.oneOf ? "oneOf" : schema.anyOf ? "anyOf" : "object"));
}

/**
 * Inline constraints of a schema (enum values, default, bounds, format,
 * pattern) as a short fragment suitable for appending to a table cell.
 */
function constraintsForSchema(schema) {
  if (!schema || schema.$ref) return "";
  const parts = [];
  if (schema.enum) parts.push(`One of: ${schema.enum.map(v => `<code>${esc(v)}</code>`).join(", ")}.`);
  if (schema.default !== undefined) parts.push(`Default: <code>${esc(JSON.stringify(schema.default))}</code>.`);
  if (schema.minimum !== undefined) parts.push(`Minimum: <code>${esc(schema.minimum)}</code>.`);
  if (schema.maximum !== undefined) parts.push(`Maximum: <code>${esc(schema.maximum)}</code>.`);
  if (schema.minLength !== undefined) parts.push(`Minimum length: <code>${esc(schema.minLength)}</code>.`);
  if (schema.maxLength !== undefined) parts.push(`Maximum length: <code>${esc(schema.maxLength)}</code>.`);
  if (schema.format) parts.push(`Format: <code>${esc(schema.format)}</code>.`);
  if (schema.pattern) parts.push(`Pattern: <code>${esc(schema.pattern)}</code>.`);
  return parts.join(" ");
}

function renderEnumTable(schema) {
  if (!schema.enum) return "";
  let out = "<emu-table><emu-caption>Enumeration of possible values</emu-caption><table>";
  out += "<thead><tr><th>Value</th></tr></thead><tbody>";
  for (const v of schema.enum) out += `<tr><td><code>${esc(v)}</code></td></tr>`;
  out += "</tbody></table></emu-table>\n";
  return out;
}

/**
 * Flattens `allOf` composition: named members become "includes" links, inline
 * members contribute their properties and required lists. Nested `allOf` is
 * recursed. `oneOf` / `anyOf` variants are collected but not merged.
 */
function collectComposition(schema, acc = { includes: [], properties: {}, required: new Set(), oneOf: [], anyOf: [] }) {
  if (!schema) return acc;
  for (const member of schema.allOf || []) {
    if (member.$ref) acc.includes.push(member);
    else collectComposition(member, acc);
  }
  for (const [name, prop] of Object.entries(schema.properties || {})) acc.properties[name] = prop;
  for (const r of schema.required || []) acc.required.add(r);
  for (const v of schema.oneOf || []) acc.oneOf.push(v);
  for (const v of schema.anyOf || []) acc.anyOf.push(v);
  return acc;
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

function renderSchemaClause(name, schema, idPrefix = "tea-schema-") {
  const id = `sec-${idPrefix}${slug(name)}`;
  let out = `<emu-clause id="${escAttr(id)}">\n<h1>${esc(name)}</h1>\n`;
  if (schema.description) out += renderDescription(schema.description);
  if (schema.type) out += `<p><strong>Type:</strong> ${esc(schema.type)}</p>\n`;
  if (schema.format) out += `<p><strong>Format:</strong> ${esc(schema.format)}</p>\n`;
  if (schema.pattern) out += `<p><strong>Pattern:</strong> <code class="pattern">${esc(schema.pattern)}</code></p>\n`;
  if (schema.default !== undefined) out += `<p><strong>Default:</strong> <code>${esc(JSON.stringify(schema.default))}</code></p>\n`;
  if (schema.minimum !== undefined) out += `<p><strong>Minimum:</strong> <code>${esc(schema.minimum)}</code></p>\n`;
  if (schema.maximum !== undefined) out += `<p><strong>Maximum:</strong> <code>${esc(schema.maximum)}</code></p>\n`;
  if (schema.enum) out += renderEnumTable(schema);

  const comp = collectComposition(schema);
  if (comp.includes.length) {
    out += `<p>Includes all properties of ${comp.includes.map(typeForSchema).join(", ")}.</p>\n`;
  }
  if (comp.oneOf.length) {
    out += `<p><strong>One of:</strong> ${comp.oneOf.map(typeForSchema).join(", ")}</p>\n`;
  }
  if (comp.anyOf.length) {
    out += `<p><strong>Any of:</strong> ${comp.anyOf.map(typeForSchema).join(", ")}</p>\n`;
  }
  out += renderPropertiesTable(comp.properties, comp.required);

  if (schema.examples || schema.example) {
    const examples = schema.examples || [schema.example];
    for (const ex of examples) {
      out += "<emu-example><pre>" + esc(typeof ex === "string" ? ex : JSON.stringify(ex, null, 2)) + "</pre></emu-example>\n";
    }
  }
  out += "</emu-clause>\n";
  return out;
}

/**
 * Formats an OpenAPI security requirement list: alternatives are objects
 * keyed by scheme name; an empty object means the operation may be called
 * without credentials.
 */
function renderSecurityRequirement(requirements) {
  if (!requirements || !requirements.length) return "none";
  return requirements
    .map(alt => {
      const names = Object.keys(alt);
      if (!names.length) return "none (anonymous access)";
      return names.map(n => `<a href="#sec-tea-api-security"><code>${esc(n)}</code></a>`).join(" and ");
    })
    .join(" or ");
}

function renderSecurityClause(doc) {
  const schemes = (doc.components && doc.components.securitySchemes) || {};
  if (!Object.keys(schemes).length && !doc.security) return "";
  let out = `<emu-clause id="sec-tea-api-security">\n<h1>Security</h1>\n`;
  if (Object.keys(schemes).length) {
    out += "<emu-table><emu-caption>Security schemes</emu-caption><table>";
    out += "<thead><tr><th>Scheme</th><th>Type</th><th>Description</th></tr></thead><tbody>";
    for (const [name, s] of Object.entries(schemes)) {
      const type = [s.type, s.scheme, s.in ? `in ${s.in}` : ""].filter(Boolean).join(" ");
      out += `<tr><td><code>${esc(name)}</code></td>`;
      out += `<td>${esc(type)}</td>`;
      out += `<td>${renderCell(s.description)}</td></tr>`;
    }
    out += "</tbody></table></emu-table>\n";
  }
  out += `<p>Unless an operation states otherwise, every operation requires: ${renderSecurityRequirement(doc.security)}.</p>\n`;
  out += "</emu-clause>\n";
  return out;
}

function renderOperation(doc, method, pathStr, op) {
  const opIdSlug = slug(op.operationId || `${method}-${pathStr}`);
  const id = `sec-tea-op-${opIdSlug}`;
  let out = `<emu-clause id="${escAttr(id)}">\n`;
  out += `<h1>${esc(op.summary || op.operationId || `${method.toUpperCase()} ${pathStr}`)}</h1>\n`;
  out += `<p><span class="tea-method">${method.toUpperCase()}</span><code class="tea-path">${esc(pathStr)}</code></p>\n`;
  if (op.description) out += renderDescription(op.description);
  if (op.security) out += `<p><strong>Security:</strong> ${renderSecurityRequirement(op.security)}</p>\n`;

  if (op.parameters && op.parameters.length > 0) {
    out += "<emu-table><emu-caption>Parameters</emu-caption><table>";
    out += "<thead><tr><th>Name</th><th>In</th><th>Required</th><th>Type</th><th>Description</th></tr></thead><tbody>";
    for (const p0 of op.parameters) {
      const p = deref(doc, p0);
      out += `<tr><td><code>${esc(p.name)}</code></td>`;
      out += `<td>${esc(p.in)}</td>`;
      out += `<td>${p.required ? "Yes" : "No"}</td>`;
      out += `<td>${typeForSchema(p.schema)}</td>`;
      out += `<td>${renderCell(p.description, constraintsForSchema(p.schema))}</td></tr>`;
    }
    out += "</tbody></table></emu-table>\n";
  }

  if (op.requestBody) {
    const body = deref(doc, op.requestBody);
    out += "<p><strong>Request body:</strong></p>";
    if (body.description) out += renderDescription(body.description);
    const contents = body.content || {};
    for (const [mime, mediaType] of Object.entries(contents)) {
      out += `<p><code>${esc(mime)}</code>&mdash;${typeForSchema(mediaType.schema)}`;
      if (body.required) out += " (required)";
      out += "</p>";
    }
  }

  if (op.responses) {
    const responses = Object.entries(op.responses).map(([status, r]) => [status, deref(doc, r)]);
    out += "<emu-table><emu-caption>Responses</emu-caption><table>";
    out += "<thead><tr><th>Status</th><th>Description</th><th>Schema</th></tr></thead><tbody>";
    for (const [status, resp] of responses) {
      const contents = resp.content || {};
      const schemas = Object.values(contents).map(c => typeForSchema(c.schema)).join(", ") || "—";
      out += `<tr><td><code>${esc(status)}</code></td>`;
      out += `<td>${renderCell(resp.description)}</td>`;
      out += `<td>${schemas}</td></tr>`;
    }
    out += "</tbody></table></emu-table>\n";

    const withHeaders = responses.filter(([, r]) => r.headers && Object.keys(r.headers).length);
    if (withHeaders.length) {
      out += "<emu-table><emu-caption>Response headers</emu-caption><table>";
      out += "<thead><tr><th>Status</th><th>Header</th><th>Type</th><th>Description</th></tr></thead><tbody>";
      for (const [status, resp] of withHeaders) {
        for (const [name, h0] of Object.entries(resp.headers)) {
          const h = deref(doc, h0);
          out += `<tr><td><code>${esc(status)}</code></td>`;
          out += `<td><code>${esc(name)}</code></td>`;
          out += `<td>${typeForSchema(h.schema)}</td>`;
          out += `<td>${renderCell(h.description, constraintsForSchema(h.schema))}</td></tr>`;
        }
      }
      out += "</tbody></table></emu-table>\n";
    }
  }

  out += "</emu-clause>\n";
  return out;
}

/**
 * Produce the API-surface section: paths grouped by tag, plus a data-model
 * section listing components.schemas. Wraps the whole thing in a single
 * top-level <emu-clause id="sec-tea-api">.
 */
export async function openApiToEmu(yamlText, { normativeOptionalTags = [] } = {}) {
  const doc = await loadOpenApi(yamlText);

  let out = "";
  out += `<emu-clause id="sec-tea-api">\n<h1>The TEA API</h1>\n`;
  if (doc.info && doc.info.description && doc.info.description !== "TBC") {
    out += renderDescription(doc.info.description);
  }
  out += renderSecurityClause(doc);

  const byTag = new Map();
  const untagged = [];
  for (const [pathStr, pathItem] of Object.entries(doc.paths || {})) {
    for (const m of HTTP_METHODS) {
      const op = pathItem[m];
      if (!op) continue;
      const tags = op.tags && op.tags.length ? op.tags : null;
      if (tags) {
        for (const t of tags) {
          if (!byTag.has(t)) byTag.set(t, []);
          byTag.get(t).push({ method: m, path: pathStr, op });
        }
      } else {
        untagged.push({ method: m, path: pathStr, op });
      }
    }
  }

  // Section order follows the document's own `tags` list, which is where the working
  // group states the order operations should be read in. Tags used by an operation but
  // not declared there are appended alphabetically, so nothing is dropped if the list
  // falls behind the paths.
  const declared = [];
  for (const t of doc.tags || []) {
    const name = typeof t === "string" ? t : t && t.name;
    if (name && byTag.has(name) && !declared.includes(name)) declared.push(name);
  }
  const undeclared = Array.from(byTag.keys()).filter(t => !declared.includes(t)).sort();
  const tagOrder = [...declared, ...undeclared];
  for (const tag of normativeOptionalTags) {
    if (!byTag.has(tag)) console.warn(`normative-optional tag not found in the OpenAPI document: ${tag}`);
  }
  for (const tag of tagOrder) {
    const optional = normativeOptionalTags.includes(tag) ? " normative-optional" : "";
    out += `<emu-clause id="sec-tea-api-${escAttr(slug(tag))}"${optional}>\n`;
    out += `<h1>${esc(tag)}</h1>\n`;
    for (const { method, path, op } of byTag.get(tag)) {
      out += renderOperation(doc, method, path, op);
    }
    out += "</emu-clause>\n";
  }
  if (untagged.length) {
    out += `<emu-clause id="sec-tea-api-untagged">\n<h1>Other operations</h1>\n`;
    for (const { method, path, op } of untagged) out += renderOperation(doc, method, path, op);
    out += "</emu-clause>\n";
  }

  out += "</emu-clause>\n";

  const schemas = (doc.components && doc.components.schemas) || {};
  if (Object.keys(schemas).length) {
    out += `<emu-clause id="sec-tea-data-model">\n<h1>Data model</h1>\n`;
    out += `<p>This section catalogues the named schemas declared in <code>components.schemas</code>.</p>\n`;
    const names = Object.keys(schemas).sort();
    for (const name of names) {
      out += renderSchemaClause(name, schemas[name]);
    }
    out += "</emu-clause>\n";
  }

  return out;
}
