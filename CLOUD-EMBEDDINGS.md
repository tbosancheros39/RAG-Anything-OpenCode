# Cloud Embedding Providers

Use a cloud API for embeddings instead of local Ollama. Higher quality, no local GPU needed, but costs per token.

---

## Quick Comparison

| Provider | Model | Dimensions | Context | Free Tier | Cost/1M tokens |
|----------|-------|-----------|---------|-----------|-----------------|
| **OpenAI** | text-embedding-3-small | 1536 (truncatable to 512) | 8K | No free tier | $0.02 |
| **OpenAI** | text-embedding-3-large | 3072 (truncatable to 256) | 8K | No free tier | $0.13 |
| **Jina** | jina-embeddings-v5-text-small | 1024 (Matryoshka 32-1024) | 32K | 100K tokens/min | Pay-per-token |
| **Jina** | jina-embeddings-v5-text-nano | 768 (Matryoshka 32-768) | 8K | 100K tokens/min | Pay-per-token |
| **Jina** | jina-embeddings-v4 | 1024 | 8K | 100K tokens/min | Pay-per-token |
| **Google** | gemini-embedding-001 | 768-3072 (MRL) | 2K | 1M tokens/month | ~$0.10 |
| **Google** | gemini-embedding-2-preview | 768-3072 (MRL) | 8K | 1M tokens/month | ~$0.10 |
| **Ollama** | nomic-embed-text | 768 | 8K | Unlimited (local) | Free |
| **Ollama** | mxbai-embed-large | 1024 | 8K | Unlimited (local) | Free |

For RAG-Anything, any OpenAI-compatible embedding endpoint works. Jina and Ollama are drop-in compatible. **Gemini is NOT OpenAI-compatible** — it requires its own REST format.

---

## Jina Embeddings (Recommended Cloud)

Best quality-to-cost ratio. OpenAI-compatible API. Free tier available.

### Step 1 — Get an API Key

