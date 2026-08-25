#!/usr/bin/env python3
"""
build_pipeline.py - Complete End-to-End Build & Update Pipeline for Tipitaka XML (VRI/CSCD).

This script automates:
  1. Transliterating Devanagari XML books, tree.json, and TOC files to Roman Latin (UTF-8)
     using either Dart or Python converter engine.
  2. Parsing all 217 books and calculating exact paragraph offsets for all 2,698 chapters.
  3. Building the SQLite3 database (tipitaka.db) with metadata, books, chapters, tree nodes,
     and FTS5 full-text search index (520,000+ paragraphs).
  4. Synchronizing web assets (CSS, JS, fonts, XSL, chapter shortcuts).
  5. Validating database & API endpoints, and restarting systemd services.

Usage:
  python3 build_pipeline.py                   # Run full pipeline (default)
  python3 build_pipeline.py --all             # Run full pipeline
  python3 build_pipeline.py --transliterate   # Run transliteration only
  python3 build_pipeline.py --build-db        # Build SQLite database only
  python3 build_pipeline.py --sync-assets     # Synchronize web assets & shortcuts only
  python3 build_pipeline.py --verify          # Verify database & API endpoints
  python3 build_pipeline.py --engine=dart     # Use Dart converter (default if available)
  python3 build_pipeline.py --engine=python   # Use Python converter
"""

import os
import sys
import glob
import json
import re
import shutil
import sqlite3
import argparse
import subprocess
import time
import urllib.request
import urllib.parse

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DEVA_DIR = os.path.join(ROOT_DIR, 'deva')
P_LATIN_DIR = os.path.join(ROOT_DIR, 'p_latin2')
P_LATIN_PRESPLIT_DIR = os.path.join(ROOT_DIR, 'p_latin_presplit2')
WEB_APP_DIR = os.path.join(ROOT_DIR, 'web_app2')
DART_DIR = os.path.join(ROOT_DIR, 'dart')
DB_FILE = os.path.join(ROOT_DIR, 'tipitaka_latin2.db')
WEB_DB_FILE = os.path.join(WEB_APP_DIR, 'tipitaka2.db')

sys.path.append(os.path.join(ROOT_DIR, 'conversion scripts'))


def log(section: str, msg: str):
    print(f"\n[{time.strftime('%H:%M:%S')}] \033[1;34m=== {section}: {msg} ===\033[0m")


def log_step(msg: str):
    print(f"  \033[1;32m✓\033[0m {msg}")


def log_warn(msg: str):
    print(f"  \033[1;33m⚠\033[0m {msg}")



