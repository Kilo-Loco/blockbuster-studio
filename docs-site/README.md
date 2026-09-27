# Blockbuster Studio docs

User documentation for Blockbuster Studio, built with [Blume](https://useblume.dev/docs).
Pages live in `docs/`. `OUTLINE.md` lists what's written and what's planned.

```sh
npm install
npm run dev      # local preview with hot reload
npm run build    # static site in dist/
npx blume validate   # check for broken links
```

Blume notes:
- Components need no imports. Steps use `<Steps><Step title="…">`, tabs use `<Tabs><Tab title="…">`.
- Lists inside a `<Step>` render without bullets or numbers (Blume 2.0.3), so use paragraphs there.
- Unknown frontmatter keys fail the build.
