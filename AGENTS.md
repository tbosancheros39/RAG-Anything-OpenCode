# Agent Context

## Project
RAG-Anything for OpenCode — MCP server giving OpenCode a document knowledge base with natural language querying.

## Session Goal
Fix markdown (.md) and plain text (.txt) ingestion support and release as v0.1.1.

## What We Did

### 1. Root Cause Analysis
- Docling CLI natively supports `.md` and `.txt`
- RAG-Anything v1.2.10 has a hardcoded format check in `DoclingParser.parse_document()` that rejects these formats
- Error: `ValueError: Unsupported file format: .md`

### 2. Fix Applied
**File**: `rag-anything-mcp/rag_anything_mcp/__init__.py`
**Approach**: Runtime monkey-patch (non-invasive, survives library upgrades)

```python
DoclingParser.HTML_FORMATS = DoclingParser.HTML_FORMATS | {".md", ".txt"}
```

This routes `.md` and `.txt` through `parse_html()`, which invokes the docling CLI that natively handles these formats.

### 3. Verification
- Direct test parsed `README.md` into **454 content blocks** (397 text + 57 tables)
- Confirmed the patch activates at module import time

### 4. Version Bump
- `pyproject.toml`: `0.1.0` → `0.1.1`
- Constrained `mcp` dependency to `>=1.25,<2` for stability

## Key Decisions
- **Non-invasive fix**: Patched at runtime in MCP server rather than modifying the `raganything` library directly
- **Minimal changes**: Only extended `HTML_FORMATS`, reused existing `parse_html()` path
- **Defensive coding**: Wrapped patch in try/except to handle future library changes gracefully

## Files Changed
- `rag-anything-mcp/pyproject.toml` — version bump + dependency constraint
- `rag-anything-mcp/rag_anything_mcp/__init__.py` — runtime patch for markdown/txt support
- `AGENTS.md` — this file
- `CHANGELOG.md` — release notes
- `.gitignore` — added temp/cache files

## Environment
- Repository: `tbosancheros39/RAG-Anything-OpenCode`
- Branch: `master`
- Python: 3.10+
- Stack: Docling | LightRAG | OpenAI-compatible APIs

## Notes
- LightRAG init requires valid API keys; testing standalone may fail without them
- The MCP server is stdio-based, launched by OpenCode
- Working directory (`~/rag_storage`) is auto-created on first run
