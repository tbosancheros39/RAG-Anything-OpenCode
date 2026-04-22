# RAG-Anything MCP Server

A production-ready [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that exposes [RAG-Anything](https://github.com/HKUDS/RAG-Anything)'s document ingestion and multimodal retrieval capabilities as tools for **OpenCode** and other MCP-compatible clients.

## Features

| Tool | Description |
|------|-------------|
| `ingest_document` | Index a single PDF, DOCX, PPTX, TXT, or MD file into the knowledge base |
| `ingest_folder` | Batch index an entire directory tree of documents |
| `query` | Natural language RAG query with hybrid/graph/vector retrieval modes |
| `query_multimodal` | Query with inline images, tables, or equations for multimodal analysis |
| `get_status` | Check server health, configuration, and storage status |

## Quick Start

### 1. Install

```bash
# Create a virtual environment (recommended)
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install the MCP server
pip install rag-anything-mcp
```

Or install directly from the repository:

```bash
pip install git+https://github.com/HKUDS/RAG-Anything.git#subdirectory=mcp-server
```

### 2. Configure for OpenCode

Add to your OpenCode configuration file (`~/.config/opencode/opencode.json` or `~/.opencode/opencode.json`):

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
        "LLM_MODEL": "gpt-4o-mini",
        "EMBEDDING_MODEL": "text-embedding-3-small"
      },
      "enabled": true,
      "timeout": 300000
    }
  }
}
```

> **Note on timeout**: Document ingestion can take several minutes for large PDFs. The default 5-second MCP timeout is too short. Set `timeout` to at least `300000` (5 minutes) or more.

### 3. Use in OpenCode

Once configured, OpenCode can automatically call RAG-Anything tools:

```
Please ingest the PDF at /home/user/research/paper.pdf and then
query it for the methodology section findings.
```

Or explicitly reference the tool:

```
Use the rag-anything ingest_document tool to index /home/user/docs/
then query about "What are the key security vulnerabilities mentioned?"
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | *(required)* | OpenAI API key for LLM, embeddings, and vision |
| `OPENAI_BASE_URL` | *(OpenAI default)* | Custom OpenAI-compatible base URL (e.g., for Azure, local proxies) |
| `EMBEDDING_API_KEY` | *(falls back to OPENAI_API_KEY)* | Separate API key for embeddings |
| `EMBEDDING_BASE_URL` | *(falls back to OPENAI_BASE_URL)* | Separate base URL for embeddings |
| `LLM_MODEL` | `gpt-4o-mini` | LLM model for text generation and table/equation analysis |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Model for text embeddings |
| `VISION_MODEL` | `gpt-4o` | Vision model for image analysis in VLM-enhanced queries |
| `WORKING_DIR` | `./rag_storage` | Directory where LightRAG persists the knowledge graph |
| `PARSER` | `mineru` | Document parser: `mineru`, `docling`, or `paddleocr` |
| `PARSE_METHOD` | `auto` | Parsing strategy: `auto`, `ocr`, or `txt` |
| `RAG_LLM_MAX_ASYNC` | `16` | Max concurrent LLM calls |
| `RAG_EMBED_MAX_ASYNC` | `16` | Max concurrent embedding calls |
| `LOG_LEVEL` | `INFO` | Server logging level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |

### Parser Selection

| Parser | Best For | GPU Required | Notes |
|--------|----------|--------------|-------|
| `docling` | General documents | No | Lightweight, fast, good default choice |
| `mineru` | Complex PDFs with equations/tables | Yes (recommended) | Best accuracy for academic papers |
| `paddleocr` | OCR-heavy documents | Optional | Good for scanned documents |

### Using Local Models (Ollama, vLLM, etc.)

To avoid API costs and latency, you can use local models via an OpenAI-compatible endpoint:

```json
{
  "mcp": {
    "rag-anything": {
      "type": "local",
      "command": ["python", "-m", "rag_anything_mcp"],
      "environment": {
        "OPENAI_API_KEY": "sk-no-key-needed",
        "OPENAI_BASE_URL": "http://localhost:11434/v1",
        "LLM_MODEL": "qwen2.5:14b",
        "EMBEDDING_MODEL": "nomic-embed-text",
        "VISION_MODEL": "llava:13b",
        "PARSER": "docling"
      },
      "enabled": true,
      "timeout": 300000
    }
  }
}
```

Make sure Ollama has the models pulled:

```bash
ollama pull qwen2.5:14b
ollama pull nomic-embed-text
ollama pull llava:13b
```

## Tool Reference

### `ingest_document`

Index a single document into the RAG knowledge base.

