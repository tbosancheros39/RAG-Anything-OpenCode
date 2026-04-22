# RAG-Anything for OpenCode

MCP server that gives OpenCode a persistent knowledge base. Index docs, query in natural language.

**Stack**: Python 3.10+ | Docling | LightRAG | OpenAI APIs

---

## MCP Config (opencode.json)

From https://opencode.ai/docs/mcp-servers — local MCP with `type: "local"`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rag-anything": {
      "type": "local",
      "command": ["python", "-m", "rag_anything_mcp"],
      "enabled": true,
      "environment": {
        "PATH": "/home/user/RAG-anything/.venv/bin:/usr/local/bin:/usr/bin:/bin",
        "OPENAI_API_KEY": "sk-your-key",
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
      "timeout": 300000
    }
  }
}
```

> **Critical**: The `PATH` variable must include your venv's `bin` directory. The parser checks for `docling` CLI via subprocess and will fail with "Parser not properly installed" if it's not in PATH. Adjust to your actual venv location.

### All Local MCP Options

| Option | Type | Required | Description |
|--------|------|---------|-------------|
| `type` | String | Y | Must be `"local"` |
| `command` | Array | Y | Command + args to run server |
| `environment` | Object | | Env vars for server |
| `enabled` | Boolean | | Enable on startup (default true) |
| `timeout` | Number | | Startup timeout in ms |

---

## Query Modes Reference

| Mode | Best For | How It Works |
|------|----------|--------------|
| `mix` | **Default** — most queries | Auto-balances local entity search + global semantic search |
| `hybrid` | Precision queries | Local graph + vector search with re-ranking |
| `local` | Specific facts, entities | Searches entity/relation graph only — fast, targeted |
| `global` | Broad summaries, themes | Traverses full knowledge graph — slower, comprehensive |
| `naive` | Debugging, simple lookup | Chunk vector search only, no graph reasoning |

**Usage in prompts**: Add "Use [mode] mode" to your query. Example: *"What did we decide about pricing? Use hybrid mode."*

---

## Preloaded Agent Prompts

### Prompt A: Ingest Document

```
Use the rag-anything ingest_document tool to index /absolute/path/to/document.pdf
```

**What it does:** Parses PDF/DOCX/PPTX with Docling, stores chunks + embeddings in LightRAG.

**Timing:**
- < 10 pages: 30-90 sec
- 50+ pages: 3-5 min

**Do:** Wait for completion. Partial ingestion corrupts the graph.

---

### Prompt B: Ingest Folder

```
Use the rag-anything ingest_folder tool to recursively index all PDFs and DOCX in /path/to/folder/
```

---

### Prompt C: Query Knowledge Base

```
Use the rag-anything query tool to ask: "What does the doc say about [topic]?" Use mix mode.
```

**Modes:** mix (default), hybrid, local, global, naive

---

### Prompt D: Multimodal Query

```
Use the rag-anything query_multimodal tool to analyze the image at /path/to/diagram.png with the question: "Explain this architecture."
```

**Use when:** Query involves diagrams, tables, or equations alongside text context.

---

### Prompt E: Check Status

```
Check the RAG-Anything server status.
```

---

### Prompt F: Full Pipeline

```
1. Use rag-anything ingest_document to index /path/to/report.pdf
2. Wait for completion
3. Use rag-anything query to ask: "What are the key findings?" Use hybrid mode.
```

---

## Directory Structure

```
rag-anything/
├── .venv/              # Virtual env
├── rag_storage/       # LightRAG (treat like DB)
├── rag_output/        # Processing output
├── rag-anything-mcp/ # MCP package
└── AGENTS.md         # This file
```

---

## MCP Tools Available

| Tool | Purpose |
|------|---------|
| `ingest_document` | Index single file |
| `ingest_folder` | Batch index directory |
| `query` | Natural language search |
| `query_multimodal` | Query with images/tables/equations |
| `get_status` | Server health check |

---

## Env Vars

| Variable | Purpose | Default |
|----------|---------|---------|
| `PATH` | System PATH with venv bin | **Required** — must include venv `bin` directory |
| `OPENAI_API_KEY` | API key for LLM/vision | Required |
| `OPENAI_BASE_URL` | Custom endpoint for LLM/vision | OpenAI default |
| `EMBEDDING_API_KEY` | Separate API key for embeddings | Falls back to `OPENAI_API_KEY` |
| `EMBEDDING_BASE_URL` | Separate endpoint for embeddings | Falls back to `OPENAI_BASE_URL` |

### Embedding Provider Examples

**OpenAI (default):**
```json
"EMBEDDING_MODEL": "text-embedding-3-small",
"EMBEDDING_API_KEY": "sk-...",
"EMBEDDING_BASE_URL": "https://api.openai.com/v1"
```

**Jina (recommended cloud):**
```json
"EMBEDDING_MODEL": "jina-embeddings-v5-text-small",
"EMBEDDING_API_KEY": "jina_...",
"EMBEDDING_BASE_URL": "https://api.jina.ai/v1"
```

**Ollama (local, free):**
```json
"EMBEDDING_MODEL": "nomic-embed-text",
"EMBEDDING_API_KEY": "ollama",
"EMBEDDING_BASE_URL": "http://localhost:11434/v1"
```

**Gemini (needs proxy adapter):**
```json
"EMBEDDING_MODEL": "gemini/gemini-embedding-001",
"EMBEDDING_API_KEY": "YOUR_GEMINI_KEY",
"EMBEDDING_BASE_URL": "http://localhost:4000/v1"
```

See [CLOUD-EMBEDDINGS.md](CLOUD-EMBEDDINGS.md) for full details and [LOCAL-EMBEDDINGS.md](LOCAL-EMBEDDINGS.md) for Ollama setup.

| `WORKING_DIR` | Storage path | `rag_storage/` |
| `PARSER` | Parser | `docling` |
| `PARSE_METHOD` | Parse strategy | `auto` |
| `LLM_MODEL` | Chat model | `kimi-k2.6` |
| `EMBEDDING_MODEL` | Embeddings | `text-embedding-3-small` |
| `VISION_MODEL` | Vision model | `kimi-k2.6` |
| `RAG_LLM_MAX_ASYNC` | Max concurrent LLM calls | `4` |
| `RAG_EMBED_MAX_ASYNC` | Max concurrent embed calls | `8` |
| `LOG_LEVEL` | Logging level | `WARNING` |

---

## Troubleshooting

| Error | Fix |
|-------|-----|
| No such tool | Restart OpenCode to load MCP |
| Timeout | Increase timeout to `600000` |
| Empty results | Re-ingest document |
| Corruption | Clear rag_storage/ + re-ingest |
| Mode not recognized | Use lowercase: mix, hybrid, local, global, naive |
| `Parser not properly installed` | Add `PATH` to environment with venv `bin` directory. See MCP Config section. |

---

## Annotated Configuration Example

Full production config for `~/.config/opencode/opencode.json` with inline documentation:

```json
{
  "rag-anything": {
    "type": "local",
    "command": [
      "/PATH-TO/RAG-anything/.venv/bin/python",
      "-m",
      "rag_anything_mcp"
    ],
    "environment": {
      "PATH": "/PATH-TO/RAG-anything/.venv/bin:/usr/local/bin:/usr/bin:/bin",
      "OPENAI_API_KEY": "YOUR-API-KEY",
      "OPENAI_BASE_URL": "https://opencode.ai/zen/go/v1",
      "WORKING_DIR": "/PATH-TO/RAG-anything/rag_storage",
      "PARSER": "docling",
      "PARSE_METHOD": "auto",
      "LLM_MODEL": "kimi-k2.5",
      "EMBEDDING_MODEL": "text-embedding-3-small",
      "VISION_MODEL": "kimi-k2.5",
      "RAG_LLM_MAX_ASYNC": "4",
      "RAG_EMBED_MAX_ASYNC": "8",
      "LOG_LEVEL": "WARNING"
    },
    "enabled": false,
    "timeout": 300000
  }
}
```

### Parameter Reference

| Parameter | Value | Description |
|-----------|-------|-------------|
| `command` | Absolute path to venv Python | Use full path to avoid "module not found" errors. Change `PATH-TO` to your actual path. |
| `PATH` | `/PATH-TO/venv/bin:...` | **Required.** Must include venv `bin` directory so the parser can find `docling` CLI. Failure results in "Parser not properly installed" error. |
| `OPENAI_API_KEY` | `YOUR-API-KEY` | Replace with your actual API key. Never commit this file. |
| `OPENAI_BASE_URL` | `https://opencode.ai/zen/go/v1` | OpenCode Go API endpoint. Provides LLM + vision, but not embeddings. |
| `WORKING_DIR` | `/PATH-TO/RAG-anything/rag_storage` | Absolute path to storage directory. Must exist. Treat like a database. |
| `PARSER` | `docling` | **CPU-only** document parser. No GPU required. Supports PDF, DOCX, PPTX, images. Alternatives: `mineru` (GPU required, higher accuracy), `paddleocr` (scanned docs only). |
| `PARSE_METHOD` | `auto` | Auto-selects text extraction vs OCR per document. Use `txt` for digital-only (faster), `ocr` for scanned-only. |
| `LLM_MODEL` | `kimi-k2.5` | Primary model for graph construction and text generation. Via OpenCode Go `/chat/completions`. |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model. With Go API, you may need separate embedding credentials (see Split LLM section). |
| `VISION_MODEL` | `kimi-k2.5` | Handles image analysis in multimodal queries. Same model as LLM — single endpoint. |
| `RAG_LLM_MAX_ASYNC` | `4` | Concurrent LLM calls during ingestion. Default (16) hits rate limits. Increase only if provider allows. |
| `RAG_EMBED_MAX_ASYNC` | `8` | Embedding calls are cheaper than LLM. Higher concurrency improves throughput. Tune to provider limits. |
| `LOG_LEVEL` | `WARNING` | Suppresses INFO noise during ingestion. Set to `DEBUG` for troubleshooting. |
| `enabled` | `false` | Set to `true` after verifying config. Prevents OpenCode from crashing on bad configs at startup. |
| `timeout` | `300000` | 5 minute startup timeout. Increase to `600000` if indexing large documents. |

**Critical**: Replace all `PATH-TO` and `YOUR-API-KEY` placeholders before enabling.
