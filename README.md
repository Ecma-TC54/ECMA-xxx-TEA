# ECMA-xxx-TEA (Transparency Exchange API Specification)

This repository hosts the work-in-progress technical specification for the
**Transparency Exchange API (TEA)**, being developed under Ecma International's
**Technical Committee 54 (TC54)**. TEA standardises the exchange of software,
hardware and system transparency artefacts — such as Bills of Materials (xBOMs),
attestations, and vulnerability disclosure documents — between publishers and
consumers.

### Important Note on Repository Name

This repository is named `ECMA-xxx-TEA` as a placeholder. Upon ratification of
the specification as an Ecma International standard, it will be renamed to
**`ECMA-xxx`**, where `xxx` is the number assigned by Ecma.

## How this specification is built

The API clause and JSON Schema annex are automatically generated from the machine-readable source at

> <https://github.com/CycloneDX/transparency-exchange-api>

Upon running `npm run build`, the following actions take place for both source files:

- the file is fetched from the above GitHub repo
- it's saved to clauses/spec
- it's then read to generate the appropriate .emu file

Then, ecmarkup runs using spec.html as an entry file and compiled to out/

Generated content is not committed to the repository.

There is an option to alternatively fetch these files from a local clone of the repository, running
`npm run build-local`

### Layout

| Path                        | Purpose                                        |
|-----------------------------|------------------------------------------------|
| `index.js`                  | Fetches TEA sources and assembles `spec.html`. |
| `lib/openapi-to-emu.js`     | OpenAPI → API-surface and data-model clauses.  |
| `lib/json-schema-to-emu.js` | JSON Schema → well-known discovery annex.      |
| `clauses/`                  | Clauses for the Ecma Standard.                 |
| `spec.html`                 | Entry file for ecmarkup compilation.           |

## What gets pulled from the TEA source

Machine-readable inputs are fetched from
`https://raw.githubusercontent.com/CycloneDX/transparency-exchange-api/<ref>/<path>`.
The `<ref>` is set by `TEA_SOURCE_REF` in `index.js` and currently tracks
`main` (there is a `TODO` to pin it to a tag or commit before the first
publication build, for reproducibility).

### `spec/openapi.yaml` — generated API surface and data model

`lib/openapi-to-emu.js` loads the document (bundling internal `$ref`s while
preserving named-schema identity) and emits two top-level clauses:

1. **The TEA API** (`#sec-tea-api`). Operations are grouped into a subclause
   per OpenAPI **tag** (`#sec-tea-api-<tag>`). For every operation it renders:
   - a heading from the operation `summary` (falling back to `operationId`),
     under a stable ID `#sec-tea-op-<operationId>`;
   - the HTTP method and path;
   - the operation `description`;
   - the operation's **security** requirement, when it overrides the
     document default;
   - a **Parameters** table — name, location (`in`), required, type,
     description (plus enum values, default and bounds where declared);
   - the **request body** — description, media type and schema;
   - a **Responses** table — status code, description, response schema;
   - a **Response headers** table — status, header name, type, description
     (only for operations that declare response headers).

   `$ref`s to reusable `components.parameters`, `components.responses`,
   `components.headers` and `components.requestBodies` are resolved so the
   shared definition is rendered in place of the reference.

   If `components.securitySchemes` or a document-level `security` requirement
   is present, a **Security** subclause (`#sec-tea-api-security`) is emitted
   first, listing the schemes and the default requirement.

   If `info.description` is present and not the placeholder `TBC`, it is
   rendered as the section's lead paragraph. Operations with no tag are
   collected under an "Other operations" subclause.

2. **Data model** (`#sec-tea-data-model`). One subclause per entry in
   `components.schemas`, ID `#sec-tea-schema-<name>`, rendering: the schema
   `description`, `type`, `format`, `pattern`, an **enum** table (if any), a
   **Properties** table (property, type, Required/Optional, description with
   any enum values, default, bounds and format), and any `examples`/`example`.
   Property and parameter types that reference another schema are linked to
   that schema's clause, so the data model is cross-referenced.

> Note: `allOf` is flattened — named members are listed as "Includes all
> properties of …" links and inline members contribute rows to the Properties
> table. `oneOf` / `anyOf` variants are listed as links but not merged. The
> build also expects internal (`#/components/...`) refs only — there are no
> external `$ref`s in the current document.

### `discovery/tea-well-known.schema.json` — normative annex

`lib/json-schema-to-emu.js` renders that JSON Schema as a **normative annex**
(`<emu-annex … normative>`, `#sec-tea-well-known-schema`) immediately after
the data model and before the informative "Specification narrative" annex.
The imported JSON is emitted verbatim as the schema; the tables that follow
summarize it, including item-level `description` and `examples`. Nested
`definitions` become child annexes (`#sec-tea-well-known-<name>`), also
marked normative.

The annex is generated from the same TEA source revision as the rest of the
build. It is not a separately maintained copy of the schema. The dialect
(JSON Schema draft-07 Core and Validation) is listed in Normative references.

## Building locally

```bash
npm ci                 # install; downloads a Chrome for the Mermaid renderer
                       # (set PUPPETEER_SKIP_DOWNLOAD=true and PUPPETEER_EXECUTABLE_PATH
                       # to reuse an installed Chrome/Chromium instead)
npm run generate-spec  # fetch TEA sources, render diagrams -> spec.html
npm run build          # spec.html -> out/ (single + multipage HTML, lint-spec)
npm run build-for-pdf  # spec.html -> out/index.html with external assets (PDF input)
```

To render a PDF locally you need [PrinceXML](https://www.princexml.com/):

```bash
prince-books --script ./node_modules/ecmarkup/js/print.js out/index.html -o out/spec.pdf
```

CI runs the licensed `ghcr.io/ecma-tc54/princexml` container to produce a
watermark-free PDF (see `.github/workflows/build.yml`).

## Contributing

- **API changes** belong upstream in
  [CycloneDX/transparency-exchange-api](https://github.com/CycloneDX/transparency-exchange-api).
- **Front/back matter, build tooling, formal standard langauge, and publication concerns** belong here.

Contributions are managed by TC54. We thank Ecma's TC39 for **Ecmarkup**, which
TC54 has adopted for preparing and maintaining this specification.
