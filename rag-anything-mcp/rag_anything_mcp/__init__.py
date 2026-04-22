#!/usr/bin/env python3
"""
RAG-Anything MCP Server for OpenCode

A Model Context Protocol (MCP) server that exposes RAG-Anything's document
ingestion and multimodal querying capabilities as tools for OpenCode and other
MCP-compatible clients.

Tools:
    - ingest_document:  Index a single document (PDF/DOCX/PPTX/etc.) into RAG
    - ingest_folder:    Batch index all supported files in a directory
    - query:            Query the RAG knowledge base (text + optional VLM-enhanced)
    - query_multimodal: Query with inline images, tables, or equations
    - get_status:       Check server status and RAG-Anything configuration

Environment Variables (all optional with sensible defaults):
    OPENAI_API_KEY          - OpenAI API key for LLM and embeddings
    OPENAI_BASE_URL         - Custom OpenAI-compatible endpoint
    EMBEDDING_API_KEY       - Separate API key for embeddings (defaults to OPENAI_API_KEY)
    EMBEDDING_BASE_URL      - Separate endpoint for embeddings (defaults to OPENAI_BASE_URL)
    LLM_MODEL               - LLM model name (default: gpt-4o-mini)
    EMBEDDING_MODEL         - Embedding model name (default: text-embedding-3-small)
    VISION_MODEL            - Vision model name (default: gpt-4o)
    WORKING_DIR             - RAG storage directory (default: ./rag_storage)
    PARSER                  - Document parser: mineru|docling|paddleocr (default: mineru)
    RAG_LLM_MAX_ASYNC       - Max concurrent LLM calls (default: 16)
    RAG_EMBED_MAX_ASYNC     - Max concurrent embedding calls (default: 16)
    LOG_LEVEL               - Logging level (default: INFO)
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import traceback
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

# ---------------------------------------------------------------------------
# Logging setup (before any imports that might log)
# ---------------------------------------------------------------------------
_LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("rag-anything-mcp")

# ---------------------------------------------------------------------------
# Dependency imports with helpful error messages
# ---------------------------------------------------------------------------
try:
    from mcp.server import Server
    from mcp.server.stdio import stdio_server
    from mcp.types import (
        EmbeddedResource,
        ImageContent,
        TextContent,
        Tool,
    )
except ImportError as exc:
    raise ImportError(
        "The 'mcp' package is required. Install it with:\n"
        "  pip install mcp>=1.6.0\n"
        "or install this package with the 'mcp' extra:\n"
        "  pip install rag-anything-mcp"
    ) from exc

try:
    from raganything import RAGAnything, RAGAnythingConfig
except ImportError as exc:
    raise ImportError(
        "RAG-Anything is required. Install it with:\n"
        "  pip install raganything\n"
        "See: https://github.com/HKUDS/RAG-Anything#installation"
    ) from exc

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", None)
EMBEDDING_API_KEY = os.environ.get("EMBEDDING_API_KEY", OPENAI_API_KEY)
EMBEDDING_BASE_URL = os.environ.get("EMBEDDING_BASE_URL", OPENAI_BASE_URL)
LLM_MODEL = os.environ.get("LLM_MODEL", "gpt-4o-mini")
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL", "text-embedding-3-small")
VISION_MODEL = os.environ.get("VISION_MODEL", "gpt-4o")


# ---------------------------------------------------------------------------
# OpenAI model function helpers
# ---------------------------------------------------------------------------

def _openai_llm_model_func(
    prompt: str, system_prompt: str | None = None, **kwargs: Any
) -> str:
    """Synchronous LLM wrapper using OpenAI API."""
    import openai

    client = openai.OpenAI(
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
    )
    messages: List[Dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    response = client.chat.completions.create(
        model=kwargs.get("model", LLM_MODEL),
        messages=messages,  # type: ignore[arg-type]
        temperature=kwargs.get("temperature", 0.0),
        max_tokens=kwargs.get("max_tokens", None),
    )
    return response.choices[0].message.content or ""


async def _openai_llm_model_func_async(
    prompt: str, system_prompt: str | None = None, **kwargs: Any
) -> str:
    """Asynchronous LLM wrapper using OpenAI API."""
    import openai

    client = openai.AsyncOpenAI(
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
    )
    messages: List[Dict[str, str]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    response = await client.chat.completions.create(
        model=kwargs.get("model", LLM_MODEL),
        messages=messages,  # type: ignore[arg-type]
        temperature=kwargs.get("temperature", 0.0),
        max_tokens=kwargs.get("max_tokens", None),
    )
    return response.choices[0].message.content or ""


async def _openai_embedding_func(texts: List[str]) -> "numpy.ndarray":
    """Asynchronous embedding wrapper using OpenAI API.
    
    Returns a numpy array (required by LightRAG's EmbeddingFunc validation).
    """
    import numpy as np
    import openai

    client = openai.AsyncOpenAI(
        api_key=EMBEDDING_API_KEY,
        base_url=EMBEDDING_BASE_URL,
    )
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
    )
    return np.array([item.embedding for item in response.data])


def _build_embedding_func():
    """Wrap the embedding function in LightRAG's EmbeddingFunc dataclass."""
    from lightrag.utils import EmbeddingFunc

    # Determine embedding dimension based on model
    dim_map = {
        "mxbai-embed-large": 1024,
        "nomic-embed-text": 768,
        "text-embedding-3-small": 1536,
        "text-embedding-3-large": 3072,
        "bge-m3": 1024,
        "all-minilm": 384,
    }
    dim = dim_map.get(EMBEDDING_MODEL, 1024)

    return EmbeddingFunc(
        embedding_dim=dim,
        func=_openai_embedding_func,
        model_name=EMBEDDING_MODEL,
    )


async def _openai_vision_model_func(
    prompt: str, images: List[str], **kwargs: Any
) -> str:
    """Asynchronous vision model wrapper using OpenAI GPT-4o."""
    import base64
    import openai

    client = openai.AsyncOpenAI(
        api_key=OPENAI_API_KEY,
        base_url=OPENAI_BASE_URL,
    )

    content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
    for img_path in images:
        img_data = Path(img_path).read_bytes()
        b64 = base64.b64encode(img_data).decode("utf-8")
        # Determine mime type from extension
        suffix = Path(img_path).suffix.lower()
        mime = "image/png" if suffix in (".png",) else "image/jpeg"
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{b64}"},
            }
        )

    response = await client.chat.completions.create(
        model=VISION_MODEL,
        messages=[{"role": "user", "content": content}],  # type: ignore[arg-type]
        temperature=kwargs.get("temperature", 0.0),
        max_tokens=kwargs.get("max_tokens", 4096),
    )
    return response.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# RAGAnything instance management