1. Go to [jina.ai/embeddings](https://jina.ai/embeddings/)
2. Click "Get API Key"
3. Copy the key (starts with `jina_`)

Free tier: 100 RPM, 100K tokens/minute. No credit card required.

### Step 2 — Configure RAG-Anything

```json
{
  "environment": {
    "OPENAI_API_KEY": "your-llm-api-key",
    "OPENAI_BASE_URL": "https://opencode.ai/zen/go/v1",
    "EMBEDDING_API_KEY": "jina_YOUR_KEY",
    "EMBEDDING_BASE_URL": "https://api.jina.ai/v1",
    "LLM_MODEL": "kimi-k2.6",
    "EMBEDDING_MODEL": "jina-embeddings-v5-text-small",
    "VISION_MODEL": "kimi-k2.6"
  }
}
```

### Step 3 — Test

```bash
curl https://api.jina.ai/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer jina_YOUR_KEY" \
  -d '{
    "model": "jina-embeddings-v5-text-small",
    "input": ["test embedding"],
    "task": "retrieval.query",
    "dimensions": 1024,
    "normalized": true
  }'
```

Expected: JSON with `data[0].embedding` array of 1024 floats.

### Jina Models

| Model | Dimensions | Context | Best For |
|-------|-----------|---------|----------|
| `jina-embeddings-v5-text-small` | 1024 (Matryoshka 32-1024) | 32K | Best quality, multilingual RAG |
| `jina-embeddings-v5-text-nano` | 768 (Matryoshka 32-768) | 8K | Fast, low-memory, good quality |
| `jina-embeddings-v4` | 1024 | 8K | Multimodal (text + images) |
| `jina-embeddings-v3-base-zh` | 1024 | 8K | Chinese-heavy documents |

### Jina Task Types

For `v5-text` models, prepend task prefixes to input text for best results:

| Task | Query Prefix | Document Prefix |
|------|-------------|-----------------|
| Search | `task: search result \| query: {text}` | `title: {title} \| text: {text}` |
| QA | `task: question answering \| query: {text}` | `title: {title} \| text: {text}` |
| Classification | `task: classification \| query: {text}` | Same |
| Clustering | `task: clustering \| query: {text}` | Same |

For `v3` and `v4` models, use the `task` parameter in the request body.

### Rate Limits

| Tier | RPM | TPM |
|------|-----|-----|
| Free (no key) | Blocked | Blocked |
| Free API Key | 100 | 100K |
| Paid | 500 | 2M |
| Premium | 5,000 | 50M |

### Cost Estimate for RAG

A typical 100-page document ingested into RAG-Anything generates ~50K-100K embedding tokens. With Jina's pay-per-token model:

- 100 documents: ~5-10M tokens ≈ $0.50-1.00
- 1,000 documents: ~50-100M tokens ≈ $5-10

---

## Google Gemini Embeddings

Best free tier (1M tokens/month). **Not OpenAI-compatible** — requires custom integration or a proxy adapter.

### Limitation

Gemini uses a proprietary REST API format, not the OpenAI `/v1/embeddings` format that RAG-Anything expects. To use Gemini embeddings with RAG-Anything, you need an OpenAI-compatible proxy/wrapper endpoint that translates between formats.

Options:
1. **LiteLLM proxy** — translates OpenAI format to Gemini format
2. **Custom adapter** — small Flask/FastAPI server
3. Wait for RAG-Anything to add native Gemini support

### Direct API (without proxy)

```bash
curl -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent" \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: YOUR_GEMINI_KEY" \
  -d '{
    "model": "models/gemini-embedding-001",
    "content": {
      "parts": [{"text": "test embedding"}]
    },
    "taskType": "RETRIEVAL_DOCUMENT"
  }'
```

### Gemini Models

| Model | Dimensions (MRL) | Context | Input Types |
|-------|------------------|---------|-------------|
| `gemini-embedding-001` | 768, 1536, 3072 | 2,048 tokens | Text only |
| `gemini-embedding-2-preview` | 768, 1536, 3072 | 8,192 tokens | Text, images, video, audio, PDF |

### Gemini Task Types

| Task Type | Use For |
|-----------|---------|
| `RETRIEVAL_QUERY` | Search queries |
| `RETRIEVAL_DOCUMENT` | Document indexing (use for ingestion) |
| `SEMANTIC_SIMILARITY` | Comparing text similarity |
| `CLASSIFICATION` | Text classification |
| `CLUSTERING` | Clustering |
| `QUESTION_ANSWERING` | QA queries |
| `FACT_VERIFICATION` | Fact-checking |
| `CODE_RETRIEVAL_QUERY` | Code search |

### Using with LiteLLM Proxy

If you want to use Gemini through an OpenAI-compatible endpoint:

```bash
pip install litellm[proxy]
litellm --model gemini/gemini-embedding-001 --port 4000
```

Then configure RAG-Anything:

```json
{
  "environment": {
    "EMBEDDING_API_KEY": "YOUR_GEMINI_KEY",
    "EMBEDDING_BASE_URL": "http://localhost:4000/v1",
    "EMBEDDING_MODEL": "gemini/gemini-embedding-001"
  }
}
```

### Pricing

- Free tier: 1M tokens/month (AI Studio)
- Paid: ~$0.10 per 1M tokens (pay-as-you-go)

---

## OpenAI Embeddings

Default option. Works out of the box with RAG-Anything. No configuration beyond setting `OPENAI_API_KEY`.

```json
{
  "environment": {
    "OPENAI_API_KEY": "sk-your-openai-key",
    "EMBEDDING_MODEL": "text-embedding-3-small"
  }
}
```

### Models

| Model | Dims | Cost/1M tokens | Notes |
|-------|------|---------------|-------|
| `text-embedding-3-small` | 1536 (truncatable) | $0.02 | Best value |
| `text-embedding-3-large` | 3072 (truncatable) | $0.13 | Highest quality |

### Cost Estimate for RAG

- 100 documents (~10M tokens): $0.20 (small) / $1.30 (large)
- 1,000 documents (~100M tokens): $2.00 (small) / $13.00 (large)

---

## Switching Providers

**Important:** Changing embedding models requires re-ingesting all documents. Different models produce incompatible vectors.

1. Update `EMBEDDING_MODEL`, `EMBEDDING_API_KEY`, and `EMBEDDING_BASE_URL` in `opencode.json`
2. Delete `rag_storage/` contents
3. Restart OpenCode
4. Re-ingest all documents

---

## Recommendation Matrix

| Scenario | Best Choice |
|----------|-------------|
| Zero cost, local GPU | Ollama + nomic-embed-text |
| Zero cost, no GPU | Gemini (free tier, needs proxy) |
| Best quality, cloud | Jina v5-text-small |
| Best quality, local GPU | Ollama + bge-m3 |
| Cheapest cloud (small docs) | OpenAI text-embedding-3-small |
| Cheapest cloud (large docs) | Jina v5-text-nano |
| Multilingual (CJK, Arabic) | Jina v5-text-small or bge-m3 |
| Already using Google AI Studio | Gemini + LiteLLM proxy |