# ===========================================================================
# Embedded Web Application Templates & Scripts
# ===========================================================================
INDEX_HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi</title>
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <style>
        :root {
            --bg-primary: #fdfdfc;
            --bg-secondary: #f6f5f0;
            --bg-sidebar: #f4f3ec;
            --bg-sidebar-hover: #eae8dd;
            --bg-card: #ffffff;
            --text-primary: #1f2328;
            --text-secondary: #57606a;
            --text-muted: #8c959f;
            --accent: #8b2500;
            --accent-hover: #a82e00;
            --accent-light: #fbeee8;
            --accent-border: #f0c4b4;
            --border-color: #e2e0d5;
            --tree-line: #d8d6c7;
            --highlight-bg: #fff3cd;
            --highlight-border: #ffeeba;
            --tab-inactive-bg: #eae8dc;
            --font-reader: "Gentium Plus", "Times Ext Roman", "Doulos SIL", "EB Garamond", Georgia, serif;
            --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            --sidebar-width: 360px;
            --header-height: 52px;
            --tabs-height: 38px;
            --footer-height: 34px;
            --font-size-base: 18px;
            --line-height-base: 1.85;
        }

        [data-theme="sepia"] {
            --bg-primary: #fbf0d9;
            --bg-secondary: #f4e4c1;
            --bg-sidebar: #efe0bc;
            --bg-sidebar-hover: #e5d3aa;
            --bg-card: #fdf6e7;
            --text-primary: #433422;
            --text-secondary: #6e5c46;
            --text-muted: #96836c;
            --accent: #9c4113;
            --accent-hover: #b84e18;
            --accent-light: #f7dfce;
            --accent-border: #eec2a4;
            --border-color: #dfcd9f;
            --tree-line: #d2be8c;
            --highlight-bg: #ffe4a0;
            --highlight-border: #f5d47a;
            --tab-inactive-bg: #e2d1a6;
        }

        [data-theme="dark"] {
            --bg-primary: #18191a;
            --bg-secondary: #242526;
            --bg-sidebar: #1e1f20;
            --bg-sidebar-hover: #2d2f31;
            --bg-card: #28292a;
            --text-primary: #e4e6eb;
            --text-secondary: #b0b3b8;
            --text-muted: #777a80;
            --accent: #d97736;
            --accent-hover: #eb8d4f;
            --accent-light: #382415;
            --accent-border: #5a3a22;
            --border-color: #3a3b3c;
            --tree-line: #3f4144;
            --highlight-bg: #4a3818;
            --highlight-border: #634b1f;
            --tab-inactive-bg: #1c1d1e;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: var(--font-ui);
            background-color: var(--bg-primary);
            color: var(--text-primary);
            height: 100vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        /* Zen Mode (Header & Footer Toggled / Hidden) */
        body.zen-mode .app-header {
            display: none !important;
        }

        body.zen-mode .app-footer {
            display: none !important;
        }

        /* Top Header */
        header.app-header {
            height: var(--header-height);
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
            flex-shrink: 0;
            z-index: 100;
        }

        .header-left {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .btn-icon {
            background: transparent;
            border: 1px solid transparent;
            border-radius: 6px;
            padding: 5px 9px;
            cursor: pointer;
            color: var(--text-secondary);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 15px;
            transition: all 0.15s ease;
        }

        .btn-icon:hover {
            background: var(--bg-card);
            border-color: var(--border-color);
            color: var(--text-primary);
        }

        .brand-title {
            font-size: 17px;
            font-weight: 700;
            color: var(--accent);
            display: flex;
            align-items: center;
            gap: 8px;
            text-decoration: none;
            letter-spacing: -0.2px;
        }

        .brand-title span.badge {
            font-size: 10px;
            font-weight: 700;
            background: var(--accent-light);
            color: var(--accent);
            padding: 2px 6px;
            border-radius: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .header-center {
            flex: 1;
            max-width: 460px;
            margin: 0 16px;
        }

        .search-box {
            position: relative;
            width: 100%;
        }

        .search-box input {
            width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 18px;
            padding: 6px 14px 6px 32px;
            font-size: 13.5px;
            color: var(--text-primary);
            outline: none;
            cursor: pointer;
            transition: border-color 0.2s, box-shadow 0.2s;
        }

        .search-box input:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px var(--accent-light);
        }

        .search-box .search-icon {
            position: absolute;
            left: 11px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--text-muted);
            font-size: 12px;
            pointer-events: none;
        }

        .header-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .control-group {
            display: flex;
            align-items: center;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            overflow: hidden;
        }

        .control-btn {
            background: transparent;
            border: none;
            padding: 5px 9px;
            font-size: 12.5px;
            cursor: pointer;
            color: var(--text-secondary);
        }

        .control-btn:hover {
            background: var(--bg-secondary);
            color: var(--text-primary);
        }

        .theme-select {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 5px 8px;
            font-size: 12.5px;
            color: var(--text-secondary);
            cursor: pointer;
            outline: none;
        }

        /* Tabs Bar */
        .book-tabs-bar {
            height: var(--tabs-height);
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: flex-end;
            padding: 0 10px;
            gap: 4px;
            flex-shrink: 0;
            z-index: 90;
            overflow-x: auto;
            scrollbar-width: none;
        }

        .book-tabs-bar::-webkit-scrollbar {
            display: none;
        }

        .tabs-scroll-container {
            display: flex;
            align-items: flex-end;
            gap: 3px;
            flex: 1;
            overflow-x: auto;
            scrollbar-width: none;
        }

        .book-tab {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            height: 31px;
            padding: 0 10px;
            background: var(--tab-inactive-bg);
            border: 1px solid var(--border-color);
            border-bottom: none;
            border-radius: 6px 6px 0 0;
            font-size: 12.5px;
            color: var(--text-secondary);
            cursor: pointer;
            user-select: none;
            max-width: 210px;
            white-space: nowrap;
            transition: all 0.12s ease;
            position: relative;
        }

        .book-tab:hover {
            background: var(--bg-card);
            color: var(--text-primary);
        }

        .book-tab.active {
            background: var(--bg-primary);
            color: var(--accent);
            font-weight: 600;
            border-top: 2px solid var(--accent);
            border-bottom: 1px solid var(--bg-primary);
            margin-bottom: -1px;
            z-index: 2;
        }

        .book-tab .tab-icon {
            font-size: 12px;
            opacity: 0.85;
            flex-shrink: 0;
        }

        .book-tab .tab-title {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .book-tab .tab-close-btn {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            border: none;
            background: transparent;
            color: var(--text-muted);
            font-size: 13px;
            line-height: 1;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            margin-left: 3px;
            transition: all 0.12s ease;
            flex-shrink: 0;
        }

        .book-tab .tab-close-btn:hover {
            background: var(--accent-light);
            color: var(--accent);
        }

        .new-tab-btn {
            height: 26px;
            padding: 0 8px;
            margin-bottom: 3px;
            background: transparent;
            border: 1px dashed var(--border-color);
            border-radius: 5px;
            color: var(--text-secondary);
            font-size: 11.5px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            white-space: nowrap;
            transition: all 0.15s ease;
        }

        .new-tab-btn:hover {
            background: var(--bg-card);
            border-color: var(--accent);
            color: var(--accent);
        }

        /* App Body Layout */
        .app-body {
            flex: 1;
            display: flex;
            overflow: hidden;
            position: relative;
        }

        /* Sidebar Navigation */
        aside.app-sidebar {
            width: var(--sidebar-width);
            background: var(--bg-sidebar);
            border-right: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            flex-shrink: 0;
            transition: transform 0.25s ease, margin-left 0.25s ease;
            z-index: 50;
        }

        aside.app-sidebar.collapsed {
            margin-left: calc(-1 * var(--sidebar-width));
        }

        .sidebar-header {
            padding: 10px 12px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            flex-direction: column;
            gap: 8px;
            background: var(--bg-secondary);
        }

        .sidebar-title-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .sidebar-title {
            font-size: 11.5px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.6px;
            color: var(--text-secondary);
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .tree-actions {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .tree-action-btn {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 2px 7px;
            font-size: 11px;
            font-weight: 500;
            color: var(--text-secondary);
            cursor: pointer;
            transition: all 0.12s ease;
        }

        .tree-action-btn:hover {
            border-color: var(--accent);
            color: var(--accent);
        }

        .sidebar-search {
            position: relative;
        }

        .sidebar-search input {
            width: 100%;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            padding: 5px 24px 5px 26px;
            font-size: 12.5px;
            color: var(--text-primary);
            outline: none;
        }

        .sidebar-search input:focus {
            border-color: var(--accent);
        }

        .sidebar-search .icon {
            position: absolute;
            left: 7px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 11px;
            color: var(--text-muted);
        }

        .sidebar-search .clear-btn {
            position: absolute;
            right: 6px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 11px;
            color: var(--text-muted);
            cursor: pointer;
            display: none;
        }

        /* Tree Hierarchy Styling & Connecting Lines */
        .tree-container {
            flex: 1;
            overflow-y: auto;
            padding: 8px 6px;
            font-size: 13.5px;
        }

        .tree-node {
            user-select: none;
            margin-bottom: 1px;
        }

        .tree-row {
            display: flex;
            align-items: center;
            padding: 4px 6px;
            border-radius: 5px;
            cursor: pointer;
            gap: 5px;
            color: var(--text-primary);
            transition: background 0.12s ease, color 0.12s ease;
            position: relative;
        }

        .tree-row:hover {
            background-color: var(--bg-sidebar-hover);
        }

        /* Level 0: Primary Root Categories (Mula, Attha, Tika, Anna) */
        .tree-node.level-0 {
            margin-top: 8px;
            margin-bottom: 4px;
        }

        .tree-node.level-0:first-child {
            margin-top: 2px;
        }

        .tree-node.level-0 > .tree-row {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            padding: 6px 8px;
            font-weight: 700;
            color: var(--accent);
            font-size: 13.5px;
        }

        .tree-node.level-0 > .tree-row:hover {
            background: var(--accent-light);
            border-color: var(--accent-border);
        }

        .tree-node.level-0 > .tree-row .tree-icon {
            font-size: 14px;
        }

        /* Level 1: Pitakas */
        .tree-node.level-1 > .tree-row {
            font-weight: 600;
            font-size: 13px;
            color: var(--text-primary);
            padding: 5px 6px;
        }

        /* Level 2: Nikayas / Divisions */
        .tree-node.level-2 > .tree-row {
            font-weight: 600;
            font-size: 12.5px;
            color: var(--text-secondary);
            padding: 4px 6px;
        }

        /* Books */
        .tree-row.is-book {
            font-weight: 600;
            font-size: 13px;
            color: var(--text-primary);
        }

        .tree-row.is-book:hover {
            color: var(--accent);
        }

        /* Chapter Leafs */
        .tree-row.is-chapter {
            padding-left: 18px;
            font-size: 12px;
            color: var(--text-secondary);
        }

        .tree-row.is-chapter:hover {
            color: var(--text-primary);
            background-color: var(--bg-sidebar-hover);
        }

        /* Active Highlights */
        .tree-row.active {
            background-color: var(--accent-light);
            color: var(--accent);
            font-weight: 600;
        }

        .tree-row.active-book {
            background-color: var(--accent-light);
            color: var(--accent);
            font-weight: 700;
            border-left: 3px solid var(--accent);
            border-radius: 0 5px 5px 0;
        }

        .tree-row.active-chapter {
            color: var(--accent);
            background-color: rgba(139, 37, 0, 0.12);
            font-weight: 600;
            border-left: 2px solid var(--accent);
            border-radius: 0 4px 4px 0;
        }

        .tree-expander {
            width: 14px;
            height: 14px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 9px;
            color: var(--text-muted);
            transition: transform 0.15s ease;
            flex-shrink: 0;
        }

        .tree-expander.expanded {
            transform: rotate(90deg);
        }

        .tree-icon {
            font-size: 13px;
            color: var(--text-muted);
            flex-shrink: 0;
        }

        .tree-text {
            flex: 1;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .tree-badge {
            font-size: 10px;
            padding: 1px 5px;
            border-radius: 8px;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            color: var(--text-muted);
            margin-left: auto;
            flex-shrink: 0;
        }

        /* Hierarchical Guide Connecting Lines */
        .tree-children {
            margin-left: 11px;
            padding-left: 9px;
            border-left: 1.5px solid var(--tree-line);
            display: none;
        }

        .tree-children.show {
            display: block;
        }

        /* Content Area */
        main.content-area {
            flex: 1;
            overflow-y: auto;
            background: var(--bg-primary);
            position: relative;
            display: flex;
            flex-direction: column;
            scroll-behavior: smooth;
        }

        .content-header {
            position: sticky;
            top: 0;
            background: var(--bg-primary);
            border-bottom: 1px solid var(--border-color);
            padding: 8px 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            z-index: 20;
            backdrop-filter: blur(8px);
            cursor: pointer;
            user-select: none;
            transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.2s ease, max-height 0.25s ease, padding 0.25s ease;
            max-height: 48px;
        }

        .content-header.hidden-scroll {
            transform: translateY(-100%);
            opacity: 0;
            pointer-events: none;
            max-height: 0;
            padding-top: 0;
            padding-bottom: 0;
            border-bottom: none;
        }

        .breadcrumbs {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12.5px;
            color: var(--text-secondary);
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
            cursor: pointer;
            transition: color 0.15s ease;
        }

        .breadcrumbs:hover span {
            color: var(--accent);
        }

        .breadcrumbs span.current {
            color: var(--text-primary);
            font-weight: 600;
        }

        .chapter-pills-bar {
            display: flex;
            align-items: center;
            gap: 6px;
            overflow-x: auto;
            padding: 7px 24px;
            background: var(--bg-secondary);
            border-bottom: 1px solid var(--border-color);
            scrollbar-width: thin;
        }

        .chapter-pill {
            font-size: 11.5px;
            padding: 3px 9px;
            border-radius: 12px;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            white-space: nowrap;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .chapter-pill:hover {
            border-color: var(--accent);
            color: var(--accent);
        }

        .chapter-pill.active {
            background: var(--accent);
            border-color: var(--accent);
            color: #ffffff;
            font-weight: 600;
        }

        .reader-container {
            max-width: 880px;
            width: 100%;
            margin: 0 auto;
            padding: 32px 28px 80px 28px;
            font-family: var(--font-reader);
            font-size: var(--font-size-base);
            line-height: var(--line-height-base);
            color: var(--text-primary);
        }

        /* Tipitaka Pali Typography */
        .reader-container p {
            margin-bottom: 1.25em;
            text-align: justify;
            transition: background 0.3s ease;
        }

        .reader-container .book {
            font-size: 1.85em;
            text-align: center;
            font-weight: bold;
            color: var(--accent);
            margin: 1.2em 0 0.4em 0;
            line-height: 1.3;
        }

        .reader-container .nikaya {
            font-size: 1.5em;
            text-align: center;
            font-weight: bold;
            color: var(--text-secondary);
            margin-bottom: 0.4em;
        }

        .reader-container .chapter {
            font-size: 1.4em;
            text-align: center;
            font-weight: bold;
            color: var(--text-primary);
            margin: 1.2em 0 0.6em 0;
        }

        .reader-container .title {
            font-size: 1.25em;
            text-align: center;
            font-weight: bold;
            margin: 1em 0 0.5em 0;
        }

        .reader-container .subhead {
            font-size: 1.15em;
            text-align: center;
            font-weight: bold;
            margin: 0.8em 0 0.4em 0;
        }

        .reader-container .subsubhead {
            font-size: 1.05em;
            text-align: center;
            font-weight: bold;
            margin: 0.6em 0 0.3em 0;
        }

        .reader-container .bodytext {
            text-indent: 2em;
        }

        .reader-container .hangnum {
            text-indent: -2em;
            padding-left: 2em;
        }

        .reader-container .gatha1 {
            padding-left: 3em;
            text-indent: -1em;
            margin-bottom: 0.25em;
        }

        .reader-container .gatha2 {
            padding-left: 3em;
            text-indent: -1em;
            margin-bottom: 0.25em;
        }

        .reader-container .gatha3 {
            padding-left: 3em;
            text-indent: -1em;
            margin-bottom: 0.25em;
        }

        .reader-container .gathalast {
            padding-left: 3em;
            text-indent: -1em;
            margin-bottom: 1.2em;
        }

        .reader-container .unindented {
            text-indent: 0;
        }

        .reader-container .centered {
            text-align: center;
            text-indent: 0;
        }

        .reader-container strong.bld {
            font-weight: 700;
        }

        .reader-container strong.paranum {
            font-weight: 700;
            color: var(--accent);
            margin-right: 6px;
        }

        .reader-container span.dot {
            margin-right: 4px;
        }

        .reader-container span.pb {
            font-size: 0.72em;
            font-family: var(--font-ui);
            color: var(--text-muted);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 1px 4px;
            margin: 0 4px;
            vertical-align: 2px;
            background: var(--bg-secondary);
            user-select: none;
        }

        .reader-container span.note {
            font-size: 0.78em;
            color: var(--text-muted);
            vertical-align: super;
            cursor: pointer;
            margin: 0 2px;
        }

        /* Chapter Divider Marker */
        .chapter-divider {
            margin: 48px 0 24px 0;
            padding-top: 24px;
            border-top: 1px dashed var(--border-color);
            text-align: center;
        }

        .chapter-badge {
            display: inline-block;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.8px;
            padding: 3px 10px;
            border-radius: 12px;
            background: var(--accent-light);
            color: var(--accent);
            margin-bottom: 8px;
            font-family: var(--font-ui);
        }

        .chapter-heading-text {
            font-size: 1.35em;
            font-weight: bold;
            color: var(--text-primary);
        }

        /* Highlight Animations */
        .pulse-highlight {
            animation: pulseBg 2.5s ease-out;
            border-radius: 6px;
        }

        @keyframes pulseBg {
            0% {
                background-color: var(--highlight-bg);
                outline: 3px solid var(--accent);
            }
            70% {
                background-color: var(--highlight-bg);
                outline: 2px solid var(--accent-light);
            }
            100% {
                background-color: transparent;
                outline: none;
            }
        }

        mark.search-hit {
            background-color: #ffd54f;
            color: #000;
            padding: 1px 3px;
            border-radius: 2px;
            font-weight: 600;
        }

        /* Empty / Welcome State */
        .welcome-view {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 70px 20px;
            text-align: center;
            max-width: 680px;
            margin: 0 auto;
        }

        .welcome-icon {
            font-size: 50px;
            margin-bottom: 14px;
        }

        .welcome-title {
            font-size: 24px;
            font-weight: 700;
            color: var(--accent);
            margin-bottom: 8px;
        }

        .welcome-desc {
            font-size: 14px;
            color: var(--text-secondary);
            line-height: 1.6;
            margin-bottom: 24px;
        }

        .category-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
            gap: 12px;
            width: 100%;
        }

        .category-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 14px;
            text-align: left;
            cursor: pointer;
            transition: all 0.15s ease;
        }

        .category-card:hover {
            border-color: var(--accent);
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0,0,0,0.05);
        }

        .category-card h3 {
            font-size: 14px;
            color: var(--accent);
            margin-bottom: 4px;
        }

        .category-card p {
            font-size: 12px;
            color: var(--text-secondary);
            line-height: 1.4;
        }

        /* Bottom Footer Bar */
        footer.app-footer {
            height: var(--footer-height);
            background: var(--bg-secondary);
            border-top: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 16px;
            font-size: 12px;
            color: var(--text-secondary);
            flex-shrink: 0;
            z-index: 95;
            user-select: none;
        }

        .footer-left {
            display: flex;
            align-items: center;
            gap: 8px;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
        }

        .footer-book-title {
            font-weight: 600;
            color: var(--text-primary);
        }

        .footer-chap-name {
            color: var(--accent);
            font-weight: 500;
        }

        .footer-center {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .footer-nav-btn {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 2px 8px;
            font-size: 11.5px;
            color: var(--text-primary);
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.12s ease;
        }

        .footer-nav-btn:hover:not(:disabled) {
            border-color: var(--accent);
            color: var(--accent);
        }

        .footer-nav-btn:disabled {
            opacity: 0.45;
            cursor: not-allowed;
        }

        .footer-right {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .footer-badge {
            font-size: 11px;
            padding: 1px 6px;
            border-radius: 10px;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            color: var(--text-muted);
        }

        /* Search Overlay Modal */
        .modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.45);
            backdrop-filter: blur(4px);
            z-index: 1000;
            display: none;
            align-items: flex-start;
            justify-content: center;
            padding-top: 60px;
        }

        .modal-overlay.active {
            display: flex;
        }

        .modal-card {
            background: var(--bg-primary);
            border: 1px solid var(--border-color);
            border-radius: 12px;
            width: 90%;
            max-width: 680px;
            max-height: 80vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 16px 40px rgba(0,0,0,0.2);
            overflow: hidden;
        }

        .modal-header {
            padding: 14px 18px;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: center;
            gap: 12px;
            background: var(--bg-secondary);
        }

        .modal-header input {
            flex: 1;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 9px 14px;
            font-size: 14.5px;
            color: var(--text-primary);
            outline: none;
        }

        .modal-header input:focus {
            border-color: var(--accent);
        }

        .modal-body {
            flex: 1;
            overflow-y: auto;
            padding: 12px;
        }

        .search-result-item {
            padding: 11px 13px;
            border-radius: 7px;
            border: 1px solid transparent;
            cursor: pointer;
            margin-bottom: 6px;
            transition: all 0.12s ease;
        }

        .search-result-item:hover {
            background: var(--bg-secondary);
            border-color: var(--border-color);
        }

        .result-meta {
            font-size: 12px;
            font-weight: 600;
            color: var(--accent);
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .result-snippet {
            font-family: var(--font-reader);
            font-size: 14.5px;
            line-height: 1.5;
            color: var(--text-primary);
        }

        .result-snippet mark {
            background: #ffd54f;
            color: #000;
            padding: 0 2px;
            border-radius: 2px;
            font-weight: 600;
        }

        /* Floating Toggle Header & Footer Button (Zen Reading Mode) */
        .floating-toggle-btn {
            position: fixed;
            bottom: 46px;
            right: 24px;
            width: 38px;
            height: 38px;
            border-radius: 50%;
            background: var(--accent);
            color: #ffffff;
            border: none;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 17px;
            z-index: 99;
            transition: transform 0.2s ease, opacity 0.2s ease, background 0.2s ease;
            opacity: 0.85;
            user-select: none;
        }

        body.zen-mode .floating-toggle-btn {
            bottom: 20px;
            right: 20px;
            opacity: 0.95;
        }

        .floating-toggle-btn:hover {
            transform: scale(1.08);
            opacity: 1;
            background: var(--accent-hover);
        }

        /* Loading Spinner */
        .loading-view {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            gap: 12px;
            color: var(--text-secondary);
        }

        .spinner {
            width: 30px;
            height: 30px;
            border: 3px solid var(--border-color);
            border-top-color: var(--accent);
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        @media (max-width: 768px) {
            aside.app-sidebar {
                position: fixed;
                height: calc(100vh - var(--header-height) - var(--footer-height));
                top: var(--header-height);
                left: 0;
                width: 84vw;
                max-width: 320px;
                z-index: 50;
                box-shadow: 4px 0 24px rgba(0, 0, 0, 0.25);
            }
            body.zen-mode aside.app-sidebar {
                height: 100vh;
                top: 0;
            }
            aside.app-sidebar.collapsed {
                transform: translateX(-100%);
                width: 0;
                pointer-events: none;
            }
            .reader-container {
                padding: 16px 12px 64px 12px;
            }
            .reader-container .book {
                font-size: 1.5em;
                margin: 0.8em 0 0.3em 0;
            }
            .reader-container .chapter {
                font-size: 1.25em;
                margin: 0.8em 0 0.4em 0;
            }
            .reader-container .title {
                font-size: 1.15em;
                margin: 0.7em 0 0.3em 0;
            }
            .chapter-pills-bar {
                padding: 5px 10px;
                gap: 4px;
            }
            .chapter-pill {
                font-size: 10.5px;
                padding: 2px 8px;
            }
            .modal-card {
                width: 95%;
                max-height: 85vh;
            }
            .hide-btn-desktop {
                display: none !important;
            }
            .close-btn-mobile {
                display: inline-flex !important;
            }
        }
        @media (min-width: 769px) {
            .close-btn-mobile {
                display: none !important;
            }
        }
    </style>
</head>
<body>
    <!-- Top Header -->
    <header class="app-header">
        <div class="header-left">
            <button class="btn-icon" id="toggleSidebarBtn" title="Toggle Navigation Tree (Ctrl+B)">
                ☰
            </button>
            <a href="/" class="brand-title">
                Tipiṭaka <span class="badge">Roman</span>
            </a>
        </div>

        <div class="header-center">
            <div class="search-box">
                <span class="search-icon">🔍</span>
                <input type="text" id="globalSearchInput" placeholder="Search 217 books (Press / or click)..." readonly>
            </div>
        </div>

        <div class="header-right">
            <!-- Language & Script Selector -->
            <select class="theme-select" id="scriptSelect" title="Choose Pali Script / Language">
                <option value="roman">🌐 Pāḷi (Roman)</option>
                <option value="devanagari">🕉️ Devanagari (देवनागरी)</option>
                <option value="myanmar">🇲🇲 Myanmar (မြန်မာ)</option>
                <option value="sinhala">🇱🇰 Sinhala (සිංහල)</option>
                <option value="thai">🇹🇭 Thai (ไทย)</option>
                <option value="khmer">🇰🇭 Khmer (ភាសាខ្មែរ)</option>
            </select>

            <!-- Theme Selector -->
            <select class="theme-select" id="themeSelect" title="Select color theme">
                <option value="light">☀️ Light</option>
                <option value="sepia">📜 Sepia</option>
                <option value="dark">🌙 Dark</option>
            </select>
        </div>
    </header>

    <!-- Multi-Tab Books Bar -->
    <div class="book-tabs-bar" id="bookTabsBar">
        <div class="tabs-scroll-container" id="tabsScrollContainer">
            <!-- Dynamic Tabs Rendered Here -->
        </div>
        <button class="new-tab-btn" id="newTabBtn" title="Explore and open books from library" onclick="focusTreeSearch()">
            ＋ Open Book
        </button>
    </div>

    <!-- App Body Layout -->
    <div class="app-body">
        <!-- Sidebar Navigation Tree -->
        <aside class="app-sidebar" id="appSidebar">
            <div class="sidebar-header">
                <div class="sidebar-title-row">
                    <div class="sidebar-title">
                        <span>Navigation</span>
                        <span id="treeStats" style="font-size:11px; font-weight:normal; color:var(--text-muted);">217 books</span>
                    </div>
                    <div class="tree-actions">
                        <button class="tree-action-btn" id="treeToggleExpandBtn" title="Expand All Folders" onclick="toggleExpandAllTree()">⊞ Expand</button>
                        <button class="tree-action-btn hide-btn-desktop" id="treeHideAllBtn" title="Hide Navigation, Header & Footer (Zen Mode)" onclick="hideAllPanels()">◖ Hide</button>
                        <button class="tree-action-btn close-btn-mobile" title="Close Navigation" onclick="toggleSidebar()">✕</button>
                    </div>
                </div>
                <div class="sidebar-search">
                    <span class="icon">🔍</span>
                    <input type="text" id="treeFilterInput" placeholder="Filter books & chapters...">
                    <span class="clear-btn" id="clearTreeFilterBtn" onclick="clearTreeFilter()">✕</span>
                </div>
            </div>
            <div class="tree-container" id="treeContainer">
                <div class="loading-view">
                    <div class="spinner"></div>
                    <div>Loading Tipiṭaka tree...</div>
                </div>
            </div>
        </aside>

        <!-- Main Content Area -->
        <main class="content-area" id="contentArea">
            <div class="content-header" id="contentHeader" style="display:none;">
                <div class="breadcrumbs" id="breadcrumbs"></div>
            </div>

            <!-- Chapter Shortcuts Pills Bar -->
            <div class="chapter-pills-bar" id="chapterPillsBar" style="display:none;"></div>

            <!-- Main Reader Content Wrapper -->
            <div id="readerWrapper">
                <!-- Initial Welcome Screen -->
                <div class="welcome-view" id="welcomeView">
                    <div class="welcome-icon">🪷</div>
                    <h1 class="welcome-title">Chaṭṭha Saṅgāyana Tipiṭaka</h1>
                    <p class="welcome-desc">
                        Explore the complete Pali Canon in Roman Latin script. Select any book from the navigation tree on the left, open multiple books in tabs, or search across 520,000+ paragraphs.
                    </p>
                    <div class="category-grid">
                        <div class="category-card" onclick="openBookInTab('vin01m.mul')">
                            <h3>Vinayapiṭaka</h3>
                            <p>Pārājikapāḷi, Pācittiyapāḷi, Mahāvaggapāḷi, Cullavaggapāḷi, Parivārapāḷi</p>
                        </div>
                        <div class="category-card" onclick="openBookInTab('s0101m.mul')">
                            <h3>Dīghanikāya</h3>
                            <p>Sīlakkhandhavaggapāḷi, Mahāvaggapāḷi, Pāthikavaggapāḷi</p>
                        </div>
                        <div class="category-card" onclick="openBookInTab('s0201m.mul')">
                            <h3>Majjhimanikāya</h3>
                            <p>Mūlapaṇṇāsapāḷi, Majjhimapaṇṇāsapāḷi, Uparipaṇṇāsapāḷi</p>
                        </div>
                        <div class="category-card" onclick="openBookInTab('s0502m.mul')">
                            <h3>Dhammapadapāḷi</h3>
                            <p>Yamakavaggo, Appamādavaggo, Cittavaggo, Pupphavaggo, Bālavaggo</p>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    </div>

    <!-- Bottom Footer Bar -->
    <footer class="app-footer" id="appFooter">
        <div class="footer-left">
            <div class="control-group" style="margin-right:6px;">
                <button class="control-btn" id="fontDecBtn" title="Decrease font size" style="padding:1px 6px; font-size:11px; font-weight:bold;">A−</button>
                <span class="footer-badge" id="footerFontSizeBadge" style="margin:0 2px; font-weight:600; color:var(--accent);">18px</span>
                <button class="control-btn" id="fontIncBtn" title="Increase font size" style="padding:1px 6px; font-size:11px; font-weight:bold;">A+</button>
            </div>
        </div>

        <div class="footer-center">
            <button class="footer-nav-btn" id="footerPrevBtn" onclick="navigateChapterDelta(-1)" disabled>
                ◀ Prev
            </button>
            <span id="footerChapterCount" style="font-size:11.5px; font-weight:600; min-width:65px; text-align:center;">—</span>
            <button class="footer-nav-btn" id="footerNextBtn" onclick="navigateChapterDelta(1)" disabled>
                Next ▶
            </button>
        </div>

        <div class="footer-right">
            <button class="footer-nav-btn" onclick="openDictionaryModal()" title="Pāḷi Dictionary Look-up">
                📖 Dict
            </button>
            <button class="footer-nav-btn" onclick="openBookmarkModal()" title="Saved Bookmarks">
                🔖 Saved <span id="footerBookmarkCount" style="font-size:9.5px; opacity:0.8;"></span>
            </button>
            <button class="footer-nav-btn" id="bookTocBtn" onclick="toggleBookToc()" title="Open Book Table of Contents" style="font-weight:600; display:none;">
                📑 TOC <span id="footerTocCount" style="font-size:10px; opacity:0.75;"></span> ▴
            </button>
            <button class="footer-nav-btn" onclick="openHistoryModal()" title="Recent Reading History">
                🕒 History
            </button>
        </div>
    </footer>

    <!-- Bookmarks Modal -->
    <div class="modal-overlay" id="bookmarkModal" onclick="if(event.target === this) closeBookmarkModal()">
        <div class="modal-card" style="max-width: 480px;">
            <div class="modal-header">
                <span style="font-size:16px;">🔖</span>
                <div style="flex:1; margin-left:8px; font-weight:bold; font-size:13px;">Saved Bookmarks</div>
                <button class="modal-close-btn" onclick="closeBookmarkModal()">✕</button>
            </div>
            <div class="modal-body" id="bookmarkListContainer" style="max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
            </div>
        </div>
    </div>

    <!-- History Modal -->
    <div class="modal-overlay" id="historyModal" onclick="if(event.target === this) closeHistoryModal()">
        <div class="modal-card" style="max-width: 480px;">
            <div class="modal-header">
                <span style="font-size:16px;">🕒</span>
                <div style="flex:1; margin-left:8px; font-weight:bold; font-size:13px;">Recent Reading History</div>
                <button class="modal-close-btn" onclick="closeHistoryModal()">✕</button>
            </div>
            <div class="modal-body" id="historyListContainer" style="max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
            </div>
        </div>
    </div>

    <!-- Help Modal (Inside Settings) -->
    <div class="modal-overlay" id="helpModal" onclick="if(event.target === this) closeHelpModal()">
        <div class="modal-card" style="max-width: 480px;">
            <div class="modal-header">
                <span style="font-size:16px;">❓</span>
                <div style="flex:1; margin-left:8px; font-weight:bold; font-size:13px;">Tipiṭaka Reader — Help & Guide</div>
                <button class="btn-icon" onclick="closeHelpModal()" title="Close (Esc)">✕</button>
            </div>
            <div class="modal-body" style="padding: 16px; font-size:12px; line-height:1.6;">
                <div style="font-weight:bold; color:var(--accent); margin-bottom:8px;">⌨️ KEYBOARD SHORTCUTS</div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; margin-bottom:16px;">
                    <div style="background:var(--bg-secondary); padding:6px 10px; border-radius:6px; border:1px solid var(--border-color); display:flex; justify-content:space-between;">
                        <span>Search 217 Books</span> <kbd style="background:var(--bg-card); padding:1px 5px; border-radius:3px; font-weight:bold; color:var(--accent);">/</kbd>
                    </div>
                    <div style="background:var(--bg-secondary); padding:6px 10px; border-radius:6px; border:1px solid var(--border-color); display:flex; justify-content:space-between;">
                        <span>Toggle Nav Tree</span> <kbd style="background:var(--bg-card); padding:1px 5px; border-radius:3px; font-weight:bold; color:var(--accent);">Ctrl+B</kbd>
                    </div>
                </div>
                <div style="font-weight:bold; color:var(--accent); margin-bottom:8px;">📖 FEATURES</div>
                <ul style="padding-left:16px; margin:0; color:var(--text-secondary);">
                    <li><strong>Book TOC</strong>: Click Book TOC in the footer to browse chapters, suttas, and subheads with reading position tracking.</li>
                    <li><strong>Scripts</strong>: Switch between Roman Latin, Devanagari, Myanmar, Sinhala, and Thai in the header.</li>
                    <li><strong>Full-Text Search</strong>: Instant FTS5 search across all 520k paragraphs.</li>
                </ul>
            </div>
        </div>
    </div>

    <!-- Book Table of Contents Modal -->
    <div class="modal-overlay" id="bookTocModal" onclick="if(event.target === this) closeBookToc()">
        <div class="modal-card" style="max-width: 520px; max-height: 80vh; display: flex; flex-direction: column;">
            <div class="modal-header">
                <span style="font-size:16px;">📑</span>
                <div style="flex:1; margin-left:8px; font-weight:bold; font-size:13px;" id="bookTocTitle">Book Table of Contents</div>
                <button class="btn-icon" onclick="closeBookToc()" title="Close (Esc)">✕</button>
            </div>
            <div style="padding: 10px 16px; border-bottom: 1px solid var(--border-color); background: var(--bg-primary);">
                <input type="text" id="bookTocFilterInput" placeholder="Filter sections, suttas, subheads..." style="width:100%; padding:6px 10px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-card); color:var(--text-primary); font-size:12px; outline:none;" oninput="filterBookToc(this.value)">
            </div>
            <div class="modal-body" id="bookTocListContainer" style="max-height: 480px; overflow-y:auto; padding:8px;">
                <!-- Dynamic Hierarchical TOC items rendered here -->
            </div>
        </div>
    </div>

    <!-- Full-Text Search Modal -->
    <div class="modal-overlay" id="searchModal">
        <div class="modal-card">
            <div class="modal-header">
                <span style="font-size:18px;">🔍</span>
                <input type="text" id="modalSearchInput" placeholder="Search Pali words across all 217 books (e.g. kusalā, nibbāna)..." autocomplete="off">
                <button class="btn-icon" id="closeSearchModal" title="Close search (Esc)">✕</button>
            </div>
            <div class="modal-body" id="searchResultsContainer">
                <div style="text-align:center; padding: 30px; color: var(--text-muted); font-size: 14px;">
                    Type 2 or more characters to search the entire Tipiṭaka...
                </div>
            </div>
        </div>
    </div>

    <!-- Floating Toggle UI & Navigation Menu Button -->
    <button class="floating-toggle-btn" id="toggleHeaderFooterBtn" title="Toggle UI & Navigation (Zen Mode)" onclick="toggleHeaderFooterUI()">☰</button>

    <script>
        // State Management
        let treeData = [];
        let openTabs = []; // Array of { bookCode, title, nikaya, category, chapters, html, currentChapterIdx, scrollTop }
        let activeBookCode = null;
        let bookDataCache = {};
        let fontSize = parseInt(localStorage.getItem('tipitaka_font_size') || '18');
        let currentTheme = localStorage.getItem('tipitaka_theme') || 'light';
        let isTreeExpandedAll = false;

        // DOM Elements
        const body = document.body;
        const appSidebar = document.getElementById('appSidebar');
        const toggleSidebarBtn = document.getElementById('toggleSidebarBtn');
        const treeContainer = document.getElementById('treeContainer');
        const treeFilterInput = document.getElementById('treeFilterInput');
        const clearTreeFilterBtn = document.getElementById('clearTreeFilterBtn');
        const treeToggleExpandBtn = document.getElementById('treeToggleExpandBtn');
        const treeHideAllBtn = document.getElementById('treeHideAllBtn');
        const toggleHeaderFooterBtn = document.getElementById('toggleHeaderFooterBtn');
        const contentArea = document.getElementById('contentArea');
        const contentHeader = document.getElementById('contentHeader');
        const breadcrumbs = document.getElementById('breadcrumbs');
        const chapterPillsBar = document.getElementById('chapterPillsBar');
        const readerWrapper = document.getElementById('readerWrapper');
        const welcomeView = document.getElementById('welcomeView');
        const themeSelect = document.getElementById('themeSelect');
        const fontIncBtn = document.getElementById('fontIncBtn');
        const fontDecBtn = document.getElementById('fontDecBtn');
        const bookTabsBar = document.getElementById('bookTabsBar');
        const tabsScrollContainer = document.getElementById('tabsScrollContainer');

        // Footer Elements
        const footerBookTitle = document.getElementById('footerBookTitle');
        const footerChapName = document.getElementById('footerChapName');
        const footerChapterCount = document.getElementById('footerChapterCount');
        const footerPrevBtn = document.getElementById('footerPrevBtn');
        const footerNextBtn = document.getElementById('footerNextBtn');
        const footerFontSizeBadge = document.getElementById('footerFontSizeBadge');

        // Initialize Theme & Typography
        function applyTheme(theme) {
            currentTheme = theme;
            document.documentElement.setAttribute('data-theme', theme);
            themeSelect.value = theme;
            localStorage.setItem('tipitaka_theme', theme);
        }

        function applyFontSize(size) {
            fontSize = Math.min(28, Math.max(14, size));
            document.documentElement.style.setProperty('--font-size-base', fontSize + 'px');
            if (footerFontSizeBadge) footerFontSizeBadge.textContent = fontSize + 'px';
            localStorage.setItem('tipitaka_font_size', fontSize);
        }

        applyTheme(currentTheme);
        applyFontSize(fontSize);

        themeSelect.onchange = (e) => applyTheme(e.target.value);
        fontIncBtn.onclick = () => applyFontSize(fontSize + 1);
        fontDecBtn.onclick = () => applyFontSize(fontSize - 1);

        // Sidebar Toggle
        toggleSidebarBtn.onclick = () => appSidebar.classList.toggle('collapsed');
        window.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                e.preventDefault();
                appSidebar.classList.toggle('collapsed');
            }
        });

        // Content Area Scroll Tracking
        contentArea.onscroll = () => {
            // Save scroll position for active tab
            const activeTab = openTabs.find(t => t.bookCode === activeBookCode);
            if (activeTab) {
                activeTab.scrollTop = contentArea.scrollTop;
            }
        };

        // Toggle UI & Navigation Menu (Header, Footer, and Navigation Sidebar)
        function toggleHeaderFooterUI() {
            const isHidden = document.body.classList.contains('zen-mode') || appSidebar.classList.contains('collapsed');
            if (isHidden) {
                // Restore everything
                document.body.classList.remove('zen-mode');
                appSidebar.classList.remove('collapsed');
                if (toggleHeaderFooterBtn) {
                    toggleHeaderFooterBtn.title = 'Hide UI & Navigation (Zen Mode)';
                }
            } else {
                // Hide everything
                document.body.classList.add('zen-mode');
                appSidebar.classList.add('collapsed');
                if (toggleHeaderFooterBtn) {
                    toggleHeaderFooterBtn.title = 'Show UI & Navigation';
                }
            }
        }

        // Hide All Panels: Collapses Sidebar and Hides Header & Footer together
        function hideAllPanels() {
            appSidebar.classList.add('collapsed');
            document.body.classList.add('zen-mode');
            if (toggleHeaderFooterBtn) {
                toggleHeaderFooterBtn.title = 'Show UI & Navigation';
            }
        }

        // Expand / Collapse Toggle for Tree
        function toggleExpandAllTree() {
            isTreeExpandedAll = !isTreeExpandedAll;
            document.querySelectorAll('.tree-children').forEach(el => {
                el.classList.toggle('show', isTreeExpandedAll);
            });
            document.querySelectorAll('.tree-expander').forEach(el => {
                el.classList.toggle('expanded', isTreeExpandedAll);
            });
            if (treeToggleExpandBtn) {
                treeToggleExpandBtn.textContent = isTreeExpandedAll ? '⊟ Collapse' : '⊞ Expand';
                treeToggleExpandBtn.title = isTreeExpandedAll ? 'Collapse All Folders' : 'Expand All Folders';
            }
        }

        function focusTreeSearch() {
            if (appSidebar.classList.contains('collapsed')) {
                appSidebar.classList.remove('collapsed');
            }
            treeFilterInput.focus();
        }

        function clearTreeFilter() {
            treeFilterInput.value = '';
            clearTreeFilterBtn.style.display = 'none';
            renderTree(treeData);
        }

        // Horizontal mouse wheel scrolling for Tabs Bar
        bookTabsBar.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                bookTabsBar.scrollLeft += e.deltaY;
            }
        });

        // =========================================================================
        // Load and Render Navigation Tree with Elevated Readability
        // =========================================================================
        async function loadTree() {
            try {
                const res = await fetch('/api/tree');
                treeData = await res.json();
                renderTree(treeData);
                handleUrlParamsOnLoad();
            } catch (err) {
                treeContainer.innerHTML = `<div style="padding:20px; color:var(--accent);">Failed to load navigation tree: ${err.message}</div>`;
            }
        }

        function renderTree(nodes, filterText = '') {
            treeContainer.innerHTML = '';
            const frag = document.createDocumentFragment();

            function buildNode(node, depth = 0) {
                const isFiltered = filterText.length > 0;
                const matches = !filterText || node.text.toLowerCase().includes(filterText.toLowerCase());

                const nodeEl = document.createElement('div');
                nodeEl.className = `tree-node level-${Math.min(depth, 3)}`;
                nodeEl.dataset.nodeId = node.id;

                const rowEl = document.createElement('div');
                rowEl.className = 'tree-row';

                const hasChildren = node.children && node.children.length > 0;
                const href = node.a_attr?.href || node.href || '';

                let nodeBookCode = null;
                let nodeChapterIdx = null;
                let isChapterNode = false;
                let isBookNode = false;

                if (href && href.startsWith('cscd/')) {
                    const m = href.match(/cscd\/([a-z0-9\._]+?)(?:(\d+))?\.xml/i);
                    if (m) {
                        nodeBookCode = m[1];
                        if (m[2] !== undefined) {
                            nodeChapterIdx = parseInt(m[2]);
                            isChapterNode = true;
                        } else {
                            isBookNode = true;
                        }
                    }
                } else if (hasChildren) {
                    // Check if direct children have cscd/ hrefs (identifies a Book folder)
                    for (const c of node.children) {
                        const chHref = c.a_attr?.href || c.href || '';
                        if (chHref.startsWith('cscd/')) {
                            const m = chHref.match(/cscd\/([a-z0-9\._]+?)(?:(\d+))?\.xml/i);
                            if (m) {
                                nodeBookCode = m[1];
                                isBookNode = true;
                                break;
                            }
                        }
                    }
                }

                if (nodeBookCode) nodeEl.dataset.bookCode = nodeBookCode;
                if (nodeChapterIdx !== null) nodeEl.dataset.chapterIdx = nodeChapterIdx;
                if (isBookNode) nodeEl.dataset.isBook = 'true';

                if (isBookNode) rowEl.classList.add('is-book');
                if (isChapterNode) rowEl.classList.add('is-chapter');

                // Expander chevron arrow
                const expanderEl = document.createElement('span');
                expanderEl.className = 'tree-expander';
                expanderEl.textContent = hasChildren ? '▶' : '';
                rowEl.appendChild(expanderEl);

                // Hierarchical Icon
                const iconEl = document.createElement('span');
                iconEl.className = 'tree-icon';
                if (depth === 0) {
                    iconEl.textContent = '📚';
                } else if (isBookNode) {
                    iconEl.textContent = '📖';
                } else if (isChapterNode) {
                    iconEl.textContent = '📄';
                    iconEl.style.fontSize = '12px';
                    iconEl.style.opacity = '0.7';
                } else if (depth === 1) {
                    iconEl.textContent = '🏛️';
                } else {
                    iconEl.textContent = hasChildren ? '📁' : '📄';
                }
                rowEl.appendChild(iconEl);

                // Node Title Text
                const textEl = document.createElement('span');
                textEl.className = 'tree-text';
                textEl.textContent = node.text;
                rowEl.appendChild(textEl);

                // Book chapter count badge
                if (isBookNode && hasChildren) {
                    const badgeEl = document.createElement('span');
                    badgeEl.className = 'tree-badge';
                    badgeEl.textContent = `${node.children.length} ch`;
                    rowEl.appendChild(badgeEl);
                }

                nodeEl.appendChild(rowEl);

                // Children Container
                let childrenContainer = null;
                if (hasChildren) {
                    childrenContainer = document.createElement('div');
                    const shouldShow = isFiltered || isTreeExpandedAll;
                    childrenContainer.className = 'tree-children' + (shouldShow ? ' show' : '');
                    if (shouldShow) expanderEl.classList.add('expanded');

                    let anyChildVisible = false;
                    node.children.forEach(child => {
                        const childEl = buildNode(child, depth + 1);
                        if (childEl) {
                            childrenContainer.appendChild(childEl);
                            anyChildVisible = true;
                        }
                    });

                    nodeEl.appendChild(childrenContainer);
                    if (isFiltered && !matches && !anyChildVisible) return null;
                } else if (isFiltered && !matches) {
                    return null;
                }

                // Click Handlers
                rowEl.onclick = async (e) => {
                    e.stopPropagation();

                    // 1. Book folder clicked:
                    if (isBookNode && nodeBookCode) {
                        if (childrenContainer) {
                            childrenContainer.classList.add('show');
                            expanderEl.classList.add('expanded');
                        }
                        if (window.innerWidth < 768) {
                            appSidebar.classList.add('collapsed');
                        }
                        await openBookInTab(nodeBookCode, { targetChapterIdx: 0 });
                        return;
                    }

                    // 2. Chapter leaf clicked:
                    if (isChapterNode && nodeBookCode) {
                        if (window.innerWidth < 768) {
                            appSidebar.classList.add('collapsed');
                        }
                        await openBookInTab(nodeBookCode, { targetChapterIdx: nodeChapterIdx || 0 });
                        return;
                    }

                    // 3. Category folder clicked:
                    if (hasChildren) {
                        const isExpanded = childrenContainer.classList.toggle('show');
                        expanderEl.classList.toggle('expanded', isExpanded);
                    }
                };

                return nodeEl;
            }

            nodes.forEach(node => {
                const el = buildNode(node, 0);
                if (el) frag.appendChild(el);
            });

            treeContainer.appendChild(frag);

            // Re-sync tree if a book is already active
            if (activeBookCode) {
                const activeTab = openTabs.find(t => t.bookCode === activeBookCode);
                syncTreeToActiveBookAndChapter(activeBookCode, activeTab?.currentChapterIdx || 0);
            }
        }

        // Live Tree Filtering
        let treeFilterDebounce = null;
        treeFilterInput.oninput = (e) => {
            const query = e.target.value.trim();
            clearTreeFilterBtn.style.display = query ? 'block' : 'none';
            if (treeFilterDebounce) clearTimeout(treeFilterDebounce);
            treeFilterDebounce = setTimeout(() => {
                renderTree(treeData, query);
            }, 180);
        };

        // =========================================================================
        // Tree Synchronization & Expansion (Highlighting Active Book/Chapter)
        // =========================================================================
        function syncTreeToActiveBookAndChapter(bookCode, chapterIdx = 0) {
            if (!bookCode) return;

            // Remove active classes from previous tree items
            document.querySelectorAll('.tree-row.active, .tree-row.active-book, .tree-row.active-chapter').forEach(r => {
                r.classList.remove('active', 'active-book', 'active-chapter');
            });

            // Locate book node in tree
            const bookNodeEl = document.querySelector(`.tree-node[data-book-code="${bookCode}"][data-is-book="true"]`) ||
                               document.querySelector(`.tree-node[data-book-code="${bookCode}"]`);

            if (bookNodeEl) {
                const bookRow = bookNodeEl.querySelector(':scope > .tree-row');
                if (bookRow) {
                    bookRow.classList.add('active', 'active-book');
                }

                // Expand the book node itself to show chapter shortcuts
                const bookChildren = bookNodeEl.querySelector(':scope > .tree-children');
                const bookExpander = bookNodeEl.querySelector(':scope > .tree-row > .tree-expander');
                if (bookChildren) {
                    bookChildren.classList.add('show');
                    if (bookExpander) bookExpander.classList.add('expanded');
                }

                // Expand all ancestor parent folders up to the root
                let parent = bookNodeEl.parentElement;
                while (parent && parent !== treeContainer) {
                    if (parent.classList.contains('tree-children')) {
                        parent.classList.add('show');
                        const parentNode = parent.closest('.tree-node');
                        if (parentNode) {
                            const exp = parentNode.querySelector(':scope > .tree-row > .tree-expander');
                            if (exp) exp.classList.add('expanded');
                        }
                    }
                    parent = parent.parentElement;
                }

                // If chapterIdx is specified, highlight the chapter leaf
                if (chapterIdx !== undefined && chapterIdx !== null) {
                    const chapNodeEl = bookNodeEl.querySelector(`.tree-node[data-chapter-idx="${chapterIdx}"]`);
                    if (chapNodeEl) {
                        const chapRow = chapNodeEl.querySelector(':scope > .tree-row');
                        if (chapRow) {
                            chapRow.classList.add('active', 'active-chapter');
                        }
                    }
                }

                // Scroll the sidebar tree so the active book is visible
                if (bookRow) {
                    const sidebarRect = treeContainer.getBoundingClientRect();
                    const rowRect = bookRow.getBoundingClientRect();
                    if (rowRect.top < sidebarRect.top || rowRect.bottom > sidebarRect.bottom) {
                        bookRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                }
            }
        }

        // =========================================================================
        // Tab Management Logic
        // =========================================================================
        function renderTabs() {
            tabsScrollContainer.innerHTML = '';

            openTabs.forEach((tab) => {
                const tabEl = document.createElement('div');
                tabEl.className = 'book-tab' + (tab.bookCode === activeBookCode ? ' active' : '');
                tabEl.dataset.bookCode = tab.bookCode;
                tabEl.title = `${tab.title} (${tab.bookCode})`;

                tabEl.innerHTML = `
                    <span class="tab-icon">📖</span>
                    <span class="tab-title">${tab.title}</span>
                    <button class="tab-close-btn" title="Close tab (Middle click)" onclick="closeTab('${tab.bookCode}', event)">×</button>
                `;

                tabEl.onclick = (e) => {
                    if (e.target.classList.contains('tab-close-btn')) return;
                    switchTab(tab.bookCode);
                };

                tabEl.onauxclick = (e) => {
                    if (e.button === 1) { // Middle click to close tab
                        e.preventDefault();
                        closeTab(tab.bookCode, e);
                    }
                };

                tabsScrollContainer.appendChild(tabEl);
            });

            // Scroll active tab into view
            const activeTabEl = tabsScrollContainer.querySelector('.book-tab.active');
            if (activeTabEl) {
                activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
            }
        }

        let chapterObserver = null;

        async function loadChapterForTab(bookCode, chapIdx) {
            let tab = openTabs.find(t => t.bookCode === bookCode);
            if (!tab || !tab.chapters || tab.loadedChapters[chapIdx] || tab.loadingChapters[chapIdx]) return;

            tab.loadingChapters[chapIdx] = true;
            const placeholderEl = document.getElementById(`chap-${chapIdx}`);
            if (placeholderEl && placeholderEl.querySelector('.chapter-placeholder-loading')) {
                placeholderEl.querySelector('.chapter-placeholder-loading').style.display = 'flex';
            }

            try {
                const res = await fetch(`/api/book/${encodeURIComponent(bookCode)}/chapter/${chapIdx}`);
                const data = await res.json();
                if (data.html) {
                    tab.loadedChapters[chapIdx] = data.html;
                    tab.loadingChapters[chapIdx] = false;

                    // If active tab, update DOM slot
                    if (activeBookCode === bookCode) {
                        const slot = document.getElementById(`chap-slot-${chapIdx}`);
                        if (slot) {
                            slot.innerHTML = data.html;
                        }
                    }
                }
            } catch (err) {
                console.warn(`[LazyLoad] Error loading chapter ${chapIdx}:`, err);
                tab.loadingChapters[chapIdx] = false;
            }
        }

        function bufferAdjacentChapters(bookCode, centerIdx) {
            const tab = openTabs.find(t => t.bookCode === bookCode);
            if (!tab || !tab.chapters) return;

            const total = tab.chapters.length;
            const toBuffer = [centerIdx + 1, centerIdx - 1, centerIdx + 2];
            toBuffer.forEach(idx => {
                if (idx >= 0 && idx < total && !tab.loadedChapters[idx] && !tab.loadingChapters[idx]) {
                    setTimeout(() => {
                        loadChapterForTab(bookCode, idx);
                    }, 80);
                }
            });
        }

        async function openBookInTab(bookCode, options = {}) {
            let tab = openTabs.find(t => t.bookCode === bookCode);
            const targetChap = options.targetChapterIdx !== undefined ? options.targetChapterIdx : 0;

            if (!tab) {
                if (openTabs.length === 0) {
                    contentHeader.style.display = 'flex';
                    chapterPillsBar.style.display = 'none';
                    readerWrapper.innerHTML = `
                        <div class="loading-view">
                            <div class="spinner"></div>
                            <div>Opening book (${bookCode})...</div>
                        </div>`;
                }

                try {
                    const res = await fetch(`/api/book/${encodeURIComponent(bookCode)}?chapter=${targetChap}&buffer=1`);
                    const bookData = await res.json();
                    if (bookData.error) {
                        alert(bookData.error);
                        return;
                    }

                    tab = {
                        bookCode: bookData.code,
                        title: bookData.title,
                        nikaya: bookData.nikaya || bookData.category || '',
                        category: bookData.category || '',
                        chapters: bookData.chapters || [],
                        toc: bookData.toc || [],
                        loadedChapters: { ...bookData.chapters_data },
                        loadingChapters: {},
                        currentChapterIdx: targetChap,
                        scrollTop: 0
                    };

                    openTabs.push(tab);
                } catch (err) {
                    alert(`Failed to load book: ${err.message}`);
                    return;
                }
            } else {
                tab.currentChapterIdx = targetChap;
                if (!tab.loadedChapters[targetChap]) {
                    loadChapterForTab(bookCode, targetChap);
                }
            }

            activeBookCode = bookCode;
            renderTabs();
            renderActiveTabContent();

            bufferAdjacentChapters(bookCode, targetChap);

            // Sync navigation tree and expand active book/chapter
            syncTreeToActiveBookAndChapter(bookCode, targetChap);

            // Perform targeted scroll
            if (options.targetParaIndex !== undefined && options.targetParaIndex !== null && options.targetParaIndex !== '') {
                scrollToParagraphAccurately(options.targetParaIndex, options.targetParaNum, options.highlightQuery);
            } else if (options.targetChapterIdx !== undefined) {
                scrollToChapterAccurately(options.targetChapterIdx);
            } else {
                contentArea.scrollTo({ top: tab.scrollTop || 0, behavior: 'smooth' });
            }

            // Update footer bar info
            updateFooterBar(tab);

            // Update browser URL query without reload (1-based chapter index)
            updateUrlParams({ book: bookCode, chapter: (tab.currentChapterIdx || 0) + 1 });
        }

        function switchTab(bookCode) {
            if (activeBookCode === bookCode) return;

            const currentTab = openTabs.find(t => t.bookCode === activeBookCode);
            if (currentTab) {
                currentTab.scrollTop = contentArea.scrollTop;
            }

            activeBookCode = bookCode;
            renderTabs();
            renderActiveTabContent();

            const tab = openTabs.find(t => t.bookCode === bookCode);
            if (tab) {
                contentArea.scrollTo({ top: tab.scrollTop || 0, behavior: 'smooth' });
                syncTreeToActiveBookAndChapter(bookCode, tab.currentChapterIdx);
                updateFooterBar(tab);
                updateUrlParams({ book: bookCode, chapter: (tab.currentChapterIdx || 0) + 1 });
            }
        }

        function closeTab(bookCode, event) {
            if (event) event.stopPropagation();

            const tabIdx = openTabs.findIndex(t => t.bookCode === bookCode);
            if (tabIdx === -1) return;

            openTabs.splice(tabIdx, 1);

            if (activeBookCode === bookCode) {
                if (openTabs.length > 0) {
                    const nextTab = openTabs[Math.max(0, tabIdx - 1)];
                    activeBookCode = nextTab.bookCode;
                    renderTabs();
                    renderActiveTabContent();
                    contentArea.scrollTo({ top: nextTab.scrollTop || 0, behavior: 'smooth' });
                    syncTreeToActiveBookAndChapter(activeBookCode, nextTab.currentChapterIdx);
                    updateFooterBar(nextTab);
                    updateUrlParams({ book: activeBookCode, chapter: (nextTab.currentChapterIdx || 0) + 1 });
                } else {
                    activeBookCode = null;
                    renderTabs();
                    showWelcomeScreen();
                    document.querySelectorAll('.tree-row.active, .tree-row.active-book, .tree-row.active-chapter').forEach(r => {
                        r.classList.remove('active', 'active-book', 'active-chapter');
                    });
                    resetFooterBar();
                    updateUrlParams({ book: null, chapter: null });
                }
            } else {
                renderTabs();
            }
        }

        function showWelcomeScreen() {
            contentHeader.style.display = 'none';
            chapterPillsBar.style.display = 'none';
            readerWrapper.innerHTML = `
                <div class="welcome-view">
                    <div class="welcome-icon">🪷</div>
                    <h1 class="welcome-title">Chaṭṭha Saṅgāyana Tipiṭaka</h1>
                    <p class="welcome-desc">
                        No books currently open. Select a book from the navigation tree on the left, use the search bar above, or choose a quick start below:
                    </p>
                    <div class="category-grid">
                        <div class="category-card" onclick="openBookInTab('vin01m.mul')">
                            <h3>Vinayapiṭaka</h3>
                            <p>Pārājikapāḷi, Pācittiyapāḷi, Mahāvaggapāḷi, Cullavaggapāḷi, Parivārapāḷi</p>
                        </div>
                        <div class="category-card" onclick="openBookInTab('s0101m.mul')">
                            <h3>Dīghanikāya</h3>
                            <p>Sīlakkhandhavaggapāḷi, Mahāvaggapāḷi, Pāthikavaggapāḷi</p>
                        </div>
                        <div class="category-card" onclick="openBookInTab('s0201m.mul')">
                            <h3>Majjhimanikāya</h3>
                            <p>Mūlapaṇṇāsapāḷi, Majjhimapaṇṇāsapāḷi, Uparipaṇṇāsapāḷi</p>
                        </div>
                        <div class="category-card" onclick="openBookInTab('s0502m.mul')">
                            <h3>Dhammapadapāḷi</h3>
                            <p>Yamakavaggo, Appamādavaggo, Cittavaggo, Pupphavaggo, Bālavaggo</p>
                        </div>
                    </div>
                </div>
            `;
            resetFooterBar();
        }

        function renderActiveTabContent() {
            const tab = openTabs.find(t => t.bookCode === activeBookCode);
            if (!tab) {
                showWelcomeScreen();
                return;
            }

            contentHeader.style.display = 'flex';
            updateBreadcrumb(tab, tab.chapters[tab.currentChapterIdx]?.title || '');

            // Render Chapter Shortcuts Pills Bar
            if (tab.chapters && tab.chapters.length > 1) {
                chapterPillsBar.style.display = 'flex';
                chapterPillsBar.innerHTML = tab.chapters.map((chap, i) => `
                    <div class="chapter-pill ${i === tab.currentChapterIdx ? 'active' : ''}" 
                         onclick="scrollToChapterAccurately(${i})">
                        ${chap.title || `Chapter ${i + 1}`}
                    </div>
                `).join('');
            } else {
                chapterPillsBar.style.display = 'none';
            }

            // Render Streamed Chapter Slots
            if (tab.chapters && tab.chapters.length > 0) {
                const slotsHtml = tab.chapters.map(c => {
                    const isLoaded = Boolean(tab.loadedChapters[c.chapter_index]);
                    if (isLoaded) {
                        return `<div id="chap-slot-${c.chapter_index}">${tab.loadedChapters[c.chapter_index]}</div>`;
                    }
                    return `
                        <div id="chap-slot-${c.chapter_index}">
                            <div id="chap-${c.chapter_index}" class="chapter-placeholder" style="padding:40px 20px; margin:30px 0; border:1px dashed var(--border-color); border-radius:12px; text-align:center; background:var(--bg-secondary);">
                                <div style="font-size:11px; font-weight:600; color:var(--accent); margin-bottom:4px;">Chapter ${c.chapter_index + 1}</div>
                                <h3 style="font-size:15px; font-weight:bold; margin-bottom:8px; color:var(--text-primary);">${c.title}</h3>
                                <div class="chapter-placeholder-loading" style="display:${tab.loadingChapters[c.chapter_index] ? 'flex' : 'none'}; align-items:center; justify-content:center; gap:8px; font-size:11.5px; color:var(--text-muted);">
                                    <div class="spinner" style="width:14px; height:14px; border-width:2px;"></div>
                                    <span>Buffering chapter text...</span>
                                </div>
                                <button style="display:${tab.loadingChapters[c.chapter_index] ? 'none' : 'inline-block'}; font-size:11px; padding:4px 10px; border-radius:6px; background:var(--bg-card); border:1px solid var(--border-color); color:var(--text-secondary); cursor:pointer;" onclick="loadChapterForTab('${tab.bookCode}', ${c.chapter_index})">Load Chapter ${c.chapter_index + 1}</button>
                            </div>
                        </div>
                    `;
                }).join('');

                readerWrapper.innerHTML = `<div class="reader-container">${slotsHtml}</div>`;

                // Set up IntersectionObserver for unbuffered chapters
                if (chapterObserver) chapterObserver.disconnect();
                chapterObserver = new IntersectionObserver((entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting) {
                            const chapIdx = parseInt(entry.target.getAttribute('data-chapter-index'), 10);
                            if (!isNaN(chapIdx)) {
                                loadChapterForTab(activeBookCode, chapIdx);
                                bufferAdjacentChapters(activeBookCode, chapIdx);
                            }
                        }
                    });
                }, { rootMargin: '800px 0px' });

                tab.chapters.forEach(c => {
                    if (!tab.loadedChapters[c.chapter_index]) {
                        const el = document.getElementById(`chap-${c.chapter_index}`);
                        if (el) {
                            el.setAttribute('data-chapter-index', c.chapter_index);
                            chapterObserver.observe(el);
                        }
                    }
                });
            } else {
                readerWrapper.innerHTML = `<div class="reader-container">${tab.html || ''}</div>`;
            }

            updateFooterBar(tab);
        }

        // =========================================================================
        // Accurate Scrolling & Highlighting
        // =========================================================================
        function scrollToChapterAccurately(chapIdx) {
            const tab = openTabs.find(t => t.bookCode === activeBookCode);
            if (tab) tab.currentChapterIdx = chapIdx;

            // Update active pill
            document.querySelectorAll('.chapter-pill').forEach((pill, i) => {
                pill.classList.toggle('active', i === chapIdx);
            });

            // Chapter 0: scroll to top of book
            if (chapIdx === 0) {
                contentArea.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
                const target = document.getElementById(`chap-${chapIdx}`);
                if (target) {
                    const rect = target.getBoundingClientRect();
                    const currentScroll = contentArea.scrollTop;
                    const offset = rect.top + currentScroll - 80;

                    contentArea.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
                    target.classList.remove('pulse-highlight');
                    void target.offsetWidth; // trigger reflow
                    target.classList.add('pulse-highlight');
                } else {
                    contentArea.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }

            // Sync chapter highlight in sidebar tree and footer
            syncTreeToActiveBookAndChapter(activeBookCode, chapIdx);
            if (tab) updateFooterBar(tab);

            // 1-based index in URL
            updateUrlParams({ book: activeBookCode, chapter: chapIdx + 1 });
        }

        function scrollToParagraphAccurately(paraIndex, paraNum, highlightQuery) {
            setTimeout(() => {
                let el = null;
                // 1. Match by exact paraIndex
                if (paraIndex !== undefined && paraIndex !== null && paraIndex !== '') {
                    el = document.getElementById(`pindex-${paraIndex}`) ||
                         document.querySelector(`[data-pindex="${paraIndex}"]`);
                }
                // 2. Match by paraNum
                if (!el && paraNum) {
                    el = document.getElementById(`para-${paraNum}`) ||
                         document.querySelector(`[data-para="${paraNum}"]`);
                }

                if (el) {
                    const rect = el.getBoundingClientRect();
                    const currentScroll = contentArea.scrollTop;
                    const offset = rect.top + currentScroll - 90;

                    contentArea.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
                    el.classList.remove('pulse-highlight');
                    void el.offsetWidth; // trigger reflow
                    el.classList.add('pulse-highlight');

                    // Highlight matching search query keyword in element
                    if (highlightQuery && highlightQuery.trim().length > 1) {
                        highlightTextInElement(el, highlightQuery.trim());
                    }
                }
            }, 80);
        }

        function highlightTextInElement(element, query) {
            const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            function highlightNode(node) {
                if (node.nodeType === 3) { // Text node
                    const match = node.data.match(regex);
                    if (match) {
                        const span = document.createElement('span');
                        span.innerHTML = node.data.replace(regex, '<mark class="search-hit">$1</mark>');
                        node.parentNode.replaceChild(span, node);
                    }
                } else if (node.nodeType === 1 && node.nodeName !== 'MARK' && !node.classList.contains('pb')) {
                    Array.from(node.childNodes).forEach(highlightNode);
                }
            }
            highlightNode(element);
        }

        function capitalizePali(text) {
            if (!text || typeof text !== 'string') return text || '';
            return text.replace(/^([\s\d\.\-\(\)\[\]\/#:]*)([\p{L}])/u, (_, prefix, firstChar) => {
                return prefix + firstChar.toUpperCase();
            });
        }

        function updateBreadcrumb(tab, chapterTitle) {
            const nikaya = tab.nikaya || tab.category;
            const nikayaSpan = nikaya ? `<span>${capitalizePali(nikaya)}</span> <span>›</span> ` : '';
            const bTitle = capitalizePali(tab.title);
            const cTitle = chapterTitle ? capitalizePali(chapterTitle) : '';
            breadcrumbs.innerHTML = `
                ${nikayaSpan}
                <span class="current">${bTitle}</span>
                ${cTitle && cTitle !== bTitle ? `<span>›</span> <span>${cTitle}</span>` : ''}
            `;
        }

        // =========================================================================
        // Footer Bar Management & Book Table of Contents (TOC)
        // =========================================================================
        const bookTocModal = document.getElementById('bookTocModal');
        const bookTocBtn = document.getElementById('bookTocBtn');
        const footerTocCount = document.getElementById('footerTocCount');
        const bookTocTitle = document.getElementById('bookTocTitle');
        const bookTocFilterInput = document.getElementById('bookTocFilterInput');
        const bookTocListContainer = document.getElementById('bookTocListContainer');

        let currentBookToc = [];

        function updateFooterBar(tab) {
            if (!tab) {
                resetFooterBar();
                return;
            }

            const totalChaps = tab.chapters ? tab.chapters.length : 1;
            const curIdx = tab.currentChapterIdx || 0;

            footerChapterCount.textContent = `Ch ${curIdx + 1} / ${totalChaps}`;
            footerPrevBtn.disabled = curIdx <= 0;
            footerNextBtn.disabled = curIdx >= totalChaps - 1;

            if (tab.toc && tab.toc.length > 0) {
                bookTocBtn.style.display = 'inline-flex';
                footerTocCount.textContent = `(${tab.toc.length})`;
            } else {
                bookTocBtn.style.display = 'none';
            }
        }

        function resetFooterBar() {
            footerChapterCount.textContent = '—';
            footerPrevBtn.disabled = true;
            footerNextBtn.disabled = true;
            if (bookTocBtn) bookTocBtn.style.display = 'none';
        }

        let currentActiveTocIdx = -1;

        function toggleBookToc() {
            if (bookTocModal.classList.contains('active')) {
                closeBookToc();
            } else {
                openBookToc();
            }
        }

        function openBookToc() {
            const tab = openTabs.find(t => t.bookCode === activeBookCode);
            if (!tab) return;

            currentBookToc = tab.toc || [];
            bookTocTitle.textContent = `${tab.title} — Table of Contents (${currentBookToc.length} sections)`;
            bookTocFilterInput.value = '';

            // Detect currently visible paragraph in reading viewport
            let currentParaIdx = 0;
            const containerRect = contentArea.getBoundingClientRect();
            const paras = contentArea.querySelectorAll('[data-pindex]');

            for (let i = 0; i < paras.length; i++) {
                const p = paras[i];
                const rect = p.getBoundingClientRect();
                if (rect.top - containerRect.top <= 140) {
                    currentParaIdx = parseInt(p.getAttribute('data-pindex'), 10) || 0;
                } else {
                    break;
                }
            }

            let matchedIdx = -1;
            for (let i = 0; i < currentBookToc.length; i++) {
                if (currentBookToc[i].para_index <= currentParaIdx) {
                    matchedIdx = i;
                } else {
                    break;
                }
            }
            currentActiveTocIdx = matchedIdx;

            renderBookToc(currentBookToc, currentActiveTocIdx);
            bookTocModal.classList.add('active');

            setTimeout(() => {
                bookTocFilterInput.focus();
                if (currentActiveTocIdx >= 0) {
                    const activeEl = bookTocListContainer.querySelector(`[data-toc-idx="${currentActiveTocIdx}"]`);
                    if (activeEl) {
                        activeEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
                    }
                }
            }, 80);
        }

        function closeBookToc() {
            bookTocModal.classList.remove('active');
        }

        function renderBookToc(items, activeIdx = -1) {
            if (!items || items.length === 0) {
                bookTocListContainer.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted); font-size:12px;">No sections available.</div>';
                return;
            }

            bookTocListContainer.innerHTML = items.map((item, originalIdx) => {
                const isCurrentReading = originalIdx === activeIdx;
                const indent = Math.max(0, (item.level - 1) * 14);
                let itemStyle = 'padding: 5px 8px; font-size:11.5px; color:var(--text-secondary);';
                let iconHtml = '<span style="width:4px; height:4px; border-radius:50%; background:var(--text-muted); opacity:0.6; flex-shrink:0;"></span>';

                if (item.level === 1) {
                    itemStyle = 'padding: 6px 8px; font-size:13px; font-weight:bold; color:var(--accent);';
                    iconHtml = '<span style="width:6px; height:6px; border-radius:50%; background:var(--accent); flex-shrink:0;"></span>';
                } else if (item.level === 2) {
                    itemStyle = 'padding: 5px 8px; font-size:12px; font-weight:600; color:var(--text-primary);';
                    iconHtml = '<span style="font-size:10px; color:var(--text-muted); flex-shrink:0; font-family:monospace;">§</span>';
                }

                if (isCurrentReading) {
                    itemStyle += ' background:var(--accent-light); color:var(--accent); font-weight:bold; border-left:2px solid var(--accent);';
                }

                return `
                    <div data-toc-idx="${originalIdx}" 
                         style="display:flex; align-items:center; padding-left:${8 + indent}px; border-radius:4px; cursor:pointer; gap:8px; transition:background 0.1s; ${itemStyle}" 
                         onmouseover="if(!${isCurrentReading}) this.style.background='var(--bg-secondary)'" 
                         onmouseout="if(!${isCurrentReading}) this.style.background='transparent'"
                         onclick="jumpToTocItem(${item.para_index}, '${item.para_num || ''}', ${item.chapter_index || 0})">
                        ${iconHtml}
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${item.title}</span>
                        ${isCurrentReading ? '<span style="font-size:9.5px; font-weight:bold; color:var(--accent); flex-shrink:0;">● Reading</span>' : ''}
                    </div>
                `;
            }).join('');
        }

        function filterBookToc(query) {
            const q = query.trim().toLowerCase();
            if (!q) {
                renderBookToc(currentBookToc, currentActiveTocIdx);
                return;
            }
            const filtered = currentBookToc.filter(item => item.title.toLowerCase().includes(q));
            renderBookToc(filtered, -1);
        }

        async function jumpToTocItem(paraIndex, paraNum, chapterIndex) {
            closeBookToc();
            await openBookInTab(activeBookCode, {
                targetParaIndex: paraIndex,
                targetParaNum: paraNum || undefined,
                targetChapterIdx: chapterIndex
            });
        }

        // Help Modal Handlers
        const helpModal = document.getElementById('helpModal');
        function openHelpModal() {
            if (helpModal) helpModal.classList.add('active');
        }
        function closeHelpModal() {
            if (helpModal) helpModal.classList.remove('active');
        }

        // Dictionary Modal Handler
        function openDictionaryModal() {
            openSearch();
        }

        // Clicking breadcrumbs reveals header, footer, and navigation
        contentHeader.onclick = () => {
            appSidebar.classList.remove('collapsed');
            document.body.classList.remove('zen-mode');
            if (toggleHeaderFooterBtn) {
                toggleHeaderFooterBtn.title = 'Hide UI (Zen Mode)';
            }
        };

        // Auto-hide breadcrumbs on scroll down, reveal on scroll up or top
        let lastScrollTop = 0;
        contentArea.addEventListener('scroll', () => {
            const top = contentArea.scrollTop;
            const delta = top - lastScrollTop;
            if (top <= 40) {
                contentHeader.classList.remove('hidden-scroll');
            } else if (delta > 8) {
                contentHeader.classList.add('hidden-scroll');
            } else if (delta < -8) {
                contentHeader.classList.remove('hidden-scroll');
            }
            lastScrollTop = top;
        });

        function navigateChapterDelta(delta) {
            const tab = openTabs.find(t => t.bookCode === activeBookCode);
            if (!tab || !tab.chapters) return;

            const newIdx = (tab.currentChapterIdx || 0) + delta;
            if (newIdx >= 0 && newIdx < tab.chapters.length) {
                scrollToChapterAccurately(newIdx);
            }
        }

        // =========================================================================
        // Full-Text Search Modal & GET Request Support
        // =========================================================================
        const searchModal = document.getElementById('searchModal');
        const globalSearchInput = document.getElementById('globalSearchInput');
        const modalSearchInput = document.getElementById('modalSearchInput');
        const closeSearchModal = document.getElementById('closeSearchModal');
        const searchResultsContainer = document.getElementById('searchResultsContainer');

        function openSearch(initialQuery = '') {
            searchModal.classList.add('active');
            if (initialQuery) {
                modalSearchInput.value = initialQuery;
                executeSearch(initialQuery);
            }
            modalSearchInput.focus();
        }

        function closeSearch() {
            searchModal.classList.remove('active');
        }

        globalSearchInput.onclick = () => openSearch();
        closeSearchModal.onclick = closeSearch;
        searchModal.onclick = (e) => {
            if (e.target === searchModal) closeSearch();
        };

        window.addEventListener('keydown', (e) => {
            if (e.key === '/' && document.activeElement !== modalSearchInput && document.activeElement !== document.getElementById('treeFilterInput')) {
                e.preventDefault();
                openSearch();
            }
            if (e.key === 'Escape') closeSearch();
        });

        let searchDebounce = null;
        modalSearchInput.oninput = (e) => {
            const q = e.target.value.trim();
            if (searchDebounce) clearTimeout(searchDebounce);

            if (q.length < 2) {
                searchResultsContainer.innerHTML = `
                    <div style="text-align:center; padding: 30px; color: var(--text-muted); font-size: 14px;">
                        Type 2 or more characters to search across all 217 books...
                    </div>`;
                return;
            }

            searchResultsContainer.innerHTML = `
                <div class="loading-view">
                    <div class="spinner"></div>
                    <div>Searching Tipiṭaka for "<strong>${q}</strong>"...</div>
                </div>`;

            searchDebounce = setTimeout(() => {
                executeSearch(q);
            }, 250);
        };

        async function executeSearch(query) {
            try {
                const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=50`);
                const data = await res.json();
                renderSearchResults(data, query);
                updateUrlParams({ q: query });
            } catch (err) {
                searchResultsContainer.innerHTML = `<div style="color:var(--accent); text-align:center; padding:20px;">Search failed: ${err.message}</div>`;
            }
        }

        function renderSearchResults(data, query) {
            if (!data.results || data.results.length === 0) {
                searchResultsContainer.innerHTML = `
                    <div style="text-align:center; padding: 30px; color: var(--text-muted); font-size: 14px;">
                        No matches found for "<strong>${query}</strong>".
                    </div>`;
                return;
            }

            const headerHtml = `
                <div style="padding: 4px 8px 10px 8px; font-size: 12px; color: var(--text-muted); display:flex; justify-content:space-between;">
                    <span>Found <strong>${data.total}</strong> matches (showing top ${data.results.length}):</span>
                    <span>Click result to jump</span>
                </div>`;

            const resultsHtml = data.results.map(r => `
                <div class="search-result-item" onclick="jumpToSearchResult('${r.book_code}', ${r.para_index}, '${r.para_num}', '${encodeURIComponent(query)}')">
                    <div class="result-meta">
                        <span>📖 ${r.book_title}</span>
                        ${r.para_num ? `<span style="font-size:11px; background:var(--accent-light); padding:1px 5px; border-radius:4px;">Para #${r.para_num}</span>` : ''}
                        <span style="color:var(--text-muted); font-weight:normal; margin-left:auto;">${r.nikaya || ''}</span>
                    </div>
                    <div class="result-snippet">${r.snippet}</div>
                </div>
            `).join('');

            searchResultsContainer.innerHTML = headerHtml + resultsHtml;
        }

        async function jumpToSearchResult(bookCode, paraIndex, paraNum, encodedQuery) {
            closeSearch();
            const query = decodeURIComponent(encodedQuery);
            await openBookInTab(bookCode, {
                targetParaIndex: paraIndex,
                targetParaNum: paraNum,
                highlightQuery: query
            });
        }

        // =========================================================================
        // URL Query Parameter Handling (GET Request Support)
        // =========================================================================
        function updateUrlParams(paramsToUpdate) {
            const url = new URL(window.location);
            Object.entries(paramsToUpdate).forEach(([k, v]) => {
                if (v === null || v === undefined) {
                    url.searchParams.delete(k);
                } else {
                    url.searchParams.set(k, v);
                }
            });
            window.history.replaceState({}, '', url.toString());
        }

        function handleUrlParamsOnLoad() {
            const params = new URLSearchParams(window.location.search);
            const query = params.get('q') || params.get('search');
            const bookParam = params.get('book') || params.get('book_code');
            const chapterParam = params.get('chapter') || params.get('c');
            const paraParam = params.get('para') || params.get('p') || params.get('pindex');

            if (query) {
                openSearch(query);
            } else if (bookParam) {
                let chapIdx = 0;
                if (chapterParam !== null && chapterParam !== undefined) {
                    const parsed = parseInt(chapterParam, 10);
                    chapIdx = Math.max(0, parsed > 0 ? parsed - 1 : 0);
                }

                openBookInTab(bookParam, {
                    targetChapterIdx: chapIdx,
                    targetParaIndex: paraParam ? parseInt(paraParam) : undefined
                });
            } else {
                checkUrlHash();
            }
        }

        // =========================================================================
        // Bookmarks & Reading History Storage
        // =========================================================================
        const bookmarkModal = document.getElementById('bookmarkModal');
        const historyModal = document.getElementById('historyModal');
        const bookmarkListContainer = document.getElementById('bookmarkListContainer');
        const historyListContainer = document.getElementById('historyListContainer');

        function getBookmarks() {
            try {
                return JSON.parse(localStorage.getItem('tipitaka_bookmarks_v2') || '[]');
            } catch (e) { return []; }
        }

        function saveBookmarks(list) {
            localStorage.setItem('tipitaka_bookmarks_v2', JSON.stringify(list));
            updateBookmarkBadge();
        }

        function updateBookmarkBadge() {
            const list = getBookmarks();
            const badge = document.getElementById('footerBookmarkCount');
            if (badge) badge.textContent = list.length > 0 ? `(${list.length})` : '';
        }

        function openBookmarkModal() {
            renderBookmarksList();
            bookmarkModal.classList.add('active');
        }

        function closeBookmarkModal() {
            bookmarkModal.classList.remove('active');
        }

        function renderBookmarksList() {
            const list = getBookmarks();
            if (list.length === 0) {
                bookmarkListContainer.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted); font-size:12px;">No bookmarks saved yet.</div>';
                return;
            }
            bookmarkListContainer.innerHTML = list.map(item => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:6px; cursor:pointer;" onclick="openBookInTab('${item.bookCode}', { targetChapterIdx: ${item.chapterIdx || 0}, targetParaIndex: ${item.paraIndex || 0} }); closeBookmarkModal();">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:bold; font-size:12px; color:var(--accent);">${item.bookTitle} <span style="font-weight:normal; font-size:10px; color:var(--text-muted);">› ${item.chapterTitle || ''}</span></div>
                        <div style="font-size:11px; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.snippet || ''}</div>
                    </div>
                    <button style="border:none; background:transparent; cursor:pointer; color:var(--text-muted); font-size:14px; margin-left:8px;" onclick="event.stopPropagation(); deleteBookmark('${item.id}');">✕</button>
                </div>
            `).join('');
        }

        function deleteBookmark(id) {
            const list = getBookmarks().filter(b => b.id !== id);
            saveBookmarks(list);
            renderBookmarksList();
        }

        function getHistory() {
            try {
                return JSON.parse(localStorage.getItem('tipitaka_recent_history_v2') || '[]');
            } catch (e) { return []; }
        }

        function recordHistory(bookCode, title, nikaya, chapIdx, chapTitle) {
            if (!bookCode) return;
            const list = getHistory().filter(h => !(h.bookCode === bookCode && h.chapterIdx === chapIdx));
            list.unshift({
                bookCode,
                bookTitle: title,
                nikaya: nikaya || '',
                chapterIdx: chapIdx || 0,
                chapterTitle: chapTitle || '',
                lastReadTime: Date.now()
            });
            localStorage.setItem('tipitaka_recent_history_v2', JSON.stringify(list.slice(0, 50)));
        }

        function openHistoryModal() {
            renderHistoryList();
            historyModal.classList.add('active');
        }

        function closeHistoryModal() {
            historyModal.classList.remove('active');
        }

        function renderHistoryList() {
            const list = getHistory();
            if (list.length === 0) {
                historyListContainer.innerHTML = '<div style="text-align:center; padding:30px; color:var(--text-muted); font-size:12px;">No reading history recorded yet.</div>';
                return;
            }
            historyListContainer.innerHTML = list.map(item => `
                <div style="display:flex; align-items:center; justify-content:space-between; padding:8px 10px; background:var(--bg-secondary); border:1px solid var(--border-color); border-radius:6px; cursor:pointer;" onclick="openBookInTab('${item.bookCode}', { targetChapterIdx: ${item.chapterIdx || 0} }); closeHistoryModal();">
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:bold; font-size:12px; color:var(--text-primary);">${item.bookTitle} <span style="font-weight:normal; font-size:10.5px; color:var(--accent);">› ${item.chapterTitle || `Ch ${(item.chapterIdx || 0) + 1}`}</span></div>
                        <div style="font-size:10px; color:var(--text-muted);">${item.nikaya || ''}</div>
                    </div>
                </div>
            `).join('');
        }

        // Start App
        updateBookmarkBadge();
        loadTree();
    </script>
</body>
</html>
"""

APP_PY_TEMPLATE = r'''#!/usr/bin/env python3
"""
Tipitaka Web Application - Multi-tab, high-performance SQLite3-backed Tipitaka reader.
"""

import os
import re
import json
import sqlite3
from flask import Flask, render_template, jsonify, request, send_from_directory, abort

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Dynamic DB Path Resolution
DB_PATH = None
for candidate in [
    os.path.join(BASE_DIR, 'tipitaka.db'),
    os.path.join(BASE_DIR, '..', 'tipitaka_latin2.db'),
    os.path.join(BASE_DIR, '..', 'tipitaka_latin.db'),
    os.path.join(BASE_DIR, 'tipitaka2.db')
]:
    if os.path.exists(candidate) and os.path.getsize(candidate) > 1000000:
        DB_PATH = candidate
        break

if not DB_PATH:
    DB_PATH = os.path.join(BASE_DIR, 'tipitaka.db')

app = Flask(__name__, static_folder='static', template_folder='templates')


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def xml_to_html_accurate(xml_content: str, chapters: list) -> str:
    """Converts Tipitaka XML to clean, accessible HTML with exact chapter and paragraph anchors."""
    m = re.search(r'<body[^>]*>(.*?)</body>', xml_content, flags=re.DOTALL)
    body = m.group(1) if m else xml_content

    # Build para_index -> chapter mapping
    chapter_by_para = {}
    for c in chapters:
        p_idx = c.get('para_index', 0)
        c_idx = c.get('chapter_index', 0)
        c_title = c.get('title', '')
        chapter_by_para[p_idx] = (c_idx, c_title)

    # Find all paragraph tags and assign exact paragraph index
    para_counter = 0

    def replace_para(match):
        nonlocal para_counter
        tag = match.group(1)
        rend = match.group(2) or 'bodytext'
        n_attr = match.group(3)
        inner = match.group(4)

        prefix = ""
        # If this paragraph starts a chapter, insert chapter anchor marker
        if para_counter in chapter_by_para:
            c_idx, c_title = chapter_by_para[para_counter]
            prefix = f'<div id="chap-{c_idx}" class="chapter-divider" data-chapter="{c_idx}"><div class="chapter-badge">Chapter {c_idx + 1}</div><h2 class="chapter-heading-text">{c_title}</h2></div>'

        attr_parts = [f'id="pindex-{para_counter}"', f'data-pindex="{para_counter}"']
        if n_attr:
            attr_parts.append(f'id="para-{n_attr}"')
            attr_parts.append(f'data-para="{n_attr}"')

        attrs = ' ' + ' '.join(attr_parts)
        res = f'{prefix}<p class="{rend}"{attrs}>{inner}</p>'
        para_counter += 1
        return res

    # Replace all paragraph-level elements
    body = re.sub(
        r'<(p|head|trailer)\s+rend="([^"]+)"(?:\s+n="([^"]+)")?\s*>(.*?)</\1>',
        replace_para,
        body,
        flags=re.DOTALL
    )

    # Inline formatting
    body = re.sub(r'<hi\s+rend="bold">([^<]+)</hi>', r'<strong class="bld">\1</strong>', body)
    body = re.sub(r'<hi\s+rend="paranum">([^<]+)</hi>', r'<strong class="paranum">\1</strong>', body)
    body = re.sub(r'<hi\s+rend="dot">([^<]+)</hi>', r'<span class="dot">\1</span>', body)

    # Page breaks & footnotes
    body = re.sub(
        r'<pb\s+ed="([^"]+)"\s+n="([^"]+)"\s*/>',
        r'<span class="pb" title="Page \1 \2" data-ed="\1" data-page="\2">[\1 \2]</span>',
        body
    )
    body = re.sub(
        r'<note>(.*?)</note>',
        r'<span class="note" title="Footnote">[\1]</span>',
        body,
        flags=re.DOTALL
    )

    return body


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/tree')
def get_tree():
    """Returns the top 4 categories (Mūla, Aṭṭhakathā, Ṭīkā, Añña) navigation tree."""
    def clean_tree(data):
        if isinstance(data, list) and len(data) == 1 and data[0].get('text', '').lower() in ('tipiṭaka', 'tipitaka') and data[0].get('children'):
            return data[0]['children']
        return data

    # 1. Fetch from SQLite site_metadata first (100% self-contained)
    db = get_db()
    cur = db.cursor()
    try:
        cur.execute("SELECT value FROM site_metadata WHERE key = 'tree_json';")
        row = cur.fetchone()
        if row and row[0]:
            tree_data = json.loads(row[0])
            db.close()
            return jsonify(clean_tree(tree_data))
    except sqlite3.OperationalError:
        pass

    # 2. Check local tree.json files
    candidate_paths = [
        os.path.join(BASE_DIR, 'static', 'tree.json'),
        os.path.join(BASE_DIR, 'tree.json'),
        os.path.join(BASE_DIR, '..', 'p_latin_presplit2', 'tree.json'),
        os.path.join(BASE_DIR, '..', 'p_latin_presplit', 'tree.json')
    ]
    for p in candidate_paths:
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f:
                tree_data = json.load(f)
            db.close()
            return jsonify(clean_tree(tree_data))

    # 3. Fallback: Reconstruct nested tree hierarchy directly from SQLite tree_nodes
    cur.execute("SELECT id, text, parent_id, node_type, book_code, chapter_index, href FROM tree_nodes ORDER BY id;")
    rows = cur.fetchall()
    db.close()

    nodes_by_id = {}
    root_nodes = []

    for r in rows:
        node = {
            'id': r['id'],
            'text': r['text'],
            'type': r['node_type'],
            'children': []
        }
        if r['href']:
            node['a_attr'] = {'href': r['href']}
        nodes_by_id[r['id']] = node

    for r in rows:
        pid = r['parent_id']
        nid = r['id']
        if pid is not None and pid in nodes_by_id and pid != nid:
            nodes_by_id[pid]['children'].append(nodes_by_id[nid])
        else:
            root_nodes.append(nodes_by_id[nid])

    return jsonify(clean_tree(root_nodes))


@app.route('/api/books')
def list_books():
    """Returns list of all 217 books grouped with chapter counts."""
    db = get_db()
    cur = db.cursor()
    cur.execute("""
    SELECT id, code, title, nikaya, category, xml_filename, chapter_count
    FROM books
    ORDER BY id;
    """)
    rows = [dict(r) for r in cur.fetchall()]
    db.close()
    return jsonify(rows)


@app.route('/api/book/<book_code>')
def get_book(book_code: str):
    """Returns full book content, metadata, and chapter list with exact anchors."""
    clean_code = book_code.replace('.xml', '')
    m = re.match(r'^([a-z0-9\._]+?)(?:\d+)?$', clean_code)
    if m:
        clean_code = m.group(1)

    db = get_db()
    cur = db.cursor()
    cur.execute("""
    SELECT id, code, title, nikaya, category, xml_filename, xml_content, chapter_count
    FROM books
    WHERE code = ?;
    """, (clean_code,))
    book_row = cur.fetchone()

    if not book_row:
        db.close()
        return jsonify({'error': f'Book "{clean_code}" not found'}), 404

    book_dict = dict(book_row)
    cur.execute("""
    SELECT chapter_index, title, chunk_name, anchor_id, para_index
    FROM chapters
    WHERE book_code = ?
    ORDER BY chapter_index;
    """, (clean_code,))
    chapters = [dict(r) for r in cur.fetchall()]
    db.close()

    # Render HTML from XML content with accurate chapter markers
    html_content = xml_to_html_accurate(book_dict['xml_content'], chapters)
    del book_dict['xml_content']

    book_dict['html'] = html_content
    book_dict['chapters'] = chapters
    return jsonify(book_dict)


@app.route('/api/search')
def search():
    """Fast Full-Text Search across all 520,000+ paragraphs with rich GET request parameters."""
    query = request.args.get('q', '').strip() or request.args.get('search', '').strip()
    book_code = request.args.get('book', '').strip() or request.args.get('book_code', '').strip()
    nikaya = request.args.get('nikaya', '').strip()
    limit = int(request.args.get('limit', 50))
    offset = int(request.args.get('offset', 0))

    if not query:
        return jsonify({'results': [], 'total': 0, 'query': ''})

    db = get_db()
    cur = db.cursor()

    # Dynamically detect columns in paragraphs_fts table
    try:
        cur.execute("PRAGMA table_info(paragraphs_fts);")
        cols = [r[1] for r in cur.fetchall()]
    except Exception:
        cols = []

    has_para_index = 'para_index' in cols
    content_idx = cols.index('content') if 'content' in cols else (6 if has_para_index else 5)
    para_idx_col = "para_index," if has_para_index else "'' AS para_index,"

    where_clauses = ["paragraphs_fts MATCH ?"]
    params = [query]

    if book_code:
        where_clauses.append("book_code = ?")
        params.append(book_code.replace('.xml', ''))
    if nikaya:
        where_clauses.append("nikaya LIKE ?")
        params.append(f"%{nikaya}%")

    where_sql = " AND ".join(where_clauses)

    try:
        cur.execute(f"""
        SELECT
            book_code,
            book_title,
            nikaya,
            para_num,
            {para_idx_col}
            snippet(paragraphs_fts, {content_idx}, '<mark>', '</mark>', '...', 32) AS snippet,
            content
        FROM paragraphs_fts
        WHERE {where_sql}
        ORDER BY rank
        LIMIT ? OFFSET ?;
        """, (*params, limit, offset))
        results = [dict(r) for r in cur.fetchall()]

        cur.execute(f"SELECT count(*) FROM paragraphs_fts WHERE {where_sql};", (*params,))
        total = cur.fetchone()[0]
    except Exception:
        like_query = f"%{query}%"
        where_clauses = ["content LIKE ?"]
        params = [like_query]
        if book_code:
            where_clauses.append("book_code = ?")
            params.append(book_code.replace('.xml', ''))
        if nikaya:
            where_clauses.append("nikaya LIKE ?")
            params.append(f"%{nikaya}%")
        where_sql = " AND ".join(where_clauses)

        try:
            cur.execute(f"""
            SELECT
                book_code,
                book_title,
                nikaya,
                para_num,
                {para_idx_col}
                content AS snippet,
                content
            FROM paragraphs_fts
            WHERE {where_sql}
            LIMIT ? OFFSET ?;
            """, (*params, limit, offset))
            results = [dict(r) for r in cur.fetchall()]
            total = len(results)
        except Exception:
            results = []
            total = 0

    db.close()
    return jsonify({
        'query': query,
        'total': total,
        'results': results,
        'limit': limit,
        'offset': offset,
        'book_filter': book_code,
        'nikaya_filter': nikaya
    })


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting Tipitaka Web Application at http://localhost:{port} ...")
    app.run(host='0.0.0.0', port=port, debug=False)
'''

REQUIREMENTS_TXT = """Flask>=2.0.0
gunicorn>=20.0.0
"""

README_MD = r"""# Chaṭṭha Saṅgāyana Tipiṭaka Reader (Web Application)

A modern, lightweight, self-contained Pali Tipitaka (Roman Latin) Reader powered by Python & SQLite3.

## Quick Start (Local Computer)

### 1. Install Dependencies
Make sure you have Python 3.8+ installed, then install Flask:
```bash
pip install -r requirements.txt
# or:
pip install flask
```

### 2. Run the Application
```bash
python app.py
```

### 3. Open in Browser
Navigate to:
```
http://localhost:5000
```

---

## Features
- **Full Tipitaka Navigation Tree**: Browse all 4 categories (Mūla, Aṭṭhakathā, Ṭīkā, Añña), 217 Books, and 2,698 Chapters.
- **Accurate Chapter Shortcuts**: Click any book to expand and read; click any chapter shortcut to jump accurately to that chapter.
- **Full-Text Search (FTS5)**: Instant search across 520,000+ paragraphs with keyword highlights.
- **Themes & Typography**: Light, Sepia, and Dark reading modes with font size adjustments.
- **100% Self-Contained**: No external CDN or internet connection required after downloading.
"""

# ---------------------------------------------------------------------------
# Stage 1: Transliteration (Devanagari -> Roman Latin)
# ---------------------------------------------------------------------------
def run_transliteration(engine: str = 'auto'):
    log("STAGE 1", "Transliterating Devanagari to Roman Latin (UTF-8 Unicode)")

    use_dart = False
    if engine in ('dart', 'auto'):
        dart_path = shutil.which('dart')
        if dart_path:
            use_dart = True

    if engine == 'dart' and not use_dart:
        log_warn("Dart CLI not found in PATH; falling back to Python converter.")
        use_dart = False

    os.makedirs(P_LATIN_DIR, exist_ok=True)
    os.makedirs(os.path.join(P_LATIN_PRESPLIT_DIR, 'cscd'), exist_ok=True)

    if use_dart:
        log_step("Using Dart conversion engine (dart/bin/deva2latn.dart)...")
        # 1. Convert 217 full XML books
        cmd_books = ['dart', 'bin/deva2latn.dart', os.path.relpath(DEVA_DIR, DART_DIR), os.path.relpath(P_LATIN_DIR, DART_DIR)]
        subprocess.run(cmd_books, cwd=DART_DIR, check=True)
        log_step(f"Converted 217 book files to '{P_LATIN_DIR}' in UTF-8.")

        # 2. Convert tree.json
        deva_tree = os.path.join(ROOT_DIR, 'tipitaka.org', 'deva', 'tree.json')
        latn_tree = os.path.join(P_LATIN_PRESPLIT_DIR, 'tree.json')
        if os.path.exists(deva_tree):
            cmd_tree = ['dart', 'bin/deva2latn.dart', os.path.relpath(deva_tree, DART_DIR), os.path.relpath(latn_tree, DART_DIR)]
            subprocess.run(cmd_tree, cwd=DART_DIR, check=True)
            log_step("Converted tree.json to Roman Latin in UTF-8.")

        # 3. Convert TOC files in tipitaka.org/deva/cscd
        deva_cscd = os.path.join(ROOT_DIR, 'tipitaka.org', 'deva', 'cscd')
        if os.path.exists(deva_cscd):
            from deva2latn import Deva2Latn
            conv = Deva2Latn()
            toc_files = glob.glob(os.path.join(deva_cscd, '*.toc.xml'))
            for tf in toc_files:
                out_tf = os.path.join(P_LATIN_PRESPLIT_DIR, 'cscd', os.path.basename(tf))
                conv.convert_file(tf, out_tf)
            log_step(f"Converted {len(toc_files)} TOC files to UTF-8.")

    else:
        log_step("Using Python conversion engine (conversion scripts/deva2latn.py)...")
        from deva2latn import Deva2Latn
        conv = Deva2Latn()

        # 1. Convert 217 full XML books
        count = conv.convert_tree(DEVA_DIR, P_LATIN_DIR, use_utf8=True)
        log_step(f"Converted {count} book files to '{P_LATIN_DIR}' in UTF-8.")

        # 2. Convert tree.json
        deva_tree = os.path.join(ROOT_DIR, 'tipitaka.org', 'deva', 'tree.json')
        latn_tree = os.path.join(P_LATIN_PRESPLIT_DIR, 'tree.json')
        if os.path.exists(deva_tree):
            conv.convert_json_file(deva_tree, latn_tree)
            log_step("Converted tree.json to Roman Latin in UTF-8.")

        # 3. Convert TOC files
        deva_cscd = os.path.join(ROOT_DIR, 'tipitaka.org', 'deva', 'cscd')
        if os.path.exists(deva_cscd):
            toc_files = glob.glob(os.path.join(deva_cscd, '*.toc.xml'))
            for tf in toc_files:
                out_tf = os.path.join(P_LATIN_PRESPLIT_DIR, 'cscd', os.path.basename(tf))
                conv.convert_file(tf, out_tf)
            log_step(f"Converted {len(toc_files)} TOC files to UTF-8.")


# ---------------------------------------------------------------------------
# Stage 2: Database Build & Exact Chapter Offsets Calculation
# ---------------------------------------------------------------------------
def read_text_auto(file_path: str) -> str:
    """Robust multi-encoding text reader handling UTF-8, UTF-16LE, UTF-16BE, and BOMs."""
    with open(file_path, "rb") as f:
        raw = f.read()
    if raw.startswith(b"\xfe\xff"):
        return raw.decode("utf-16be", errors="replace")
    elif raw.startswith(b"\xff\xfe"):
        return raw.decode("utf-16le", errors="replace")
    elif raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig", errors="replace")
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("utf-16le", errors="replace")


def clean_xml_to_plain(xml_text: str) -> str:
    """Strips XML tags to produce clean plain text for full-text search."""
    text = re.sub(r'<note>.*?</note>', '', xml_text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def build_sqlite_database():
    log("STAGE 2", "Building SQLite3 Database & Exact Chapter Indexing")

    from deva2latn import Deva2Latn
    conv = Deva2Latn()

    if os.path.exists(DB_FILE):
        os.remove(DB_FILE)

    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()

    # Schema creation
    cur.execute("""
    CREATE TABLE IF NOT EXISTS site_metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

    cur.execute("""
    CREATE TABLE books (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        nikaya TEXT,
        category TEXT,
        xml_filename TEXT NOT NULL,
        xml_content TEXT NOT NULL,
        plain_text TEXT NOT NULL,
        chapter_count INTEGER DEFAULT 0
    );
    """)

    cur.execute("""
    CREATE TABLE chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        book_id INTEGER NOT NULL,
        book_code TEXT NOT NULL,
        chapter_index INTEGER NOT NULL,
        title TEXT NOT NULL,
        chunk_name TEXT NOT NULL,
        anchor_id TEXT NOT NULL,
        para_index INTEGER DEFAULT 0,
        FOREIGN KEY (book_id) REFERENCES books(id)
    );
    """)

    cur.execute("""
    CREATE TABLE tree_nodes (
        id INTEGER PRIMARY KEY,
        text TEXT NOT NULL,
        parent_id INTEGER,
        node_type TEXT,
        book_code TEXT,
        chapter_index INTEGER,
        href TEXT
    );
    """)

    cur.execute("""
    CREATE VIRTUAL TABLE paragraphs_fts USING fts5(
        book_code,
        book_title,
        nikaya,
        para_num,
        para_index UNINDEXED,
        para_rend,
        content,
        prefix = 3
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS book_mat (
        book_code TEXT PRIMARY KEY,
        category TEXT,
        mula_code TEXT,
        mula_title TEXT,
        attha_code TEXT,
        attha_title TEXT,
        tika_code TEXT,
        tika_title TEXT
    );
    """)


    cur.execute("CREATE INDEX IF NOT EXISTS idx_books_code ON books(code);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_code);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chapters_book_idx ON chapters(book_code, chapter_index);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_chapters_chunk ON chapters(chunk_name);")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_book_mat_code ON book_mat(book_code);")


    # Read tree.json for authentic book titles
    latn_tree_path = os.path.join(P_LATIN_PRESPLIT_DIR, 'tree.json')
    book_titles_from_tree = {}
    if os.path.exists(latn_tree_path):
        with open(latn_tree_path, 'r', encoding='utf-8') as f:
            tree_data = json.load(f)

        def extract_titles(node):
            if 'children' in node and node['children']:
                for c in node['children']:
                    href = c.get('a_attr', {}).get('href', '') or c.get('href', '')
                    if href and href.startswith('cscd/'):
                        m = re.match(r'cscd/([a-z0-9\._]+?)(?:\d+)?\.xml', href)
                        if m:
                            code = m.group(1)
                            if code not in book_titles_from_tree:
                                book_titles_from_tree[code] = node['text']
                for c in node['children']:
                    extract_titles(c)

        for root in tree_data:
            extract_titles(root)

    # 1. Insert 217 books
    book_files = sorted(glob.glob(os.path.join(P_LATIN_DIR, '*.xml')))
    log_step(f"Inserting {len(book_files)} books into database...")

    total_paras_indexed = 0
    total_chapters_mapped = 0

    for bf in book_files:
        filename = os.path.basename(bf)
        code = filename[:-4]

        if '.mul' in code:
            category = 'mūla'
        elif '.att' in code:
            category = 'aṭṭhakathā'
        elif '.tik' in code:
            category = 'ṭīkā'
        else:
            category = 'añña'

        # Read XML (handle UTF-8 or UTF-16)
        try:
            with open(bf, 'r', encoding='utf-8') as f:
                xml_content = f.read()
        except UnicodeDecodeError:
            with open(bf, 'r', encoding='utf-16') as f:
                xml_content = f.read()

        xml_content_utf8 = xml_content.replace('encoding="UTF-16"', 'encoding="UTF-8"').replace('encoding="utf-16"', 'encoding="UTF-8"')

        # Authentic title
        title = book_titles_from_tree.get(code)
        if not title:
            bm = re.search(r'<(?:p|head)\s+rend="book"[^>]*>([^<]+)</(?:p|head)>', xml_content_utf8)
            title = bm.group(1).strip() if bm else code

        # Nikaya
        nm = re.search(r'<(?:p|head)\s+rend="nikaya"[^>]*>([^<]+)</(?:p|head)>', xml_content_utf8)
        nikaya = nm.group(1).strip() if nm else ""

        plain_text = clean_xml_to_plain(xml_content_utf8)

        cur.execute("""
        INSERT INTO books (code, title, nikaya, category, xml_filename, xml_content, plain_text)
        VALUES (?, ?, ?, ?, ?, ?, ?);
        """, (code, title, nikaya, category, filename, xml_content_utf8, plain_text))
        book_id = cur.lastrowid

        # 2. Extract chapters and calculate exact paragraph offsets
        toc_path = os.path.join(P_LATIN_PRESPLIT_DIR, 'cscd', f'{code}.toc.xml')
        if os.path.exists(toc_path):
            toc_text = read_text_auto(toc_path)

            actions = re.findall(r'action="cscd/([^"]+)"', toc_text)
            titles = re.findall(r'text="([^"]+)"', toc_text)

            # Extract first text snippet of each chunk from tipitaka.org/deva/cscd
            chunk_snippets = []
            for chunk in actions:
                deva_chunk = os.path.join(ROOT_DIR, 'tipitaka.org', 'deva', 'cscd', chunk)
                sample = ""
                if os.path.exists(deva_chunk):
                    with open(deva_chunk, 'r', encoding='utf-16') as df:
                        ctxt = df.read()
                    paras = re.findall(r'<p[^>]*>(.*?)</p>', ctxt, flags=re.DOTALL)
                    for p in paras:
                        cl = re.sub(r'<[^>]+>', '', p).strip()
                        if cl and 'नमो तस्स' not in cl and len(cl) > 4:
                            sample = cl[:35]
                            break
                chunk_snippets.append(sample)

            all_paras = list(re.finditer(r'<(p|head|trailer)\s+rend="([^"]+)"(?:\s+n="([^"]+)")?\s*>(.*?)</\1>', xml_content_utf8, flags=re.DOTALL))
            mapped_indices = [0] * len(actions)

            for c_idx in range(1, len(actions)):
                c_title_clean = re.sub(r'^\d+\.\s*', '', titles[c_idx].lower()).strip()
                found_idx = None

                # Match deva snippet converted to latin
                snip = chunk_snippets[c_idx]
                if snip:
                    lat_snip = conv.convert_string(snip).lower().strip()[:20]
                    for p_idx, m in enumerate(all_paras):
                        p_txt = re.sub(r'<[^>]+>', '', m.group(4)).lower().strip()
                        if lat_snip and lat_snip in p_txt:
                            found_idx = p_idx
                            break

                # Match title/chapter/head text in XML
                if found_idx is None:
                    for p_idx, m in enumerate(all_paras):
                        rend = m.group(2)
                        p_txt = re.sub(r'<[^>]+>', '', m.group(4)).lower().strip()
                        if rend in ('chapter', 'title', 'subhead', 'book'):
                            if c_title_clean and c_title_clean in p_txt:
                                found_idx = p_idx
                                break

                # Fallback interpolation
                if found_idx is None:
                    prev = mapped_indices[c_idx - 1]
                    found_idx = prev + max(1, (len(all_paras) - prev) // (len(actions) - c_idx + 1))

                mapped_indices[c_idx] = found_idx

            for c_idx, (chunk, c_title) in enumerate(zip(actions, titles)):
                p_idx = mapped_indices[c_idx]
                anchor = f"chap-{c_idx}"
                cur.execute("""
                INSERT INTO chapters (book_id, book_code, chapter_index, title, chunk_name, anchor_id, para_index)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """, (book_id, code, c_idx, c_title, chunk, anchor, p_idx))
                total_chapters_mapped += 1

            cur.execute("UPDATE books SET chapter_count = ? WHERE id = ?;", (len(actions), book_id))

        # 3. Index paragraphs into FTS5 with exact para_index (retaining footnote/variant text)
        paras = re.findall(r'<(?:p|head|trailer)\s+rend="([^"]+)"(?:\s+n="([^"]+)")?\s*>(.*?)</(?:p|head|trailer)>', xml_content_utf8, flags=re.DOTALL)
        for p_idx, (rend, pnum, pcontent) in enumerate(paras):
            t_clean = re.sub(r'<pb[^>]*/>', ' ', pcontent)
            t_clean = re.sub(r'<span class="pagebreak"[^>]*>.*?</span>', ' ', t_clean, flags=re.DOTALL)
            t_clean = re.sub(r'<strong class="paranum"[^>]*>.*?</strong>', ' ', t_clean, flags=re.DOTALL)
            t_clean = re.sub(r'<[^>]+>', ' ', t_clean)
            t_clean = t_clean.replace('ṁ', 'ṃ').replace('Ṁ', 'ṃ')
            t_clean = re.sub(r'[\u200B-\u200D\uFEFF\u00A0]', ' ', t_clean)
            clean_text = re.sub(r'\s+', ' ', t_clean).strip()
            if clean_text:
                cur.execute("""
                INSERT INTO paragraphs_fts (book_code, book_title, nikaya, para_num, para_index, para_rend, content)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """, (code, title, nikaya, pnum or '', p_idx, rend, clean_text))
                total_paras_indexed += 1

    # 4. Insert tree nodes and store tree.json in site_metadata
    if not os.path.exists(latn_tree_path):
        for candidate in [
            os.path.join(ROOT_DIR, 'p_latin_presplit', 'tree.json'),
            os.path.join(ROOT_DIR, 'p_latin_presplit2', 'tree.json'),
            os.path.join(ROOT_DIR, 'web_app', 'tree.json')
        ]:
            if os.path.exists(candidate):
                latn_tree_path = candidate
                break

    if os.path.exists(latn_tree_path):
        tree_raw = read_text_auto(latn_tree_path)
        tree_data = json.loads(tree_raw)
        if isinstance(tree_data, list) and len(tree_data) == 1 and tree_data[0].get('text', '').lower() in ('tipiṭaka', 'tipitaka') and tree_data[0].get('children'):
            tree_data = tree_data[0]['children']
            tree_raw = json.dumps(tree_data, ensure_ascii=False, indent=2)

        # Store raw tree.json in database for 100% self-contained portability
        cur.execute("""
        INSERT OR REPLACE INTO site_metadata (key, value)
        VALUES (?, ?);
        """, ('tree_json', tree_raw))
        cur.execute("""
        INSERT OR REPLACE INTO site_metadata (key, value)
        VALUES (?, ?);
        """, ('version', '1.0'))

        node_seq = 0
        def insert_nodes(nodes, parent_id=None):
            nonlocal node_seq
            for n in nodes:
                node_seq += 1
                nid = n.get('id', node_seq)
                text = n.get('text', '')
                ntype = n.get('type', 'folder' if 'children' in n else 'leaf')
                href = n.get('a_attr', {}).get('href', '') or n.get('href', '')

                b_code = None
                c_idx = None
                if href and href.startswith('cscd/'):
                    m = re.match(r'cscd/([a-z0-9\._]+?)(?:(\d+))?\.xml', href)
                    if m:
                        b_code = m.group(1)
                        c_idx = int(m.group(2)) if m.group(2) is not None else 0

                cur.execute("""
                INSERT OR REPLACE INTO tree_nodes (id, text, parent_id, node_type, book_code, chapter_index, href)
                VALUES (?, ?, ?, ?, ?, ?, ?);
                """, (nid, text, parent_id, ntype, b_code, c_idx, href))

                if 'children' in n:
                    insert_nodes(n['children'], nid)

        insert_nodes(tree_data)

    # 5. Build and populate MAT (Mūla - Aṭṭhakathā - Ṭīkā) cross-reference relationships
    log_step("Building MAT (Mūla - Aṭṭhakathā - Ṭīkā) relationship index...")
    books_rows = cur.execute("SELECT code, title, nikaya, category FROM books;").fetchall()
    all_books_map = {b[0]: {"title": b[1], "nikaya": b[2], "category": b[3]} for b in books_rows}

    export_path = os.path.join(ROOT_DIR, 'epitaka.org', 'web_server', 'scripts', 'books_export.json')
    id_to_vri = {}
    vri_to_info = {}
    if os.path.exists(export_path):
        with open(export_path, 'r', encoding='utf-8') as f:
            export_data = json.load(f)
        for item in export_data:
            if item.get('vri_id') and item.get('book_id'):
                id_to_vri[item['book_id']] = item['vri_id']
                vri_to_info[item['vri_id']] = item

    def resolve_mat_ref(ref_str, default_code=None):
        if not ref_str:
            return default_code
        parts = ref_str.strip().split()
        for p in parts:
            if p in id_to_vri and id_to_vri[p] in all_books_map:
                return id_to_vri[p]
            if p in all_books_map:
                return p
        return default_code

    mat_count = 0
    for code, b in all_books_map.items():
        cat = b["category"]
        exp = vri_to_info.get(code, {})

        mula_raw = exp.get("mula_ref")
        mula_code = resolve_mat_ref(mula_raw, code if code.endswith(".mul") else None)

        attha_raw = exp.get("attha_ref")
        attha_code = resolve_mat_ref(attha_raw, code if code.endswith(".att") else None)

        tika_raw = exp.get("tika_ref")
        tika_code = resolve_mat_ref(tika_raw, code if code.endswith(".tik") else None)

        # Canonical heuristics for Suttas, Vinaya, Abhidhamma
        base = code.split(".")[0]
        prefix = base[:-1] if (len(base) > 1 and base[-1] in "matn" and not base[-2].isdigit()) or (len(base) > 2 and base[-2] in "matn" and base[-1].isdigit()) else base

        if not mula_code:
            for cand in [base[:-1] + "m.mul", prefix + "m.mul", prefix + "m1.mul", base + ".mul"]:
                if cand in all_books_map:
                    mula_code = cand
                    break
        if not attha_code:
            for cand in [base[:-1] + "a.att", prefix + "a.att", prefix + "a1.att", base + ".att"]:
                if cand in all_books_map:
                    attha_code = cand
                    break
        if not tika_code:
            for cand in [base[:-1] + "t.tik", prefix + "t.tik", prefix + "t1.tik", base + ".tik"]:
                if cand in all_books_map:
                    tika_code = cand
                    break

        mula_title = all_books_map.get(mula_code, {}).get("title") if mula_code else None
        attha_title = all_books_map.get(attha_code, {}).get("title") if attha_code else None
        tika_title = all_books_map.get(tika_code, {}).get("title") if tika_code else None

        cur.execute("""
        INSERT OR REPLACE INTO book_mat (book_code, category, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        """, (code, cat, mula_code, mula_title, attha_code, attha_title, tika_code, tika_title))
        mat_count += 1

    conn.commit()
    conn.close()

    # Copy database to web_app and p_latin_presplit (auto-create directories if needed)
    os.makedirs(os.path.dirname(WEB_DB_FILE), exist_ok=True)
    os.makedirs(P_LATIN_PRESPLIT_DIR, exist_ok=True)
    shutil.copy2(DB_FILE, WEB_DB_FILE)
    shutil.copy2(DB_FILE, os.path.join(P_LATIN_PRESPLIT_DIR, os.path.basename(WEB_DB_FILE)))
    shutil.copy2(DB_FILE, os.path.join(P_LATIN_PRESPLIT_DIR, 'tipitaka.db'))
    
    # Also sync to default web_app/tipitaka.db if different (for live web service)
    default_web_db = os.path.join(ROOT_DIR, 'web_app', 'tipitaka.db')
    if os.path.abspath(WEB_DB_FILE) != os.path.abspath(default_web_db) and os.path.exists(os.path.join(ROOT_DIR, 'web_app')):
        shutil.copy2(DB_FILE, default_web_db)

    # Sync to Next.js server_api/tipitaka.db
    next_server_db = os.path.join(ROOT_DIR, 'web_app_next', 'server_api', 'tipitaka.db')
    if os.path.exists(os.path.dirname(next_server_db)):
        shutil.copy2(DB_FILE, next_server_db)

    log_step(f"Database built successfully: {len(book_files)} books, {total_chapters_mapped} chapters, {total_paras_indexed} indexed paragraphs, {mat_count} MAT relations.")



# ---------------------------------------------------------------------------
# Stage 3: Web Assets & Chapter Shortcuts Synchronization
# ---------------------------------------------------------------------------
def sync_web_assets():
    log("STAGE 3", "Synchronizing Web Assets & Chapter Shortcuts")

    cscd_dir = os.path.join(P_LATIN_PRESPLIT_DIR, 'cscd')
    os.makedirs(cscd_dir, exist_ok=True)
    os.makedirs(os.path.join(WEB_APP_DIR, 'static'), exist_ok=True)
    os.makedirs(os.path.join(WEB_APP_DIR, 'templates'), exist_ok=True)

    # 0. Generate complete standalone Web Application files from embedded templates
    index_html_path = os.path.join(WEB_APP_DIR, 'templates', 'index.html')
    with open(index_html_path, 'w', encoding='utf-8') as f:
        f.write(INDEX_HTML_TEMPLATE)

    app_py_path = os.path.join(WEB_APP_DIR, 'app.py')
    with open(app_py_path, 'w', encoding='utf-8') as f:
        f.write(APP_PY_TEMPLATE)

    with open(os.path.join(WEB_APP_DIR, 'requirements.txt'), 'w', encoding='utf-8') as f:
        f.write(REQUIREMENTS_TXT)

    with open(os.path.join(WEB_APP_DIR, 'README.md'), 'w', encoding='utf-8') as f:
        f.write(README_MD)

    log_step(f"Generated standalone web app files in '{WEB_APP_DIR}' (index.html, app.py, requirements.txt, README.md).")



    # If WEB_APP_DIR is a custom folder (e.g. web_app2), bootstrap app.py and templates
    default_web_app = os.path.join(ROOT_DIR, 'web_app')
    if os.path.abspath(WEB_APP_DIR) != os.path.abspath(default_web_app) and os.path.exists(default_web_app):
        for item in ['templates', 'app.py', 'requirements.txt', 'README.md', 'tree.json']:
            src_item = os.path.join(default_web_app, item)
            dst_item = os.path.join(WEB_APP_DIR, item)
            if os.path.exists(src_item) and not os.path.exists(dst_item):
                if os.path.isdir(src_item):
                    shutil.copytree(src_item, dst_item, dirs_exist_ok=True)
                else:
                    shutil.copy2(src_item, dst_item)

    # 1. Copy 217 book files to p_latin_presplit/cscd in UTF-8
    book_files = glob.glob(os.path.join(P_LATIN_DIR, '*.xml'))
    for bf in book_files:
        dest_f = os.path.join(cscd_dir, os.path.basename(bf))
        if os.path.islink(dest_f) or os.path.exists(dest_f):
            os.remove(dest_f)
        try:
            c = read_text_auto(bf)
        except UnicodeDecodeError:
            c = read_text_auto(bf)
        c_utf8 = c.replace('encoding="UTF-16"', 'encoding="UTF-8"').replace('encoding="utf-16"', 'encoding="UTF-8"')
        with open(dest_f, 'w', encoding='utf-8') as wf:
            wf.write(c_utf8)
    log_step(f"Synchronized {len(book_files)} UTF-8 book files in {cscd_dir}.")

    # 2. Create chapter shortcuts (symlinks)
    toc_files = glob.glob(os.path.join(cscd_dir, '*.toc.xml'))
    shortcuts = 0
    for tf in toc_files:
        bcode = os.path.basename(tf).replace('.toc.xml', '')
        target = f"{bcode}.xml"
        ttext = read_text_auto(tf)
        chunks = re.findall(r'action="cscd/([^"]+)"', ttext)
        for chunk in chunks:
            cpath = os.path.join(cscd_dir, chunk)
            if os.path.islink(cpath) or os.path.exists(cpath):
                os.remove(cpath)
            os.symlink(target, cpath)
            shortcuts += 1
    log_step(f"Created {shortcuts} chapter shortcuts pointing to 217 master books.")

    # 3. Synchronize static CSS/JS/fonts from tipitaka.org/romn
    romn_dir = os.path.join(ROOT_DIR, 'tipitaka.org', 'romn')
    site_dir = os.path.join(ROOT_DIR, 'tipitaka.org')

    for src, dst in [
        (os.path.join(romn_dir, 'css'), os.path.join(P_LATIN_PRESPLIT_DIR, 'css')),
        (os.path.join(romn_dir, 'cscd', 'tipitaka-latn.css'), os.path.join(cscd_dir, 'tipitaka-latn.css')),
        (os.path.join(romn_dir, 'cscd', 'tipitaka-latn.xsl'), os.path.join(cscd_dir, 'tipitaka-latn.xsl')),
        (os.path.join(site_dir, 'fonts'), os.path.join(P_LATIN_PRESPLIT_DIR, 'fonts')),
        (os.path.join(site_dir, 'js'), os.path.join(P_LATIN_PRESPLIT_DIR, 'js')),
        (os.path.join(site_dir, 'images'), os.path.join(P_LATIN_PRESPLIT_DIR, 'images')),
        (os.path.join(site_dir, 'favicon.ico'), os.path.join(P_LATIN_PRESPLIT_DIR, 'favicon.ico')),
        (os.path.join(site_dir, 'favicon.ico'), os.path.join(WEB_APP_DIR, 'static', 'favicon.ico'))
    ]:
        if os.path.isdir(src):
            shutil.copytree(src, dst, dirs_exist_ok=True)
        elif os.path.isfile(src):
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)

    # Permissions
    subprocess.run(['chmod', '-R', '755', P_LATIN_PRESPLIT_DIR], check=False)
    subprocess.run(['chmod', '-R', '755', WEB_APP_DIR], check=False)
    log_step("Synchronized all Roman Latin CSS, JS, fonts, and assets.")


# ---------------------------------------------------------------------------
# Stage 4: Verification & Service Restart
# ---------------------------------------------------------------------------
def verify_and_restart():
    log("STAGE 4", "Verifying System & Reloading Web Services")

    # 1. Test database integrity
    conn = sqlite3.connect(WEB_DB_FILE)
    cur = conn.cursor()
    cur.execute("SELECT count(*) FROM books;")
    b_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM chapters;")
    c_count = cur.fetchone()[0]
    cur.execute("SELECT count(*) FROM paragraphs_fts;")
    p_count = cur.fetchone()[0]
    conn.close()

    assert b_count == 217, f"Expected 217 books, found {b_count}"
    assert c_count > 2500, f"Expected >2500 chapters, found {c_count}"
    assert p_count > 500000, f"Expected >500000 paragraphs in FTS5, found {p_count}"
    log_step(f"Database Integrity Check Passed: {b_count} books, {c_count} chapters, {p_count} FTS5 paragraphs.")

    # 2. Restart systemd service if present
    service_restarted = False
    try:
        res = subprocess.run(['sudo', 'systemctl', 'restart', 'tipitaka.service'], capture_output=True, text=True)
        if res.returncode == 0:
            subprocess.run(['sudo', 'systemctl', 'reload', 'nginx'], capture_output=True, text=True)
            log_step("Restarted 'tipitaka.service' and reloaded 'nginx'.")
            service_restarted = True
    except Exception as e:
        log_warn(f"Could not restart systemd service (non-critical): {e}")

    # 3. Test HTTP endpoints
    time.sleep(1)
    test_urls = [
        ('Root Reader HTML', 'http://localhost/'),
        ('API Tree', 'http://localhost/api/tree'),
        ('API Book (Pārājikapāḷi)', 'http://localhost/api/book/vin01m.mul'),
        ('API Search (kusalā)', 'http://localhost/api/search?q=kusal%C4%81')
    ]

    for label, url in test_urls:
        try:
            req = urllib.request.urlopen(url, timeout=5)
            log_step(f"HTTP Endpoint OK: {label} [{req.status}] ({url})")
        except Exception as e:
            log_warn(f"Endpoint test failed for {url}: {e}")

    log("COMPLETE", "Tipitaka build and deployment pipeline completed successfully!")


# ---------------------------------------------------------------------------
# CLI Argument Parser & Entrypoint
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Tipitaka XML Build & Update Pipeline (Devanagari -> Roman Latin -> SQLite -> Web)",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--all', action='store_true', default=True, help="Run all pipeline stages (default)")
    parser.add_argument('--transliterate', action='store_true', help="Run transliteration stage only")
    parser.add_argument('--build-db', action='store_true', help="Run SQLite database build only")
    parser.add_argument('--sync-assets', action='store_true', help="Synchronize web assets & shortcuts only")
    parser.add_argument('--verify', action='store_true', help="Run verification only")
    parser.add_argument('--engine', choices=['auto', 'dart', 'python'], default='auto',
                        help="Transliteration engine to use (default: auto)")

    args = parser.parse_args()

    explicit_stage = args.transliterate or args.build_db or args.sync_assets or args.verify
    start_time = time.time()

    if not explicit_stage or args.transliterate:
        run_transliteration(args.engine)

    if not explicit_stage or args.build_db:
        build_sqlite_database()

    if not explicit_stage or args.sync_assets:
        sync_web_assets()

    if not explicit_stage or args.verify:
        verify_and_restart()

    elapsed = time.time() - start_time
    print(f"\n✨ Total Pipeline Execution Time: {elapsed:.2f} seconds.\n")


if __name__ == '__main__':
    main()