# ---------------------------------------------------------------------------

_rag: Optional[RAGAnything] = None
_server_start_time: float = 0.0


def _build_rag_anything() -> RAGAnything:
    """Build a RAGAnything instance from environment configuration."""
    logger.info("Building RAGAnything instance...")

    # Check for API key
    if not OPENAI_API_KEY:
        logger.warning(
            "OPENAI_API_KEY is not set. LLM and embedding functions will fail. "
            "Set it in your environment or Opencode MCP server config."
        )

    # Create configuration
    config = RAGAnythingConfig(
        working_dir=os.environ.get("WORKING_DIR", "./rag_storage"),
        parser=os.environ.get("PARSER", "mineru"),
        parse_method=os.environ.get("PARSE_METHOD", "auto"),
        enable_image_processing=True,
        enable_table_processing=True,
        enable_equation_processing=True,
    )

    # LightRAG tuning via lightrag_kwargs
    lightrag_kwargs: Dict[str, Any] = {
        "llm_model_name": LLM_MODEL,
        "llm_model_max_async": int(os.environ.get("RAG_LLM_MAX_ASYNC", "16")),
        "embedding_func_max_async": int(
            os.environ.get("RAG_EMBED_MAX_ASYNC", "16")
        ),
    }

    rag = RAGAnything(
        config=config,
        llm_model_func=_openai_llm_model_func_async,
        embedding_func=_build_embedding_func(),
        vision_model_func=_openai_vision_model_func,
        lightrag_kwargs=lightrag_kwargs,
    )

    logger.info("RAGAnything instance created successfully")
    return rag


async def _initialize_rag() -> None:
    """Initialize LightRAG storage and processors."""
    global _rag
    if _rag is None:
        raise RuntimeError("RAGAnything instance not built")

    # Initialize only once
    if _rag.lightrag is not None:
        return

    logger.info("Initializing LightRAG storage...")
    result = await _rag._ensure_lightrag_initialized()
    if not result.get("success", False):
        error = result.get("error", "Unknown error")
        raise RuntimeError(f"Failed to initialize LightRAG: {error}")
    logger.info("LightRAG initialized successfully")


