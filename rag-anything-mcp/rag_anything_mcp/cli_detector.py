"""
CLI Configuration Detector for RAG-Anything

Auto-detects which AI CLI the user has configured (OpenCode, Claude Code, Aider, etc.)
and extracts relevant settings for RAG-Anything configuration.

This module is optional - RAG-Anything works without it. Use it to help users
migrate settings or auto-configure based on their existing CLI setup.

Usage:
    from cli_detector import detect_cli, get_suggested_config
    
    cli_info = detect_cli()
    if cli_info:
        print(f"Detected: {cli_info['name']}")
        config = get_suggested_config(cli_info)
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, TypedDict


class CLIInfo(TypedDict):
    """Information about a detected CLI."""
    name: str
    config_path: Path
    config_format: str  # "json", "yaml", etc.
    settings: Dict[str, Any]


# Config file locations by CLI
CLI_CONFIG_PATHS = {
    "opencode": [
        "~/.config/opencode/opencode.json",
        "~/Library/Application Support/opencode/opencode.json",  # macOS
        "~/.opencode.json",
        "./opencode.json",
    ],
    "claude": [
        "~/.claude/settings.json",
        "./.claude/settings.json",
        "~/.claude.json",  # Legacy
    ],
    "aider": [
        "~/.aider.conf.yml",
        "./.aider.conf.yml",
        "~/.config/aider/config.yml",
    ],
    "cursor": [
        "~/.cursor/cli-config.json",
        "~/.cursor/config.json",
        "./.cursor/cli.json",
    ],
    "continue": [
        "~/.continue/config.yaml",
        "~/.continue/config.json",
        "~/.config/continue/config.yaml",
    ],
    "copilot": [
        "~/.copilot/config.json",
        "~/.config/copilot/config.json",
    ],
    "cline": [
        "~/.cline/settings.json",
        "./.cline/settings.json",
    ],
}


def _expand_path(path: str) -> Path:
    """Expand user home and resolve to absolute path."""
    return Path(os.path.expanduser(path)).resolve()


def _load_json_config(path: Path) -> Optional[Dict[str, Any]]:
    """Load a JSON config file."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()
            # Handle JSONC (JSON with comments) by stripping lines starting with //
            lines = [line for line in content.split("\n") if not line.strip().startswith("//")]
            return json.loads("\n".join(lines))
    except (json.JSONDecodeError, FileNotFoundError, PermissionError):
        return None


def _load_yaml_config(path: Path) -> Optional[Dict[str, Any]]:
    """Load a YAML config file if PyYAML is available."""
    try:
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except ImportError:
        # PyYAML not installed, can't parse YAML
        return None
    except (FileNotFoundError, PermissionError):
        return None


def detect_cli(cli_name: Optional[str] = None) -> Optional[CLIInfo]:
    """
    Detect which AI CLI the user has configured.
    
    Args:
        cli_name: Specific CLI to check ("opencode", "claude", "aider", etc.)
                 If None, checks all CLIs and returns the first found.
    
    Returns:
        CLIInfo dict with name, config_path, format, and settings,
        or None if no CLI config found.
    """
    clis_to_check = [cli_name] if cli_name else CLI_CONFIG_PATHS.keys()
    
    for cli in clis_to_check:
        if cli not in CLI_CONFIG_PATHS:
            continue
            
        for path_template in CLI_CONFIG_PATHS[cli]:
            path = _expand_path(path_template)
            if not path.exists():
                continue
                
            # Determine format from extension
            if path.suffix in (".json", ".jsonc"):
                settings = _load_json_config(path)
                config_format = "json"
            elif path.suffix in (".yml", ".yaml"):
                settings = _load_yaml_config(path)
                config_format = "yaml"
            else:
                # Try JSON first, then YAML
                settings = _load_json_config(path)
                config_format = "json"
                if settings is None:
                    settings = _load_yaml_config(path)
                    config_format = "yaml"
            
            if settings is not None:
                return CLIInfo(
                    name=cli,
                    config_path=path,
                    config_format=config_format,
                    settings=settings,
                )
    
    return None


def detect_all_clis() -> List[CLIInfo]:
    """
    Detect all AI CLIs that have configuration files.
    
    Returns:
        List of CLIInfo dicts for all detected CLIs.
    """
    found = []
    for cli_name in CLI_CONFIG_PATHS.keys():
        info = detect_cli(cli_name)
        if info:
            found.append(info)
    return found


