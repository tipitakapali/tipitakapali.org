#!/usr/bin/env python3
"""
submit_indexnow.py
==================
Submits canonical URLs from public/sitemap.xml (or explicit CLI URLs) to the
IndexNow API (https://api.indexnow.org/indexnow), notifying Bing, Yandex,
Seznam, Naver, and Yep within minutes of content updates.

Key verification file:
  public/<32-hex-key>.txt  -> served at https://tipitakapali.org/<key>.txt

Usage:
  # Preview payload without making network requests
  python3 scripts/submit_indexnow.py --dry-run

  # Submit all canonical URLs from public/sitemap.xml
  python3 scripts/submit_indexnow.py

  # Verify live key file is reachable before submitting
  python3 scripts/submit_indexnow.py --verify-live

  # Submit specific updated URLs only
  python3 scripts/submit_indexnow.py --urls https://tipitakapali.org/ https://tipitakapali.org/info
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

DEFAULT_SITE_URL = "https://tipitakapali.org"
DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow"
KEY_FILE_RE = re.compile(r"^[0-9a-f]{32}\.txt$")
MAX_URLS_PER_BATCH = 10000


def discover_key_file(public_dir: Path):
    """Locate a 32-char lowercase hex IndexNow key file in public/."""
    if not public_dir.exists():
        return None, None
    matches = sorted(p for p in public_dir.iterdir() if p.is_file() and KEY_FILE_RE.match(p.name))
    if not matches:
        return None, None
    key_file = matches[0]
    key = key_file.read_text(encoding="utf-8").strip()
    expected = key_file.stem
    if key != expected:
        raise ValueError(f"IndexNow key file {key_file.name} content ({key!r}) does not match filename stem ({expected!r})")
    return key, key_file


def extract_urls_from_sitemap(sitemap_path: Path):
    """Extract all <loc> URLs from a standard XML sitemap."""
    if not sitemap_path.exists():
        raise FileNotFoundError(f"Sitemap not found: {sitemap_path}")
    tree = ET.parse(str(sitemap_path))
    root = tree.getroot()
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"
    urls = []
    for loc in root.findall(f".//{ns}loc"):
        if loc.text and loc.text.strip():
            urls.append(loc.text.strip())
    # Deduplicate preserving order
    seen = set()
    unique_urls = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            unique_urls.append(u)
    return unique_urls


def verify_live_key(key_location: str, expected_key: str, timeout: int = 15):
    """Verify the hosted IndexNow verification key file returns 200 and matches."""
    req = urllib.request.Request(key_location, headers={"User-Agent": "TipitakaPali-IndexNow/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        status = resp.status
        body = resp.read().decode("utf-8", errors="replace").strip()
    if status != 200:
        raise RuntimeError(f"Key URL {key_location} returned HTTP {status}")
    if body != expected_key:
        raise RuntimeError(f"Key URL {key_location} body {body!r} did not match expected key {expected_key!r}")
    return True


def build_payload(site_url: str, key: str, urls: list):
    parsed = urllib.parse.urlparse(site_url)
    host = parsed.netloc
    key_location = f"{site_url.rstrip('/')}/{key}.txt"
    return {
        "host": host,
        "key": key,
        "keyLocation": key_location,
        "urlList": urls,
    }


def submit_batch(endpoint: str, payload: dict, timeout: int = 30):
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "TipitakaPali-IndexNow/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", errors="replace")


def main():
    script_dir = Path(__file__).resolve().parent
    web_app_dir = script_dir.parent
    public_dir = web_app_dir / "public"

    parser = argparse.ArgumentParser(description="Submit canonical URLs to IndexNow (Bing, Yandex, etc.)")
    parser.add_argument("--site-url", default=os.environ.get("SITE_URL", DEFAULT_SITE_URL))
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--key", default=os.environ.get("INDEXNOW_KEY", ""))
    parser.add_argument("--sitemap", default=str(public_dir / "sitemap.xml"))
    parser.add_argument("--urls", nargs="*", help="Explicit URLs to submit instead of reading sitemap.xml")
    parser.add_argument("--verify-live", action="store_true", help="Verify https://<host>/<key>.txt is live first")
    parser.add_argument("--dry-run", action="store_true", help="Validate key and print payload without submitting")
    args = parser.parse_args()

    site_url = args.site_url.rstrip("/")
    key = args.key.strip()
    key_file = None

    if not key:
        key, key_file = discover_key_file(public_dir)
    if not key:
        print(f"[✗] No IndexNow key found in {public_dir} or INDEXNOW_KEY env var.", file=sys.stderr)
        sys.exit(1)

    if args.urls:
        urls = [u.strip() for u in args.urls if u.strip()]
    else:
        urls = extract_urls_from_sitemap(Path(args.sitemap))

    if not urls:
        print("[✗] No URLs found to submit.", file=sys.stderr)
        sys.exit(1)

    parsed_host = urllib.parse.urlparse(site_url).netloc
    bad_host_urls = [u for u in urls if urllib.parse.urlparse(u).netloc != parsed_host]
    if bad_host_urls:
        print(f"[✗] Found {len(bad_host_urls)} URL(s) not matching host {parsed_host}: {bad_host_urls[:3]}", file=sys.stderr)
        sys.exit(1)

    key_location = f"{site_url}/{key}.txt"
    print(f"[*] IndexNow host        : {parsed_host}")
    print(f"[*] IndexNow keyLocation : {key_location}" + (f" (local: {key_file.name})" if key_file else ""))
    print(f"[*] IndexNow endpoint    : {args.endpoint}")
    print(f"[*] URLs to submit       : {len(urls)}")

    if args.verify_live:
        print(f"[*] Verifying live key file at {key_location}...")
        verify_live_key(key_location, key)
        print("[✓] Live key verification succeeded (HTTP 200, key matches).")

    batches = [urls[i:i + MAX_URLS_PER_BATCH] for i in range(0, len(urls), MAX_URLS_PER_BATCH)]

    for b_idx, batch in enumerate(batches, 1):
        payload = build_payload(site_url, key, batch)
        if args.dry_run:
            preview = dict(payload)
            if len(preview["urlList"]) > 10:
                preview["urlList"] = preview["urlList"][:5] + [f"... ({len(batch) - 8} more) ..."] + preview["urlList"][-3:]
            print(f"\n[DRY-RUN] Batch {b_idx}/{len(batches)} ({len(batch)} URLs):")
            print(json.dumps(preview, indent=2, ensure_ascii=False))
            continue

        status, body = submit_batch(args.endpoint, payload)
        if status in (200, 202):
            label = "OK" if status == 200 else "Accepted (key verification pending)"
            print(f"[✓] Batch {b_idx}/{len(batches)} submitted ({len(batch)} URLs) -> HTTP {status} {label}")
        else:
            print(f"[✗] Batch {b_idx}/{len(batches)} failed -> HTTP {status}: {body}", file=sys.stderr)
            sys.exit(1)

    if args.dry_run:
        print("\n[✓] Dry run validated successfully.")


if __name__ == "__main__":
    main()
