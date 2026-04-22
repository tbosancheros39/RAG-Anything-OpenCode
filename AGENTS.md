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

### All Local MCP Options

| Option | Type | Required | Description |
|--------|------|---------|-------------|
| `type` | String | Y | Must be `"local"` |
| `command` | Array | Y | Command + args to run server |
| `environment` | Object | | Env vars for server |
| `enabled` | Boolean | | Enable on startup (default true) |
| `timeout` | Number | | Startup timeout in ms |

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
| `OPENAI_API_KEY` | API key for LLM/vision | Required |
| `OPENAI_BASE_URL` | Custom endpoint for LLM/vision | OpenAI default |
| `EMBEDDING_API_KEY` | Separate API key for embeddings | Falls back to `OPENAI_API_KEY` |
| `EMBEDDING_BASE_URL` | Separate endpoint for embeddings | Falls back to `OPENAI_BASE_URL` |
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
