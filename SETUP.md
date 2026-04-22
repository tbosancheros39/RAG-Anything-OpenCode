# RAG-Anything for OpenCode — Installation Guide

A step-by-step walkthrough to get RAG-Anything running with OpenCode.

## Prerequisites

```bash
python --version        # 3.10 or higher
pip --version          # Working pip
opencode --version    # OpenCode installed
```

If any of these fail, stop and fix before continuing.

---

## Step 1 — Create and Activate Virtual Environment

```bash
cd ~/RAG-Anything
python -m venv .venv

source .venv/bin/activate          # Linux/macOS
# .venv\Scripts\activate           # Windows
```

You should see `(.venv)` prefix in your terminal.

---

## Step 2 — Install Dependencies

```bash
pip install rag-anything-mcp
pip install docling
```

**Note**: Docling is not auto-installed with rag-anything-mcp. Must install separately.

Verify:

```bash
python -m rag_anything_mcp --help
```

If this errors, STOP. Do not proceed with a broken install.

---

## Step 3 — Create Directory Structure

```bash
mkdir -p ~/rag_storage
mkdir -p ~/rag_output
```

> ⚠️ These directories are critical. `rag_storage` holds the LightRAG knowledge graph. Treat it like a database — back it up, don't delete it between runs.

---

## Step 4 — Configure Environment Variables

Create a `.env` file in your RAG-Anything directory:

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

If you need separate credentials for embeddings (e.g., OpenCode Go API for LLM but OpenAI for embeddings):

```bash
EMBEDDING_API_KEY=sk-your-openai-key
EMBEDDING_BASE_URL=https://api.openai.com/v1
```

These default to `OPENAI_API_KEY` and `OPENAI_BASE_URL` when not set.

For other embedding providers (Jina, Gemini, local Ollama), see [CLOUD-EMBEDDINGS.md](CLOUD-EMBEDDINGS.md) and [LOCAL-EMBEDDINGS.md](LOCAL-EMBEDDINGS.md).

Add to `.gitignore`:

```
.env
rag_storage/
rag_output/
```

---

## Step 5 — Write OpenCode Config

File location: `~/.config/opencode/opencode.json` (Linux/macOS) or `%APPDATA%/opencode/opencode.json` (Windows)

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rag-anything": {
      "type": "local",
      "command": ["python", "-m", "rag_anything_mcp"],
      "environment": {
        "PATH": "/home/user/RAG-anything/.venv/bin:/usr/local/bin:/usr/bin:/bin",
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

> **Critical**: The `PATH` variable must include the venv's `bin` directory. Without it, the `docling` parser cannot verify its installation and will fail with "Parser not properly installed". Adjust the path to match your actual venv location.

> ⚠️ All values must be strings. `"4"` not `4`. OpenCode passes env vars as strings — numeric values without quotes will cause silent failures.

---

### Alternative: OpenCode Go API

If you have Go credits, use them for LLM/vision and a separate OpenAI key for embeddings:

```json
{
  "environment": {
    "OPENAI_API_KEY": "go-your-go-key",
    "OPENAI_BASE_URL": "https://opencode.ai/zen/go/v1",
    "EMBEDDING_API_KEY": "sk-your-openai-key",
    "EMBEDDING_BASE_URL": "https://api.openai.com/v1",
    "LLM_MODEL": "kimi-k2.6",
    "EMBEDDING_MODEL": "text-embedding-3-small",
    "VISION_MODEL": "kimi-k2.6"
  }
}
```

Note: Go API doesn't expose an embeddings endpoint. `EMBEDDING_API_KEY` and `EMBEDDING_BASE_URL` let you route embeddings to OpenAI separately.

---

## Step 6 — Verify Server Starts

Test it cold before OpenCode touches it:

```bash
python -m rag_anything_mcp
```

Expected: server starts and idles. No crash = good. `Ctrl+C` to stop.

---

## Step 7 — Ingest First Document

Inside OpenCode, issue this natural language command:

```
Use the rag-anything ingest_document tool to index /absolute/path/to/your/document.pdf
```

**What to expect:**

- Small PDF (< 10 pages): 30–90 seconds
- Large PDF (50+ pages): 3-5 minutes
- First run may be slower — `docling` loads its models into memory on cold start

**Do NOT kill the process during ingestion.** Partial ingestion corrupts the graph.

---

## Step 8 — Run a Test Query

```
Query the knowledge base: "What are the main topics covered in the document? Use mix mode."
```

If you get a coherent answer, the pipeline is working end-to-end.

---

## Step 9 — Batch Ingest a Folder (Optional)

```
Use the rag-anything ingest_folder tool to recursively index all PDFs and DOCX files in /absolute/path/to/your/docs/
```

> For large batches, monitor your API usage dashboard. With `RAG_LLM_MAX_ASYNC=4`, costs are controlled but ingestion takes longer.

---

## Step 10 — Check Server Health

At any point:

```
Check the RAG-Anything server status.
```

This calls `get_status` and returns config, storage info, and model assignments.

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Parser not properly installed` | 1. `pip install docling` 2. Add `PATH` env var with venv `bin` directory to config |
| `Failed to initialize LightRAG` | Check `OPENAI_API_KEY` is valid and `WORKING_DIR` is writable |
| Timeout during ingestion | Increase `timeout` to `600000` in OpenCode config |
| Empty query results | Verify ingestion completed without errors before querying |
| Knowledge graph corruption | Delete `rag_storage/` contents and re-ingest |

---

## What NOT To Do

- ❌ Do not use `mineru` unless you have a GPU — it will stall on CPU-only machines
- ❌ Do not set `RAG_LLM_MAX_ASYNC` above 8 without monitoring API rate limits
- ❌ Do not delete `rag_storage/` unless you intend to rebuild the entire knowledge graph
- ❌ Do not share the OpenCode config file — it contains your API key in plaintext
- ❌ Do not run multiple concurrent ingestion jobs against the same `WORKING_DIR`

---

## Success Criteria

The setup is complete when:

1. `python -m rag_anything_mcp` starts without errors
2. At least one document ingests successfully without timeout
3. A natural language query returns a contextually accurate answer
4. `get_status` confirms correct model and storage configuration