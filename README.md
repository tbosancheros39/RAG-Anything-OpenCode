# RAG-Anything for OpenCode

A production-ready MCP server that gives OpenCode a document knowledge base with natural language querying. Index PDFs, DOCX, PPTX, images. Query across all of it with simple questions.

**Stack**: Python 3.10+ | Docling | LightRAG | OpenAI-compatible APIs

## What It Does

```
You: "What did we discuss about the API design?"
OpenCode: [searches your indexed documents]
         "Based on the architecture doc from March — the API uses 
         REST endpoints with WebSocket for real-time updates..."
```

- **Ingest**: PDF, DOCX, PPTX, images (PNG, JPEG, WebP, GIF)
- **Query**: Natural language across your entire knowledge base
- **Multimodal**: Query with inline images, tables, equations
- **Modes**: mix, hybrid, local, global, naive
- **Storage**: Local filesystem (SQLite + JSON + embeddings)

## Quick Start

### 1. Install

```bash
python -m venv .venv
source .venv/bin/activate

pip install rag-anything-mcp
pip install docling
```

### 2. Create Storage Directories

```bash
mkdir -p ~/rag_storage
mkdir -p ~/rag_output
```

### 3. Configure OpenCode

Add to `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rag-anything": {
      "type": "local",
      "command": ["python", "-m", "rag_anything_mcp"],
      "environment": {
        "OPENAI_API_KEY": "sk-...",
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

### Split LLM + Embeddings (Recommended with OpenCode Go)

OpenCode's Go API provides LLM and vision but not embeddings. Use separate credentials for embeddings:

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

`EMBEDDING_API_KEY` and `EMBEDDING_BASE_URL` are optional — they default to `OPENAI_API_KEY` and `OPENAI_BASE_URL` when not set. This lets you route embeddings to a different provider (e.g., local Ollama) while keeping LLM/vision on your primary API.

For running embeddings locally with Ollama (free, zero API cost), see [LOCAL-EMBEDDINGS.md](LOCAL-EMBEDDINGS.md).

## Requirements Met

- [ ] Python 3.10+ installed
- [ ] `pip install rag-anything-mcp docling` succeeds
- [ ] Storage directories created
- [ ] OpenCode config updated with MCP entry
- [ ] Server starts without errors (`python -m rag_anything_mcp`)
- [ ] At least one document indexed
- [ ] Query returns relevant results