# ---------------------------------------------------------------------------
# Tool schemas
# ---------------------------------------------------------------------------

TOOL_INGEST_DOCUMENT = Tool(
    name="ingest_document",
    description=(
        "Index a single document into the RAG knowledge base. "
        "Supports PDF, DOCX, PPTX, TXT, MD, and other formats. "
        "The document is parsed, chunked, and embedded for retrieval. "
        "Large files may take several minutes depending on parser and hardware."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Absolute path to the document file to index",
            },
            "output_dir": {
                "type": "string",
                "default": "./rag_output",
                "description": "Directory for parser output artifacts (optional)",
            },
        },
        "required": ["file_path"],
    },
)

TOOL_INGEST_FOLDER = Tool(
    name="ingest_folder",
    description=(
        "Batch index all supported documents in a folder. "
        "Recursively traverses subdirectories and processes every supported file. "
        "Useful for indexing an entire project directory, dataset, or document collection."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "folder_path": {
                "type": "string",
                "description": "Absolute path to the folder containing documents",
            },
            "output_dir": {
                "type": "string",
                "default": "./rag_output",
                "description": "Directory for parser output artifacts (optional)",
            },
            "recursive": {
                "type": "boolean",
                "default": True,
                "description": "Whether to recursively process subdirectories",
            },
            "file_extensions": {
                "type": "array",
                "items": {"type": "string"},
                "default": [".pdf", ".docx", ".pptx", ".txt", ".md", ".html"],
                "description": "List of file extensions to process",
            },
        },
        "required": ["folder_path"],
    },
)

TOOL_QUERY = Tool(
    name="query",
    description=(
        "Query the RAG knowledge base using natural language. "
        "Retrieves relevant chunks from indexed documents and synthesizes an answer. "
        "Modes: 'hybrid' (graph+vector), 'local' (graph-only), 'global' (vector-only), "
        "'naive' (simple similarity), 'mix' (combined). "
        "Set vlm_enhanced=true to have the vision model analyze images found in retrieved context."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "Natural language query/question",
            },
            "mode": {
                "type": "string",
                "enum": ["hybrid", "local", "global", "naive", "mix"],
                "default": "mix",
                "description": "Retrieval mode strategy",
            },
            "vlm_enhanced": {
                "type": "boolean",
                "default": False,
                "description": "Enable VLM image analysis in retrieved context (requires vision model)",
            },
        },
        "required": ["question"],
    },
)

TOOL_QUERY_MULTIMODAL = Tool(
    name="query_multimodal",
    description=(
        "Query with inline multimodal content (images, tables, equations). "
        "Pass images or tables directly in the query for analysis alongside the RAG context. "
        "Each content item must specify a 'type' field: 'image' (with img_path), "
        "'table' (with table_data as CSV or markdown), or 'equation' (with latex)."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "Natural language query/query",
            },
            "multimodal_content": {
                "type": "array",
                "description": "List of multimodal content items",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {
                            "type": "string",
                            "enum": ["image", "table", "equation"],
                            "description": "Type of multimodal content",
                        },
                        "img_path": {
                            "type": "string",
                            "description": "Path to image file (for type='image')",
                        },
                        "table_data": {
                            "type": "string",
                            "description": "Table content as CSV or markdown (for type='table')",
                        },
                        "latex": {
                            "type": "string",
                            "description": "LaTeX equation string (for type='equation')",
                        },
                    },
                    "required": ["type"],
                },
            },
            "mode": {
                "type": "string",
                "enum": ["hybrid", "local", "global", "naive", "mix"],
                "default": "mix",
                "description": "Retrieval mode strategy",
            },
        },
        "required": ["question"],
    },
)

TOOL_GET_STATUS = Tool(
    name="get_status",
    description=(
        "Check the server status, RAG-Anything configuration, and indexed document count. "
        "Useful for verifying the server is healthy and understanding what is configured."
    ),
    inputSchema={
        "type": "object",
        "properties": {},
    },
)