def _extract_opencode_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Extract relevant settings from OpenCode config."""
    rag_config = {}
    
    # Look for RAG-Anything MCP config
    mcp = settings.get("mcp", {})
    if "rag-anything" in mcp:
        rag_mcp = mcp["rag-anything"]
        env = rag_mcp.get("environment", {})
        rag_config.update({
            "openai_api_key": env.get("OPENAI_API_KEY"),
            "openai_base_url": env.get("OPENAI_BASE_URL"),
            "embedding_api_key": env.get("EMBEDDING_API_KEY"),
            "embedding_base_url": env.get("EMBEDDING_BASE_URL"),
            "llm_model": env.get("LLM_MODEL"),
            "embedding_model": env.get("EMBEDDING_MODEL"),
            "vision_model": env.get("VISION_MODEL"),
            "working_dir": env.get("WORKING_DIR"),
            "parser": env.get("PARSER"),
            "log_level": env.get("LOG_LEVEL"),
        })
    
    # Extract general model settings if no RAG-specific config
    if not rag_config.get("llm_model"):
        rag_config["llm_model"] = settings.get("model")
    
    # Extract provider settings
    provider = settings.get("provider", {})
    if "anthropic" in provider or "openai" in provider:
        # Use provider config as fallback
        pass
    
    return {k: v for k, v in rag_config.items() if v is not None}


def _extract_claude_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Extract relevant settings from Claude Code config."""
    rag_config = {}
    
    # Claude uses env vars in settings
    env_settings = settings.get("env", {})
    
    # Check for Anthropic API key
    if "ANTHROPIC_API_KEY" in env_settings:
        rag_config["custom_api_key"] = env_settings["ANTHROPIC_API_KEY"]
        rag_config["custom_base_url"] = "https://api.anthropic.com/v1"
        rag_config["llm_model"] = settings.get("model", "claude-sonnet-4-5")
    
    # Check permissions for bash access
    permissions = settings.get("permissions", {})
    if permissions.get("allow"):
        rag_config["note"] = "Claude Code has bash permissions configured"
    
    return rag_config


def _extract_aider_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Extract relevant settings from Aider config."""
    rag_config = {}
    
    # Aider uses model settings
    if "model" in settings:
        rag_config["llm_model"] = settings["model"]
    
    # Aider uses OpenAI API key by default
    if settings.get("openai_api_key"):
        rag_config["openai_api_key"] = settings["openai_api_key"]
    
    # Weak model for cheaper operations
    if settings.get("weak_model"):
        rag_config["embedding_model"] = settings["weak_model"]
    
    # Read files for context
    if settings.get("read"):
        rag_config["note"] = f"Aider reads: {settings['read']}"
    
    return rag_config


def _extract_cursor_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Extract relevant settings from Cursor config."""
    rag_config = {}
    
    # Cursor has OpenAI-compatible API
    if settings.get("openai_api_key"):
        rag_config["openai_api_key"] = settings["openai_api_key"]
    
    if settings.get("model"):
        rag_config["llm_model"] = settings["model"]
    
    return rag_config


def _extract_continue_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    """Extract relevant settings from Continue config."""
    rag_config = {}
    
    # Continue has models config
    models = settings.get("models", [])
    if models:
        default_model = models[0]
        if isinstance(default_model, dict):
            rag_config["llm_model"] = default_model.get("model")
            rag_config["custom_api_key"] = default_model.get("apiKey")
            rag_config["custom_base_url"] = default_model.get("apiBase")
    
    # Context providers
    context = settings.get("context", [])
    if context:
        rag_config["note"] = f"Continue has {len(context)} context providers"
    
    return rag_config


def extract_rag_settings(cli_info: CLIInfo) -> Dict[str, Any]:
    """
    Extract RAG-Anything relevant settings from a detected CLI config.
    
    Args:
        cli_info: The detected CLI info from detect_cli()
    
    Returns:
        Dict of settings that can be used for RAG-Anything configuration.
    """
    name = cli_info["name"]
    settings = cli_info["settings"]
    
    extractors = {
        "opencode": _extract_opencode_settings,
        "claude": _extract_claude_settings,
        "aider": _extract_aider_settings,
        "cursor": _extract_cursor_settings,
        "continue": _extract_continue_settings,
        "copilot": lambda s: {},  # Copilot uses GitHub auth, not API keys
        "cline": _extract_claude_settings,  # Cline is Claude-based
    }
    
    extractor = extractors.get(name, lambda s: {})
    return extractor(settings)


