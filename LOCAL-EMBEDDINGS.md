# Local Embeddings with Ollama

Run embeddings locally via Ollama. Zero API cost, zero external dependency for the embedding pipeline. LLM and vision still use your primary API.

---

## Architecture

```
OpenCode
    │
    ├── rag-anything MCP server
    │       │
    │       ├── LLM calls ──────→ Your primary API (kimi-k2.6, gpt-4o-mini, etc.)
    │       ├── Vision calls ───→ Your primary API
    │       └── Embedding calls → Ollama localhost:11434 (nomic-embed-text)
    │
    └── Ollama (GPU accelerated, ~274MB VRAM)
```

Embedding models need 274MB–2.2GB VRAM. Any GPU with 2GB+ VRAM works.

---

## Step 1 — Install Ollama

### Option A: System-wide (requires sudo)

```bash
curl -fsSL https://ollama.com/install.sh | sh
```

### Option B: Install to a custom location (no sudo needed)

If you want Ollama on a secondary drive or don't have sudo:

```bash
# Download the Linux binary
mkdir -p ~/ollama/bin
curl -L https://ollama.com/download/ollama-linux-amd64 -o ~/ollama/bin/ollama
chmod +x ~/ollama/bin/ollama

# Create directory for models
mkdir -p ~/ollama/models

# Set environment to use custom location
export OLLAMA_MODELS=~/ollama/models
export PATH="$HOME/ollama/bin:$PATH"

# Start Ollama in background
ollama serve &

# Verify
ollama --version
```

To make it persistent, add to `~/.bashrc`:

```bash
export OLLAMA_MODELS=$HOME/ollama/models
export PATH="$HOME/ollama/bin:$PATH"
```

And create a systemd user service at `~/.config/systemd/user/ollama.service`:

```ini
[Unit]
Description=Ollama Service
After=network.target

[Service]
Environment=OLLAMA_MODELS=%h/ollama/models
ExecStart=%h/ollama/bin/ollama serve
Restart=always

[Install]
WantedBy=default.target
```

Then enable it:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ollama
```

---

## Step 2 — Pull the Embedding Model

**Recommended: nomic-embed-text** — best balance of quality and VRAM (274MB):

```bash
ollama pull nomic-embed-text
```

Alternative models if you want to experiment:

| Model | Pull Command | VRAM | Quality | Notes |
|-------|-------------|------|---------|-------|
| nomic-embed-text | `ollama pull nomic-embed-text` | 274MB | Good | Fast, low VRAM |
| mxbai-embed-large | `ollama pull mxbai-embed-large` | 670MB | Better | Good quality/speed tradeoff |
| bge-m3 | `ollama pull bge-m3` | 2.2GB | Best multilingual | Worth it for non-English docs |

Only pull one. Start with `nomic-embed-text`.

---

## Step 3 — Test Ollama Embeddings

```bash
curl http://localhost:11434/v1/embeddings \
  -d '{"model":"nomic-embed-text","input":"test embedding"}' \
  -H "Content-Type: application/json"
```

Expected: a JSON object with an `embedding` array of 768 floats. If you see this, Ollama is serving embeddings correctly.

---

## Step 4 — Update OpenCode Config

Edit `~/.config/opencode/opencode.json`. Add `EMBEDDING_API_KEY` and `EMBEDDING_BASE_URL` to route embeddings to Ollama:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rag-anything": {
      "type": "local",
      "command": ["python", "-m", "rag_anything_mcp"],
      "environment": {
        "PATH": "/home/user/RAG-anything/.venv/bin:/usr/local/bin:/usr/bin:/bin",
        "OPENAI_API_KEY": "your-api-key",
        "OPENAI_BASE_URL": "https://opencode.ai/zen/go/v1",
        "EMBEDDING_API_KEY": "ollama",
        "EMBEDDING_BASE_URL": "http://localhost:11434/v1",
        "WORKING_DIR": "/home/user/rag_storage",
        "PARSER": "docling",
        "PARSE_METHOD": "auto",
        "LLM_MODEL": "kimi-k2.6",
        "EMBEDDING_MODEL": "nomic-embed-text",
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

> **Critical**: The `PATH` variable must include your venv's `bin` directory. Without it, the `docling` parser cannot verify its installation and will fail with "Parser not properly installed".

Key changes:
- `EMBEDDING_API_KEY`: `"ollama"` — Ollama doesn't require a real key, but the OpenAI client needs something non-empty
- `EMBEDDING_BASE_URL`: `"http://localhost:11434/v1"` — routes embedding calls to local Ollama
- `EMBEDDING_MODEL`: `"nomic-embed-text"` — must match the model you pulled

---

## Step 5 — Restart OpenCode

Restart the OpenCode session so it picks up the new config, then test:

```
Check the RAG-Anything server status.
```

The status output should show `nomic-embed-text` as the embedding model.

---

## Step 6 — Verify End-to-End

Ingest a document and confirm embeddings are running locally:

```
Use the rag-anything ingest_document tool to index /path/to/test.pdf
```

Watch the Ollama logs during ingestion:

```bash
# If installed system-wide
journalctl -u ollama -f

# If running manually
# Check the terminal where ollama serve is running
```

You should see `nomic-embed-text` inference requests hitting Ollama. LLM calls (entity extraction, graph building) still go to your primary API.

---

## Switching Embedding Models

If you want to upgrade quality later:

```bash
# Pull the better model
ollama pull mxbai-embed-large
```

Update `opencode.json`:
```json
"EMBEDDING_MODEL": "mxbai-embed-large"
```

Restart OpenCode.

**Important:** Changing embedding models requires re-ingesting all documents. Different models produce incompatible vectors. Clear `rag_storage/` and re-index.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Connection refused` on embeddings | Ollama not running — start it with `ollama serve` or `systemctl start ollama` |
| `model not found` error | Run `ollama pull nomic-embed-text` |
| Slow embeddings on first run | Model loads into VRAM on first call (1-2 sec), subsequent calls are fast |
| Mixed vectors after model change | Delete `rag_storage/` contents and re-ingest all documents |
| Ollama using CPU instead of GPU | Run `nvidia-smi` to verify driver. Ollama auto-detects CUDA. Check `ollama ps` shows GPU. |

---

## Cost Comparison

| Setup | Embedding Cost | LLM Cost | Total (100 docs) |
|-------|---------------|----------|-------------------|
| All OpenAI | ~$0.15 | ~$0.50 | ~$0.65 |
| Primary API + OpenAI embed | ~$0.15 | API credits | API + $0.15 |
| **Primary API + Ollama local** | **$0** | API credits | **API credits only** |

Ollama embeddings are free forever. No API key, no rate limits, no per-token cost.