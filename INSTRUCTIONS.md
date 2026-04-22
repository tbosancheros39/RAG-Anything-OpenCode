# RAG-Anything MCP Setup for OpenCode

Worker agent brief for setting up a production-ready RAG-Anything MCP server.

---

## Mission

Set up a `rag-anything-mcp` server integrated with OpenCode using `docling` as the parser and OpenCode-Go models. The server must be persistent, queryable via natural language, and production-ready.

---

## Prerequisites — Verify Before Starting

```bash
python --version        # Must be >= 3.10
pip --version           # Must be available
opencode --version      # Must be installed
```

If any fail, stop and resolve before continuing.

---

## Step 1 — Create and Activate Virtual Environment

```bash
python -m venv .venv
source .venv/bin/activate          # Linux/macOS
# .venv\Scripts\activate           # Windows
```

---

## Step 2 — Install the MCP Server

```bash
pip install rag-anything-mcp
pip install docling                # Required — docling is not auto-installed
```

Verify install:

```bash
python -m rag_anything_mcp --help
```

If this errors, stop. Do not proceed with a broken install.

---

## Step 3 — Create Directory Structure

```bash
mkdir -p ~/rag_storage
mkdir -p ~/rag_output
```

> These directories are **critical infrastructure**. `rag_storage` holds the LightRAG knowledge graph. Treat it like a database — back it up, don't delete it between runs.

---

## Step 4 — Configure Environment Variables

Create a `.env` file (never commit this):

```bash
# ~/RAG-Anything/.env
OPENAI_API_KEY=sk-your-key-here
WORKING_DIR=/home/user/rag_storage
PARSER=docling
PARSE_METHOD=auto
LLM_MODEL=kimi-k2.6
EMBEDDING_MODEL=text-embedding-3-small
VISION_MODEL=kimi-k2.6
RAG_LLM_MAX_ASYNC=4
RAG_EMBED_MAX_ASYNC=8
LOG_LEVEL=WARNING
```

If using OpenCode Go API (separate credentials for embeddings):

```bash
OPENAI_API_KEY=sk-your-key-here
OPENAI_BASE_URL=https://opencode.ai/zen/go/v1
EMBEDDING_API_KEY=sk-your-openai-key
EMBEDDING_BASE_URL=https://api.openai.com/v1
LLM_MODEL=kimi-k2.6
VISION_MODEL=kimi-k2.6
# EMBEDDING_API_KEY/EMBEDDING_BASE_URL default to OPENAI_API_KEY/OPENAI_BASE_URL when not set
```

Add to `.gitignore`:
```
.env
rag_storage/
rag_output/
.venv/
```

---

## Step 5 — Write the OpenCode Config

File location: `~/.config/opencode/opencode.json` (Linux/macOS) or `%APPDATA%/opencode/opencode.json` (Windows)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rag-anything": {
      "type": "local",
      "command": ["python", "-m", "rag_anything_mcp"],
      "environment": {
        "OPENAI_API_KEY": "sk-your-key-here",
        "WORKING_DIR": "/home/user/rag_storage",
        "PARSER": "docling",
        "PARSE_METHOD": "auto",
        "LLM_MODEL": "kimi-k2.6",
        "EMBEDDING_MODEL": "text-embedding-3-small",
        "VISION_MODEL": "kimi-k2.6",
        "RAG_LLM_MAX_ASYNC": "4",
        "RAG_EMBED_MAX_ASYNC": "8",
        "LOG_LEVEL": "WARNING"
      },
      "enabled": true,
      "timeout": 300000
    }
  }
}
```

> All values must be strings. `"4"` not `4`. OpenCode passes env vars as strings — numeric values without quotes will cause silent failures.

---

## Step 6 — Verify Server Starts

Test it cold before OpenCode touches it:

```bash
python -m rag_anything_mcp
```

Expected: server starts and idles. No crash = good. `Ctrl+C` to stop.

---

## Step 7 — Ingest Your First Document

Inside OpenCode, issue this natural language command:

```
Use the rag-anything ingest_document tool to index /absolute/path/to/your/document.pdf
```

- Small PDF (< 10 pages): 30–90 seconds
- Large PDF (50+ pages): 3–5 minutes
- First run may be slower — `docling` loads its models into memory on cold start

**Do NOT kill the process during ingestion.** Partial ingestion corrupts the graph.

---

## Step 8 — Run a Test Query

```
Use the rag-anything query tool to ask: "What are the main topics covered in the document?" Use mix mode.
```

If you get a coherent answer, the pipeline is working end-to-end.

---

## Step 9 — Multimodal Query (Optional)

```
Use the rag-anything query_multimodal tool to analyze /path/to/diagram.png with question: "Explain this architecture."
```

Use when your query involves diagrams, tables, or equations alongside text context.

---

## Step 10 — Check Server Health

```
Check the RAG-Anything server status.
```

This calls `get_status` and returns config, storage info, and model assignments.

---

## Query Mode Reference

| Mode | Use When |
|------|----------|
| `mix` | Default. Cross-document reasoning, broad questions |
| `hybrid` | Precision queries needing re-ranking |
| `local` | Questions about specific entities or relationships |
| `global` | Semantic similarity, "find documents about X" |
| `naive` | Simple chunk lookup, debugging |

---

## Failure Recovery

| Error | Fix |
|-------|-----|
| `Parser not properly installed` | `pip install docling` |
| `Failed to initialize LightRAG` | Check `OPENAI_API_KEY` is valid and `WORKING_DIR` is writable |
| Timeout during ingestion | Increase `timeout` to `600000` in OpenCode config |
| Empty query results | Verify ingestion completed without errors before querying |
| Knowledge graph corruption | Delete `rag_storage/` contents and re-ingest |

---

## What NOT To Do

- Do not use `mineru` unless you have a GPU — it will stall on CPU-only machines
- Do not set `RAG_LLM_MAX_ASYNC` above 8 without monitoring API rate limits
- Do not delete `rag_storage/` unless you intend to rebuild the entire knowledge graph
- Do not share the OpenCode config file — it contains your API key in plaintext
- Do not run multiple concurrent ingestion jobs against the same `WORKING_DIR`

---

## Success Criteria

The setup is complete when:

1. `python -m rag_anything_mcp` starts without errors
2. At least one document ingests successfully without timeout
3. A natural language query returns a contextually accurate answer
4. `get_status` confirms correct model and storage configuration