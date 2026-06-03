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

The normative source material is **not** authored in this repository. It lives
in the OWASP/CycloneDX TEA source repository:

> <https://github.com/CycloneDX/transparency-exchange-api>

Three things are pulled from there at build time (see
[What gets pulled from the TEA source](#what-gets-pulled-from-the-tea-source)
for the exact details):

- `spec/openapi.yaml` — the API surface and the data model are generated from it.
- A curated, ordered list of narrative Markdown files — imported as
  specification prose.
- The `## Introduction` section of the upstream `README.md` — used as the
  spec's Introduction.

This repository owns the **publication pipeline**: it converts those sources
into an [Ecmarkup](https://github.com/tc39/ecmarkup) document and renders it to
HTML and PDF using the same toolchain TC54 already uses for ECMA-424.

```
CycloneDX/transparency-exchange-api  (Markdown + OpenAPI)
        │  fetched by index.js
        ▼
   spec.html  (generated Ecmarkup source, committed)
        │  ecmarkup
        ▼
   out/  (single-page + multipage HTML)
        │  PrinceXML (ghcr.io/ecma-tc54/princexml in CI)
        ▼
   out/spec.pdf
```

### Layout

| Path | Purpose |
|---|---|
| `index.js` | Fetches TEA sources and assembles `spec.html`. |
| `lib/md-to-emu.js` | Markdown → nested `<emu-clause>` conversion. |
| `lib/openapi-to-emu.js` | OpenAPI → API-surface and data-model clauses. |
| `excerpts/` | Hand-authored front/back matter (header, scope, conformance, references, terms, bibliography, colophon). |
| `spec.html` | Generated Ecmarkup source, committed for reviewer diff-ability. |

## What gets pulled from the TEA source

All three inputs are fetched from
`https://raw.githubusercontent.com/CycloneDX/transparency-exchange-api/<ref>/<path>`.
The `<ref>` is set by `TEA_SOURCE_REF` in `index.js` and currently tracks
`main` (there is a `TODO` to pin it to a tag or commit before the first
publication build, for reproducibility). Fetched files are cached under
`tea-source/` (git-ignored) so repeated builds don't re-download.

### Narrative Markdown — an explicit, ordered allowlist

The narrative chapters are **not** discovered by a glob and it is **not**
"every `.md` file in the repo". They come from a hand-curated list,
`NARRATIVE_DOCS` in `index.js`. Each entry is `[pathInTeaRepo, idPrefix]`:

```js
const NARRATIVE_DOCS = [
  ["doc/tea-requirements.md", "req"],
  ["doc/tea-usecases.md", "uc"],
  ["discovery/readme.md", "discovery"],
  ["auth/readme.md", "auth"],
  ["api-flow/consumer.md", "flow-consumer"],
  ["api-flow/publisher.md", "flow-publisher"],
  ["tea-product/tea-product.md", "tea-product"],
  ["tea-product/tea-product-release.md", "tea-product-release"],
  ["tea-component/tea-component.md", "tea-component"],
  ["tea-component/tea-release.md", "tea-release"],
  ["tea-collection/tea-collection.md", "tea-collection"],
  ["tea-artifact/tea-artifact.md", "tea-artifact"],
  ["signatures/signature.md", "signatures"],
];
```

- **Ordering is significant.** Chapters appear in the rendered specification
  in exactly the order listed here — this is an editorial decision, not
  filesystem or alphabetical order.
- **`idPrefix` gives stable, collision-free clause IDs.** Each Markdown
  heading becomes an `<emu-clause>` whose ID is
  `sec-<idPrefix>-<n>-<slug-of-heading>` (the `<n>` is a per-document counter).
  The prefix namespaces the IDs so two chapters can use the same heading text
  (e.g. "Overview") without producing duplicate IDs, and so that
  cross-references and deep links stay stable across rebuilds.
- **Conversion.** `lib/md-to-emu.js` maps Markdown headings (`#`…`######`) to
  nested clauses, strips the leading table-of-contents bullet list that some
  documents carry (Ecmarkup builds its own TOC), and drops code-fence language
  hints that the bundled highlighter can't parse (e.g. `mermaid`, `abnf`,
  `http`).
- **Missing files degrade gracefully.** If a path 404s, the build logs a
  warning and skips it rather than failing — so an upstream rename won't break
  CI, but the affected chapter silently disappears until the list is updated.

**Why a curated list and not a glob:** (1) chapter order in a standard is
editorial; (2) the TEA repo contains Markdown that must *not* be published
(e.g. `README.md`, contributor notes, implementation lists); and (3) stable
clause IDs need the per-file `idPrefix`. The flip side: when the working group
adds or renames a chapter upstream, **this list is the editorial control point
that must be updated here** for the change to appear in the spec.

### `spec/openapi.yaml` — generated API surface and data model

`lib/openapi-to-emu.js` loads the document (bundling internal `$ref`s while
preserving named-schema identity) and emits two top-level clauses:

1. **The TEA API** (`#sec-tea-api`). Operations are grouped into a subclause
   per OpenAPI **tag** (`#sec-tea-api-<tag>`). For every operation it renders:
   - a heading from the operation `summary` (falling back to `operationId`),
     under a stable ID `#sec-tea-op-<operationId>`;
   - the HTTP method and path;
   - the operation `description`;
   - a **Parameters** table — name, location (`in`), required, type, description;
   - the **request body** — media type and schema;
   - a **Responses** table — status code, description, response schema.

   If `info.description` is present and not the placeholder `TBC`, it is
   rendered as the section's lead paragraph. Operations with no tag are
   collected under an "Other operations" subclause.

2. **Data model** (`#sec-tea-data-model`). One subclause per entry in
   `components.schemas`, ID `#sec-tea-schema-<name>`, rendering: the schema
   `description`, `type`, `format`, `pattern`, an **enum** table (if any), a
   **Properties** table (property, type, Required/Optional, description), and
   any `examples`/`example`. Property and parameter types that reference
   another schema are linked to that schema's clause, so the data model is
   cross-referenced.

> Note: `oneOf` / `anyOf` / `allOf` are currently surfaced as the type name
> only; the variants are not yet recursed into. The build also expects internal
> (`#/components/...`) refs only — there are no external `$ref`s in the current
> document.

### `README.md` — Introduction only

Only the `## Introduction` section of the upstream `README.md` is extracted
(by `index.js`) and rendered as the spec's Introduction. The rest of that
README is ignored.

## Building locally

```bash
npm ci                 # install (PUPPETEER_SKIP_DOWNLOAD=true is fine)
npm run generate-spec  # fetch TEA sources -> spec.html
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

- **Narrative or API changes** belong upstream in
  [CycloneDX/transparency-exchange-api](https://github.com/CycloneDX/transparency-exchange-api).
- **Front/back matter, build tooling, and publication concerns** belong here.

Contributions are managed by TC54. We thank Ecma's TC39 for **Ecmarkup**, which
TC54 has adopted for preparing and maintaining this specification.
