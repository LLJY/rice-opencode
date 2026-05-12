---
name: docs-workflow
description: Use the pandoc docs plugin for markdown-first papers, reports, citations, refs.bib sidecars, and preset-aware PDF workflows.
compatibility: opencode
metadata:
  domain: documents
  workflow: pandoc
---

## What I do

I teach the docs plugin workflow for:

- scholarly papers
- school reports
- styled PDFs
- bibliography and citation handling
- draft-based document iteration

Use me when the user wants a PDF, paper, report, bibliography, citation formatting, or LaTeX output through the docs tools.

## Default approach

Prefer the **draft workflow** unless the user clearly wants a one-shot conversion.

1. Check templates first with `docs_templates_list`
2. Install missing pieces with `docs_templates_install`
3. Create a draft with `docs_draft`
4. Edit `.opencode/docs/<id>/draft.md` with normal file editing tools
5. Add references in `.opencode/docs/<id>/refs.bib`
6. Compile with `docs_compile`

This keeps authoring markdown-first and avoids forcing the model to write full LaTeX projects.

## Tool selection

### Prefer these for iterative work

- `docs_draft` — create a reusable document workspace
- `docs_compile` — compile a draft to PDF using its preset
- `docs_list_drafts` — inspect active drafts
- `docs_delete_draft` — delete only when the user asks

### Use these for one-shot workflows

- `docs_create` — generic preset-based PDF creation
- `docs_create_ieee_paper` — fast IEEE paper generation
- `docs_create_school_report` — SIT/UofG school report path
- `docs_create_styled_pdf` — Eisvogel-like styled output
- `docs_generate_latex` — emit `.tex` source instead of PDF
- `docs_compile_latex` — compile an existing `.tex` file
- `docs_convert` — format conversion only

## Citation and bibliography rules

Keep references in a sidecar `refs.bib` when possible.

- Use Pandoc citation syntax in markdown, for example `[@vaswani2017]`
- `docs_compile` and one-shot creation tools will use `refs.bib` automatically when it sits beside the markdown or draft
- `bibliography` can still be passed explicitly when needed

### `citation_style`

- `default`
  - uses the preset default
  - IEEE presets use the BibTeX multi-pass path
  - school/general presets usually use citeproc + CSL if configured
- `ieee`
  - use IEEE-style citations
  - on IEEE presets this triggers the real BibTeX workflow
- `apa`
  - use CSL-based APA formatting
- `acm`
  - use CSL-based ACM formatting
- `none`
  - disable citation processing when the user wants literal citation syntax left alone

### Backend expectations

- IEEE presets (`ieee-conference`, `ieee-journal`) are special
  - the tool generates `.tex`
  - runs `pdflatex`, `bibtex`, `pdflatex`, `pdflatex`
- school/general paths should usually stay markdown-first and use citeproc/CSL instead of a full BibTeX workflow

If the relevant CSL file or template is missing, install it instead of guessing.

## Preset guidance

- `ieee-conference` — two-column IEEE conference paper
- `ieee-journal` — IEEE journal paper
- `school-report` — SIT/UofG report
- `eisvogel` — general polished PDF
- `acm-sigconf` — ACM conference paper
- `lncs` — Springer LNCS

Call `docs_presets_list` or `docs_presets_show` if the user is unsure.

## Authoring guidance

Prefer markdown plus light raw LaTeX only where needed:

- normal prose in markdown
- markdown tables first
- raw LaTeX only for equations, IEEE-specific figures, or edge cases
- avoid full custom TeX unless the user explicitly wants LaTeX source

### IEEE authors

For IEEE templates, structured frontmatter works well:

```yaml
author:
  - name: "A. Author"
    affiliation: "Example Lab"
    location: "City, Country"
    email: "author@example.com"
```

### School report authors

For `docs_compile` or `docs_create_school_report`, the `authors` JSON argument is used for the special author table.

## Recommended workflow examples

### Iterative paper workflow

1. `docs_templates_list`
2. `docs_draft(title="...", preset="ieee-conference")`
3. Edit `draft.md`
4. Edit `refs.bib`
5. `docs_compile(doc_id="...", citation_style="default")`

### APA-style report workflow

1. Ensure `csl-apa` is installed if needed
2. Create or prepare markdown plus `refs.bib`
3. Use `docs_create(..., preset="eisvogel", citation_style="apa")` or the draft workflow

### Literal markdown / no citation processing

Use `citation_style="none"` when the user wants citation-like text left as-is.

## Decision rules

- If the user will revise the document, use the draft workflow
- If they ask for a paper/report and do not specify a format, ask which preset or recommend one
- If they ask for scholarly formatting, ask what citation style they need unless the preset makes it obvious
- If IEEE is requested, prefer the IEEE preset and sidecar `refs.bib`
- If APA is requested for a report, prefer citeproc + `apa.csl`
- If a template is missing, install it before compiling
- Do not delete drafts unless the user asks

## Common mistakes to avoid

- Do not write full LaTeX unnecessarily when markdown is enough
- Do not put bibliography entries inline in the markdown body when `refs.bib` is available
- Do not assume IEEE and APA should use the same backend
- Do not forget to install missing CSL/template assets
- Do not use `docs_compile_latex` for markdown-first docs when `docs_compile` or `docs_create*` is the right path