ALL_TOOLS = [
    TOOL_INGEST_DOCUMENT,
    TOOL_INGEST_FOLDER,
    TOOL_QUERY,
    TOOL_QUERY_MULTIMODAL,
    TOOL_GET_STATUS,
]


# ---------------------------------------------------------------------------
# Tool handlers
# ---------------------------------------------------------------------------

async def _handle_ingest_document(args: dict) -> List[TextContent]:
    """Handle ingest_document tool call."""
    file_path = args.get("file_path", "")
    output_dir = args.get("output_dir", "./rag_output")

    if not file_path:
        return [TextContent(type="text", text="Error: file_path is required")]

    path = Path(file_path)
    if not path.exists():
        return [TextContent(type="text", text=f"Error: File not found: {file_path}")]

    await _initialize_rag()
    assert _rag is not None

    logger.info(f"Processing document: {file_path}")
    await _rag.process_document_complete(
        file_path=str(file_path),
        output_dir=output_dir,
    )
    logger.info(f"Document indexed: {file_path}")

    return [
        TextContent(
            type="text",
            text=f"Successfully indexed document: {path.name}\n"
            f"  Full path: {path.absolute()}\n"
            f"  Parser output: {output_dir}",
        )
    ]


async def _handle_ingest_folder(args: dict) -> List[TextContent]:
    """Handle ingest_folder tool call."""
    folder_path = args.get("folder_path", "")
    output_dir = args.get("output_dir", "./rag_output")
    recursive = args.get("recursive", True)
    file_extensions = args.get(
        "file_extensions", [".pdf", ".docx", ".pptx", ".txt", ".md", ".html"]
    )

    if not folder_path:
        return [TextContent(type="text", text="Error: folder_path is required")]

    path = Path(folder_path)
    if not path.exists():
        return [TextContent(type="text", text=f"Error: Folder not found: {folder_path}")]
    if not path.is_dir():
        return [TextContent(type="text", text=f"Error: Not a directory: {folder_path}")]

    await _initialize_rag()
    assert _rag is not None

    logger.info(f"Processing folder: {folder_path} (recursive={recursive})")
    await _rag.process_folder_complete(
        folder_path=str(folder_path),
        output_dir=output_dir,
        recursive=recursive,
        file_extensions=file_extensions,
    )
    logger.info(f"Folder indexed: {folder_path}")

    return [
        TextContent(
            type="text",
            text=f"Successfully indexed folder: {path.name}\n"
            f"  Full path: {path.absolute()}\n"
            f"  Recursive: {recursive}\n"
            f"  File extensions: {', '.join(file_extensions)}\n"
            f"  Parser output: {output_dir}",
        )
    ]


async def _handle_query(args: dict) -> List[TextContent]:
    """Handle query tool call."""
    question = args.get("question", "")
    mode = args.get("mode", "mix")
    vlm_enhanced = args.get("vlm_enhanced", False)

    if not question:
        return [TextContent(type="text", text="Error: question is required")]

    await _initialize_rag()
    assert _rag is not None

    logger.info(f"Querying: {question[:80]}... (mode={mode}, vlm={vlm_enhanced})")
    result = await _rag.aquery(
        question,
        mode=mode,
        vlm_enhanced=vlm_enhanced,
    )
    logger.info("Query completed")

    return [TextContent(type="text", text=result)]


async def _handle_query_multimodal(args: dict) -> List[TextContent]:
    """Handle query_multimodal tool call."""
    question = args.get("question", "")
    multimodal_content = args.get("multimodal_content", [])
    mode = args.get("mode", "mix")

    if not question:
        return [TextContent(type="text", text="Error: question is required")]

    await _initialize_rag()
    assert _rag is not None

    logger.info(
        f"Multimodal query: {question[:80]}... "
        f"(mode={mode}, content_items={len(multimodal_content)})"
    )

    # Normalize multimodal content to the expected format
    normalized_content: List[Dict[str, Any]] = []
    for item in multimodal_content or []:
        if isinstance(item, dict) and "type" in item:
            normalized_content.append(item)
        else:
            logger.warning(f"Skipping invalid multimodal content item: {item}")

    result = await _rag.aquery_with_multimodal(
        query=question,
        multimodal_content=normalized_content or None,
        mode=mode,
    )
    logger.info("Multimodal query completed")

    return [TextContent(type="text", text=result)]


