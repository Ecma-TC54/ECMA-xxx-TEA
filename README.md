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

Two sources of truth are pulled from there at build time:

- `spec/openapi.yaml` — the API surface and data model are generated from it.
- The narrative Markdown files (discovery, authentication, use cases, the TEA
  object model, signatures, …) — imported verbatim as specification prose.

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
