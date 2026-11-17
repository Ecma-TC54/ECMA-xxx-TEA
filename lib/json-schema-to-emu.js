import {esc, escAttr, renderDescription, renderPropertiesTable, slug} from './util.js';

export const WELL_KNOWN_ANNEX_ID = "sec-tea-well-known-schema";
const DEF_ID_PREFIX = "tea-well-known-";

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

function renderObjectBody(schema) {
  let out = "";
  if (schema.description) out += renderDescription(schema.description);
  if (schema.type) out += `<p><strong>Type:</strong> ${esc(schema.type)}</p>\n`;
  if (schema.additionalProperties === false) {
    out += "<p>Additional properties are not permitted.</p>\n";
  }
  const required = new Set(schema.required || []);
  out += renderPropertiesTable(schema.properties, required, typeForSchema);
  if (schema.examples || schema.example) {
    const examples = schema.examples || [schema.example];
    for (const ex of examples) {
      out += "<emu-example><pre><code class='json'>" + esc(typeof ex === "string" ? ex : JSON.stringify(ex, null, 2)) + "</code></pre></emu-example>\n";
    }
  }
  return out;
}

/**
 * Convert a JSON Schema document into a normative annex. Nested `definitions` are child annexes. `$ref`s of the form
 * `#/definitions/<name>` become xrefs to those child annexes.
 *
 * The source JSON is emitted verbatim as the schema (so the annex cannot drift from the imported file). The tables that
 * follow summarize it.
 */
export function jsonSchemaToEmuAnnex(schema, {
  id = WELL_KNOWN_ANNEX_ID,
  heading = "TEA well-known discovery schema",
  sourceJson,
} = {}) {
  const json = (sourceJson !== undefined ? String(sourceJson) : JSON.stringify(schema, null, 2)).trimEnd();
  let out = `<emu-annex id="${escAttr(id)}" normative>\n<h1>${esc(heading)}</h1>\n`;
  out += `<p>This annex specifies the schema for the TEA <code>/.well-known/tea</code> discovery document. The schema is expressed in JSON Schema draft-07 (<emu-xref href="#json-schema-core"></emu-xref>, <emu-xref href="#json-schema-validation"></emu-xref>).</p>\n`;
  out += "<p>The following JSON document is the schema. The tables that follow summarize it.</p>\n";
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
