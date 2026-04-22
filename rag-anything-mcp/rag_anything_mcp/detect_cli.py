#!/usr/bin/env python3
"""
CLI Detection Tool for RAG-Anything

Usage:
    python -m rag_anything_mcp.detect_cli
    
This detects which AI CLI you have configured and suggests
RAG-Anything configuration based on your existing setup.
"""

from cli_detector import print_detection_report

if __name__ == "__main__":
    print_detection_report()
