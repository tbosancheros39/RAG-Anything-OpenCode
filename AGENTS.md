# AGENTS.md — RAG-Anything MCP Server

## What This Repo Is

An **MCP adapter** for [RAG-Anything](https://github.com/HKUDS/RAG-Anything) — a PyPI package (`raganything>=1.2.0`) that does the actual parsing (Docling) and retrieval (LightRAG). This repo only exposes those capabilities as MCP tools for OpenCode.

## Repo Layout

```
rag-anything-mcp/
  pyproject.toml              # Package manifest, version, deps, ruff config
  rag_anything_mcp/
    __init__.py               # 750 lines: ALL server logic, tools, main()
    __main__.py               # 7 lines: asyncio.run(main())
    cli_detector.py           # CLI detection utils (unused?)
    detect_cli.py             # Stub
README.md, SETUP.md, INSTRUCTIONS.md, DOCLING.md, CLOUD-EMBEDDINGS.md, LOCAL-EMBEDDINGS.md
```

**No tests directory.** No CI. No `tests/`.

## Entrypoint

```bash
cd rag-anything-mcp
python -m rag_anything_mcp          # stdio MCP server, idles until client connects
```

This is a **stdio** MCP server. It does not open a port. OpenCode (or any MCP client) launches it as a subprocess and talks over stdin/stdout.

## Critical Setup Gotchas

1. **Docling is NOT auto-installed.** Even though `PARSER=docling` is the recommended config, you must run:
   ```bash
   pip install docling
   ```
   after installing `rag-anything-mcp`. If missing, ingestion fails with `"Parser not properly installed"`.

2. **PATH must include venv `bin/` in the MCP config.** The server shells out to `docling` CLI. If `PATH` is wrong, the parser install check fails even when docling is installed.
   ```json
   "PATH": "/path/to/venv/bin:/usr/local/bin:/usr/bin:/bin"
   ```

3. **All env values in `opencode.json` must be strings.** `"4"` not `4`. Numeric literals cause silent failures because OpenCode passes env vars as strings.

4. **Working dir defaults to `./rag_storage`.** This creates persistent state in the repo root. The directory is auto-created but must be treated like a database — back it up, don't delete between runs.

5. **RAGAnything initializes lazily on first tool call**, not at server start. So `python -m rag_anything_mcp` can appear healthy even if `OPENAI_API_KEY` is missing. The failure surfaces on first `ingest_document` or `query`.

## Runtime Patch: Markdown & Plain Text

`rag_anything_mcp/__init__.py` lines ~90–96 contain a monkey-patch:

```python
DoclingParser.HTML_FORMATS = DoclingParser.HTML_FORMATS | {".md", ".txt"}
```

RAG-Anything v1.2.10 rejects `.md`/`.txt` in `parse_document()` despite Docling CLI supporting them natively. The patch routes these through `parse_html()` which invokes the CLI successfully.

**If upgrading `raganything` breaks this**, the upstream may have fixed the format check. The patch is wrapped in `try/except` so it fails gracefully.

## Developer Commands

| Task | Command |
|------|---------|
| Install dev deps | `cd rag-anything-mcp && pip install -e ".[dev]"` |
| Lint | `ruff check .` |
| Format | `ruff format .` |
| Run server cold | `python -m rag_anything_mcp` |
| Verify install | `python -m rag_anything_mcp --help` |

No test suite exists. `pytest` will collect zero tests.

## Env Vars That Actually Matter

| Var | Default | Why It Matters |
|-----|---------|----------------|
| `OPENAI_API_KEY` | — | Required. No key = LightRAG init fails on first call. |
| `OPENAI_BASE_URL` | OpenAI default | Use `https://opencode.ai/zen/go/v1` for Go API. |
| `EMBEDDING_API_KEY` | `OPENAI_API_KEY` | Go API has no embeddings endpoint; route to OpenAI separately. |
| `WORKING_DIR` | `./rag_storage` | LightRAG SQLite + JSON + embeddings live here. |
| `PARSER` | `mineru` | Set to `docling` (recommended). `mineru` requires GPU. |
| `LLM_MODEL` | `gpt-4o-mini` | kimi-k2.6 works with Go API. |
| `RAG_LLM_MAX_ASYNC` | `16` | Lower to `4` for rate-limit safety. |
| `LOG_LEVEL` | `INFO` | Set `WARNING` to reduce noise. |

## What NOT To Do

- Do not modify `raganything` library code to fix parser issues — patch in `__init__.py` instead.
- Do not set `RAG_LLM_MAX_ASYNC` above `8` without monitoring API rate limits.
- Do not delete `rag_storage/` unless you intend to rebuild the entire knowledge graph.
- Do not run multiple concurrent ingestion jobs against the same `WORKING_DIR`.

## Architecture Note

`__init__.py` defines 5 MCP tools: `ingest_document`, `ingest_folder`, `query`, `query_multimodal`, `get_status`. The `_rag` singleton is built once on first use via `_build_rag_anything()`. All OpenAI calls (LLM, embedding, vision) are thin wrappers around `openai` SDK using env-configured keys and endpoints.