def get_suggested_config(cli_info: CLIInfo) -> Dict[str, Any]:
    """
    Get suggested RAG-Anything configuration based on detected CLI.
    
    Args:
        cli_info: The detected CLI info from detect_cli()
    
    Returns:
        Suggested environment variables for RAG-Anything.
    """
    settings = extract_rag_settings(cli_info)
    
    # Build suggested config
    suggested = {
        "_detected_from": cli_info["name"],
        "_config_path": str(cli_info["config_path"]),
    }
    
    # Map extracted settings to RAG-Anything env vars
    if settings.get("openai_api_key"):
        suggested["OPENAI_API_KEY"] = settings["openai_api_key"]
    if settings.get("openai_base_url"):
        suggested["OPENAI_BASE_URL"] = settings["openai_base_url"]
    if settings.get("embedding_api_key"):
        suggested["EMBEDDING_API_KEY"] = settings["embedding_api_key"]
    if settings.get("embedding_base_url"):
        suggested["EMBEDDING_BASE_URL"] = settings["embedding_base_url"]
    if settings.get("llm_model"):
        suggested["LLM_MODEL"] = settings["llm_model"]
    if settings.get("embedding_model"):
        suggested["EMBEDDING_MODEL"] = settings["embedding_model"]
    if settings.get("vision_model"):
        suggested["VISION_MODEL"] = settings["vision_model"]
    if settings.get("working_dir"):
        suggested["WORKING_DIR"] = settings["working_dir"]
    if settings.get("parser"):
        suggested["PARSER"] = settings["parser"]
    if settings.get("log_level"):
        suggested["LOG_LEVEL"] = settings["log_level"]
    
    # Add defaults for missing values
    if "LLM_MODEL" not in suggested:
        suggested["LLM_MODEL"] = "gpt-4o-mini"
    if "EMBEDDING_MODEL" not in suggested:
        suggested["EMBEDDING_MODEL"] = "text-embedding-3-small"
    if "VISION_MODEL" not in suggested:
        suggested["VISION_MODEL"] = suggested["LLM_MODEL"]
    if "WORKING_DIR" not in suggested:
        suggested["WORKING_DIR"] = "~/rag_storage"
    if "PARSER" not in suggested:
        suggested["PARSER"] = "docling"
    
    return suggested


def print_detection_report() -> None:
    """Print a report of detected CLIs and suggested RAG-Anything config."""
    print("=" * 60)
    print("RAG-Anything CLI Configuration Detector")
    print("=" * 60)
    print()
    
    # Detect all CLIs
    all_clis = detect_all_clis()
    
    if not all_clis:
        print("No AI CLI configurations detected.")
        print()
        print("Supported CLIs:")
        for cli in CLI_CONFIG_PATHS.keys():
            print(f"  - {cli}")
        print()
        print("To use RAG-Anything, set environment variables manually or")
        print("configure it in your MCP server settings.")
        return
    
    print(f"Detected {len(all_clis)} CLI configuration(s):")
    print()
    
    for cli_info in all_clis:
        print(f"  {cli_info['name'].upper()}")
        print(f"    Config: {cli_info['config_path']}")
        print(f"    Format: {cli_info['config_format']}")
        
        # Show extracted settings
        rag_settings = extract_rag_settings(cli_info)
        if rag_settings:
            print(f"    Detected settings:")
            for key, value in rag_settings.items():
                if "key" in key.lower():
                    value = f"{str(value)[:8]}..." if value else "not set"
                print(f"      {key}: {value}")
        print()
    
    # Show suggested config for the first detected CLI
    if all_clis:
        primary = all_clis[0]
        suggested = get_suggested_config(primary)
        
        print("-" * 60)
        print(f"Suggested RAG-Anything config (from {primary['name']}):")
        print("-" * 60)
        print()
        print("Environment variables:")
        for key, value in suggested.items():
            if not key.startswith("_"):
                # Mask API keys
                if "KEY" in key:
                    value = f"{str(value)[:8]}..." if value else "not set"
                print(f"  {key}={value}")
        print()
        print("Or add to your MCP server config:")
        print()
        print('  "environment": {')
        for key, value in suggested.items():
            if not key.startswith("_"):
                # Show placeholder for keys
                if "KEY" in key:
                    display_value = f"YOUR_{key}"
                else:
                    display_value = value
                print(f'    "{key}": "{display_value}",')
        print('  }')


if __name__ == "__main__":
    print_detection_report()
