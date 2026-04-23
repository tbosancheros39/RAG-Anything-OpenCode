# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-04-23

### Added
- Runtime patch extending `DoclingParser.HTML_FORMATS` to support `.md` and `.txt` files
- `AGENTS.md` documenting agent context and key decisions
- `CHANGELOG.md` for tracking releases

### Fixed
- Markdown and plain text documents now ingest correctly instead of throwing `ValueError: Unsupported file format`
- Constrained `mcp` dependency to `>=1.25,<2` for API stability

### Changed
- Bumped version from `0.1.0` to `0.1.1`

### Technical Details
- Docling CLI natively parses `.md` and `.txt`, but RAG-Anything v1.2.10's wrapper rejected them
- Fix routes these formats through existing `parse_html()` path via runtime monkey-patch
- Verified: `README.md` parses to 454 content blocks (397 text + 57 tables)

## [0.1.0] - 2026-04-22

### Added
- Initial release of RAG-Anything MCP server for OpenCode
- Document ingestion: PDF, DOCX, PPTX, images (PNG, JPEG, WebP, GIF)
- Natural language querying across knowledge base
- Multimodal queries with inline images, tables, equations
- Query modes: mix, hybrid, local, global, naive
- Local filesystem storage (SQLite + JSON + embeddings)
- Docling parser integration
- LightRAG graph + embedding backend
- Environment-based configuration
- Support for split LLM + embedding credentials
