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
  return esc(schema.type || (schema.oneOf ? "oneOf" : schema.anyOf ? "anyOf" : "object"));
}

function renderEnumTable(schema) {
  if (!schema.enum) return "";
  let out = "<emu-table><emu-caption>Enumeration of possible values</emu-caption><table>";
  out += "<thead><tr><th>Value</th></tr></thead><tbody>";
  for (const v of schema.enum) out += `<tr><td><code>${esc(v)}</code></td></tr>`;
  out += "</tbody></table></emu-table>\n";
  return out;
}

function renderPropertiesTable(schema) {
  if (!schema.properties) return "";
  const required = new Set(schema.required || []);
  let out = "<emu-table><emu-caption>Properties</emu-caption><table>";
  out += "<thead><tr><th>Property</th><th>Type</th><th>Requirement</th><th>Description</th></tr></thead><tbody>";
  for (const [name, prop] of Object.entries(schema.properties)) {
    out += `<tr><td><code>${esc(name)}</code></td>`;
    out += `<td>${typeForSchema(prop)}</td>`;
    out += `<td>${required.has(name) ? "Required" : "Optional"}</td>`;
    out += `<td>${esc(prop.description || "")}</td></tr>`;
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
  if (schema.enum) out += renderEnumTable(schema);
  if (schema.properties) out += renderPropertiesTable(schema);
  if (schema.examples || schema.example) {
    const examples = schema.examples || [schema.example];
    for (const ex of examples) {
      out += "<emu-example><pre>" + esc(typeof ex === "string" ? ex : JSON.stringify(ex, null, 2)) + "</pre></emu-example>\n";
    }
  }
  out += "</emu-clause>\n";
  return out;
}

function renderOperation(method, pathStr, op) {
  const opIdSlug = slug(op.operationId || `${method}-${pathStr}`);
  const id = `sec-tea-op-${opIdSlug}`;
  let out = `<emu-clause id="${escAttr(id)}">\n`;
  out += `<h1>${esc(op.summary || op.operationId || `${method.toUpperCase()} ${pathStr}`)}</h1>\n`;
  out += `<p><span class="tea-method">${method.toUpperCase()}</span><code class="tea-path">${esc(pathStr)}</code></p>\n`;
  if (op.description) out += renderDescription(op.description);

  if (op.parameters && op.parameters.length > 0) {
    out += "<emu-table><emu-caption>Parameters</emu-caption><table>";
    out += "<thead><tr><th>Name</th><th>In</th><th>Required</th><th>Type</th><th>Description</th></tr></thead><tbody>";
    for (const p of op.parameters) {
      out += `<tr><td><code>${esc(p.name)}</code></td>`;
      out += `<td>${esc(p.in)}</td>`;
      out += `<td>${p.required ? "Yes" : "No"}</td>`;
      out += `<td>${typeForSchema(p.schema)}</td>`;
      out += `<td>${esc(p.description || "")}</td></tr>`;
    }
    out += "</tbody></table></emu-table>\n";
  }

  if (op.requestBody) {
    out += "<p><strong>Request body:</strong></p>";
    const contents = op.requestBody.content || {};
    for (const [mime, mediaType] of Object.entries(contents)) {
      out += `<p><code>${esc(mime)}</code> &mdash; ${typeForSchema(mediaType.schema)}`;
      if (op.requestBody.required) out += " (required)";
      out += "</p>";
    }
  }

  if (op.responses) {
    out += "<emu-table><emu-caption>Responses</emu-caption><table>";
    out += "<thead><tr><th>Status</th><th>Description</th><th>Schema</th></tr></thead><tbody>";
    for (const [status, resp] of Object.entries(op.responses)) {
      const contents = resp.content || {};
      const schemas = Object.values(contents).map(c => typeForSchema(c.schema)).join(", ") || "—";
      out += `<tr><td><code>${esc(status)}</code></td>`;
      out += `<td>${esc(resp.description || "")}</td>`;
      out += `<td>${schemas}</td></tr>`;
    }
    out += "</tbody></table></emu-table>\n";
  }

  out += "</emu-clause>\n";
  return out;
}

/**
 * Produce the API-surface section: paths grouped by tag, plus a data-model
 * section listing components.schemas. Wraps the whole thing in a single
 * top-level <emu-clause id="sec-tea-api">.
 */
export async function openApiToEmu(yamlText) {
  const doc = await loadOpenApi(yamlText);

  let out = "";
  out += `<emu-clause id="sec-tea-api">\n<h1>The TEA API</h1>\n`;
  if (doc.info && doc.info.description && doc.info.description !== "TBC") {
    out += renderDescription(doc.info.description);
  }

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

  const tagOrder = Array.from(byTag.keys()).sort();
  for (const tag of tagOrder) {
    out += `<emu-clause id="sec-tea-api-${escAttr(slug(tag))}">\n`;
    out += `<h1>${esc(tag)}</h1>\n`;
    for (const { method, path, op } of byTag.get(tag)) {
      out += renderOperation(method, path, op);
    }
    out += "</emu-clause>\n";
  }
  if (untagged.length) {
    out += `<emu-clause id="sec-tea-api-untagged">\n<h1>Other operations</h1>\n`;
    for (const { method, path, op } of untagged) out += renderOperation(method, path, op);
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
