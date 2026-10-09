# AIMS repository document list omitted `docs` Markdown files

## Symptom

The AIMS deliverable document picker showed Markdown files from the repository root, but did not show Markdown files under `docs/`.

## Root cause

The Console GitLab `gitlab.markdown-tree` operation recursively scanned the entire repository and stopped after 20 pages (2,000 tree entries). In large monorepos, unrelated source directories exhausted that limit before GitLab returned the `docs` subtree. The later path filter allowed `docs/**.md`, but those entries had never been fetched.

## Fix

- Read the repository root non-recursively and retain root-level Markdown files.
- Read `docs` separately and recursively, then retain Markdown files at every depth.
- Treat a missing `docs` directory (GitLab 404) as an empty optional directory.
- Keep pagination local to each targeted tree request so unrelated repository contents cannot hide document files.

## Validation

- Added `TestGitLabMarkdownTreeReadsRootAndDocsSeparately` covering root Markdown, nested `docs` Markdown, non-Markdown filtering, and request shape.
- `go test ./...`
- `go vet ./...`