**Parameters:**
- `file_path` (string, required): Absolute path to the document
- `output_dir` (string, optional): Directory for parser artifacts (default: `./rag_output`)

**Example usage in OpenCode:**
```
Ingest the document at /home/user/report.pdf into the knowledge base.
```

### `ingest_folder`

Batch index all supported documents in a folder.

**Parameters:**
- `folder_path` (string, required): Absolute path to the folder
- `output_dir` (string, optional): Directory for parser artifacts (default: `./rag_output`)
- `recursive` (boolean, optional): Process subdirectories (default: `true`)
- `file_extensions` (string[], optional): File types to process (default: `[".pdf", ".docx", ".pptx", ".txt", ".md", ".html"]`)

**Example usage in OpenCode:**
```
Ingest all PDFs and DOCX files in /home/user/project-docs/ recursively.
```

### `query`

Query the indexed knowledge base with natural language.

**Parameters:**
- `question` (string, required): The query text
- `mode` (string, optional): Retrieval strategy
  - `mix` - Combined graph + vector (default)
  - `hybrid` - Graph and vector with re-ranking
  - `local` - Graph neighborhood only
  - `global` - Vector similarity only
  - `naive` - Simple chunk retrieval
- `vlm_enhanced` (boolean, optional): Have the vision model analyze images in retrieved context (default: `false`)

**Example usage in OpenCode:**
```
Query the knowledge base: "What are the main security findings in the
CVE reports?" Use hybrid mode with VLM enhancement.
```

### `query_multimodal`

Query with inline multimodal content (images, tables, equations).

**Parameters:**
- `question` (string, required): The query text
- `multimodal_content` (array, optional): List of content items, each with:
  - `type`: `"image"`, `"table"`, or `"equation"`
  - `img_path`: Path to image file (for images)
  - `table_data`: CSV or markdown table content (for tables)
  - `latex`: LaTeX string (for equations)
- `mode` (string, optional): Same as `query` mode (default: `mix`)

**Example usage in OpenCode:**
```
Query the knowledge base about "Explain this architecture diagram"
with the image at /home/user/diagram.png.
```

### `get_status`

Check server status and configuration. Takes no parameters.

**Example usage in OpenCode:**
```
Check the RAG-Anything server status.
```

## Advanced: Custom Model Functions

For complete control over LLM/embedding/vision providers, you can subclass or wrap the server. The `_openai_*_func` functions in the source are the default implementations; replace them by editing `rag_anything_mcp.py` or setting environment variables to point to your own OpenAI-compatible endpoints.

### Azure OpenAI Example

```json
{
  "mcp": {
    "rag-anything": {
      "environment": {
        "OPENAI_API_KEY": "your-azure-key",
        "OPENAI_BASE_URL": "https://your-resource.openai.azure.com/openai/deployments/your-deployment",
        "LLM_MODEL": "gpt-4o",
        "EMBEDDING_MODEL": "text-embedding-3-small"
      }
    }
  }
}
```

## Troubleshooting

### "Parser not properly installed"

Install the desired parser:

```bash
# For docling (recommended for CPU-only machines)
pip install docling

# For MinerU (best quality, needs GPU)
pip install magic-pdf[full]
```

### "Failed to initialize LightRAG"

- Verify `OPENAI_API_KEY` is set and valid
- Check that the embedding model name is correct
- Ensure `WORKING_DIR` is writable

### Timeouts during ingestion

Increase the `timeout` value in your OpenCode MCP config:

```json
{
  "mcp": {
    "rag-anything": {
      "timeout": 600000
    }
  }
}
```

### Large model downloads on first run

MinerU downloads ~2GB of models on first use. This is one-time per machine. To pre-download:

```bash
python -c "from raganything.parser import MineruParser; MineruParser()"
```

## Development

```bash
git clone https://github.com/HKUDS/RAG-Anything.git
cd RAG-Anything/mcp-server
python -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"

# Run the server directly for testing
python -m rag_anything_mcp

# Lint
ruff check .

# Type check
mypy rag_anything_mcp.py
```

## Architecture

```
OpenCode / MCP Client
        |
        | stdio (JSON-RPC)
        v
  rag-anything-mcp
        |
        | Python API calls
        v
   RAGAnything
        |
    +---+---+
    |       |
 LightRAG  Processors
    |
+--+---+--+
|  |   |  |
KG Vector Image Table Equation
```

The server stays alive as a persistent process. RAG-Anything's LightRAG graph storage persists across restarts in `WORKING_DIR`, so documents only need to be ingested once.

## License

MIT - same as RAG-Anything.