async def _handle_get_status() -> List[TextContent]:
    """Handle get_status tool call."""
    import time

    uptime = time.time() - _server_start_time

    status_lines = [
        "RAG-Anything MCP Server Status",
        "=" * 40,
        f"Server uptime: {uptime:.1f}s",
        f"Working directory: {os.environ.get('WORKING_DIR', './rag_storage')}",
        f"Parser: {os.environ.get('PARSER', 'mineru')}",
        f"LLM model: {LLM_MODEL}",
        f"Embedding model: {EMBEDDING_MODEL}",
        f"Vision model: {VISION_MODEL}",
        f"OpenAI base URL: {OPENAI_BASE_URL or 'default'}",
        f"API key configured: {'Yes' if OPENAI_API_KEY else 'No'}",
    ]

    if _rag is not None:
        try:
            config_info = _rag.get_config_info()
            status_lines.extend([
                "",
                "RAGAnything Configuration:",
                f"  Image processing: {config_info.get('multimodal_processing', {}).get('enable_image_processing', 'N/A')}",
                f"  Table processing: {config_info.get('multimodal_processing', {}).get('enable_table_processing', 'N/A')}",
                f"  Equation processing: {config_info.get('multimodal_processing', {}).get('enable_equation_processing', 'N/A')}",
            ])
        except Exception as exc:
            status_lines.append(f"\nCould not retrieve config: {exc}")
    else:
        status_lines.append(
            "\nRAGAnything: Not yet initialized (will init on first use)"
        )

    # Check working directory for existing storage
    working_dir = Path(os.environ.get("WORKING_DIR", "./rag_storage"))
    if working_dir.exists():
        try:
            file_count = len(list(working_dir.rglob("*")))
            status_lines.append(f"\nStorage files: {file_count} files in {working_dir}")
        except Exception:
            pass

    return [TextContent(type="text", text="\n".join(status_lines))]


# ---------------------------------------------------------------------------
# MCP lifespan (must be defined before Server instantiation)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def _app_lifespan(server: Server) -> AsyncIterator[Dict[str, Any]]:
    """Manage application lifespan: startup and shutdown."""
    global _rag, _server_start_time
    _server_start_time = asyncio.get_event_loop().time()

    logger.info("=" * 50)
    logger.info("RAG-Anything MCP Server starting")
    logger.info("=" * 50)

    try:
        _rag = _build_rag_anything()
        logger.info("RAGAnything instance ready (LightRAG init deferred to first use)")
    except Exception as exc:
        logger.error(f"Failed to build RAGAnything: {exc}")
        raise

    yield {}

    # Shutdown
    logger.info("Shutting down RAG-Anything MCP Server...")
    if _rag is not None:
        try:
            await _rag.finalize_storages()
            logger.info("Storage finalized")
        except Exception as exc:
            logger.error(f"Error during shutdown: {exc}")


# ---------------------------------------------------------------------------
# Server instantiation
# ---------------------------------------------------------------------------

app = Server("rag-anything", lifespan=_app_lifespan)


@app.list_tools()
async def list_tools() -> List[Tool]:
    """Return the list of available tools."""
    return ALL_TOOLS


@app.call_tool()
async def call_tool(
    name: str, arguments: dict | None = None
) -> List[TextContent | ImageContent | EmbeddedResource]:
    """Dispatch tool calls to the appropriate handler."""
    arguments = arguments or {}
    logger.info(f"Tool call: {name} with args: {arguments}")

    try:
        if name == "ingest_document":
            return await _handle_ingest_document(arguments)
        elif name == "ingest_folder":
            return await _handle_ingest_folder(arguments)
        elif name == "query":
            return await _handle_query(arguments)
        elif name == "query_multimodal":
            return await _handle_query_multimodal(arguments)
        elif name == "get_status":
            return await _handle_get_status()
        else:
            return [TextContent(type="text", text=f"Unknown tool: {name}")]
    except Exception as exc:
        logger.error(f"Error in tool {name}: {exc}")
        logger.debug(traceback.format_exc())
        return [TextContent(type="text", text=f"Error: {exc}")]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def main() -> None:
    """Run the MCP server over stdio."""
    async with stdio_server() as (read_stream, write_stream):
        await app.run(
            read_stream,
            write_stream,
            app.create_initialization_options(),
            raise_exceptions=True,
        )


if __name__ == "__main__":
    asyncio.run(main())
