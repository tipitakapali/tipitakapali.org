#!/usr/bin/env bash
set -euo pipefail

# Packages tipitakapali.org SQLite DBs as .zip release assets, computes SHA-256
# hashes for both extracted .db and .zip files, updates assets/databases_manifest.json
# (version, updated, dbSize, size, checksum, zipSha256, url), uploads changed archives +
# databases_manifest.json to the GitHub release via `gh`, and commits + pushes
# assets/databases_manifest.json + .db_upload_hashes.json so installed apps see updates.
#
# Usage examples:
#   ./scripts/upload_db_releases.sh --dry-run
#   ./scripts/upload_db_releases.sh --only tipitaka.db,fts_tipitaka.db,translation_en.db
#   ./scripts/upload_db_releases.sh --repo tipitakapali/tipitakapali.org --tag db
#   ./scripts/upload_db_releases.sh --manifest-only
#   ./scripts/upload_db_releases.sh --no-push

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DB_DIR="${DB_DIR:-$APP_DIR/../server_api/db}"
OUT_DIR="${OUT_DIR:-$APP_DIR/build/release_assets}"
MANIFEST_PATH="${MANIFEST_PATH:-$APP_DIR/assets/databases_manifest.json}"
HASH_CACHE="${HASH_CACHE:-$APP_DIR/.db_upload_hashes.json}"
RELEASE_REPO="${RELEASE_REPO:-}"
RELEASE_TAG="${RELEASE_TAG:-db}"
ONLY_FILTER="${ONLY_FILTER:-}"
DRY_RUN=false
FORCE=false
NO_PUSH=false
MANIFEST_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) RELEASE_REPO="$2"; shift 2 ;;
    --tag) RELEASE_TAG="$2"; shift 2 ;;
    --db-dir) DB_DIR="$2"; shift 2 ;;
    --only) ONLY_FILTER="$2"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --force) FORCE=true; shift ;;
    --no-push) NO_PUSH=true; shift ;;
    --manifest-only) MANIFEST_ONLY=true; shift ;;
    -h|--help)
      sed -n '4,16p' "$0"
      exit 0
      ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
done

# Auto-detect GitHub owner/repo from git origin remote if --repo not passed.
if [[ -z "$RELEASE_REPO" ]] && git -C "$APP_DIR" remote get-url origin >/dev/null 2>&1; then
  ORIGIN_URL="$(git -C "$APP_DIR" remote get-url origin)"
  RELEASE_REPO="$(echo "$ORIGIN_URL" | sed -E 's#^(git@github\.com:|https?://github\.com/)##; s#\.git$##')"
fi

mkdir -p "$OUT_DIR"

if [[ "$MANIFEST_ONLY" != "true" && ! -d "$DB_DIR" ]]; then
  echo "DB directory not found: $DB_DIR" >&2
  exit 1
fi

python3 - "$APP_DIR" "$DB_DIR" "$OUT_DIR" "$MANIFEST_PATH" "$HASH_CACHE" "$RELEASE_REPO" "$RELEASE_TAG" "$ONLY_FILTER" "$DRY_RUN" "$FORCE" "$NO_PUSH" "$MANIFEST_ONLY" <<'PY'
import datetime
import fnmatch
import hashlib
import json
import os
import subprocess
import sys
import zipfile

(
    app_dir,
    db_dir,
    out_dir,
    manifest_path,
    hash_cache_path,
    repo,
    tag,
    only_filter,
    dry_run_s,
    force_s,
    no_push_s,
    manifest_only_s,
) = sys.argv[1:13]
dry_run = dry_run_s == "true"
force = force_s == "true"
no_push = no_push_s == "true"
manifest_only = manifest_only_s == "true"
filters = [s.strip() for s in only_filter.split(",") if s.strip()] if only_filter else []
GITHUB_ASSET_LIMIT = 2 * 1024 * 1024 * 1024  # 2 GiB GitHub release asset cap

def sha256_file(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def matches_filter(filename: str) -> bool:
    if not filters:
        return True
    return any(fnmatch.fnmatch(filename, pat) or pat == filename for pat in filters)

with open(manifest_path, "r", encoding="utf-8") as f:
    manifest_before = f.read()
manifest = json.loads(manifest_before)

if repo:
    manifest["releaseRepo"] = repo
else:
    repo = manifest.get("releaseRepo", "")

if tag:
    manifest["releaseTag"] = tag
else:
    tag = manifest.get("releaseTag", "db")

cache = {}
if os.path.exists(hash_cache_path):
    with open(hash_cache_path, "r", encoding="utf-8") as f:
        cache = json.load(f)

def collect_entries(m):
    for section in ("core", "dictionaries"):
        for _, item in m.get(section, {}).items():
            yield item
    for _, lang in m.get("languages", {}).items():
        if lang.get("translationDb"):
            yield lang["translationDb"]
        if lang.get("ftsDb"):
            yield lang["ftsDb"]

today = datetime.date.today().isoformat()
to_upload = []
updated_names = []
remote_assets = set()
release_missing = False

if repo:
    view_assets = subprocess.run(
        ["gh", "release", "view", tag, "--repo", repo, "--json", "assets"],
        capture_output=True,
        text=True,
    )
    if view_assets.returncode == 0:
        try:
            release_meta = json.loads(view_assets.stdout or "{}")
            remote_assets = {
                a.get("name", "")
                for a in release_meta.get("assets", [])
                if isinstance(a, dict) and a.get("name")
            }
        except json.JSONDecodeError:
            remote_assets = set()
    else:
        release_missing = True

if not manifest_only:
    for entry in collect_entries(manifest):
        filename = entry["filename"]
        if not matches_filter(filename):
            continue

        src_db = os.path.join(db_dir, filename)
        if not os.path.exists(src_db) or os.path.getsize(src_db) == 0:
            continue

        db_size = os.path.getsize(src_db)
        db_sha = sha256_file(src_db).lower()
        zip_name = entry.get("assetName") or f"{filename}.zip"
        zip_path = os.path.join(out_dir, zip_name)

        prev_manifest_sha = (entry.get("checksum") or "").strip().lower()
        prev_cache_sha = (cache.get(filename) or "").strip().lower()
        manifest_sha_changed = prev_manifest_sha != db_sha
        cache_sha_changed = prev_cache_sha != db_sha
        missing_zip_metadata = not entry.get("zipSha256") or not entry.get("size")
        remote_missing = bool(repo) and (zip_name not in remote_assets)
        needs_zip = (
            force
            or manifest_sha_changed
            or cache_sha_changed
            or not os.path.exists(zip_path)
            or missing_zip_metadata
        )

        if needs_zip:
            print(f"[zip] {filename} ({db_size / (1024*1024):.1f} MB) -> {zip_name}")
            if not dry_run:
                with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
                    zf.write(src_db, arcname=filename)
                zip_size = os.path.getsize(zip_path)
                zip_sha = sha256_file(zip_path).lower()
            else:
                zip_size = entry.get("size") or int(db_size * 0.45)
                zip_sha = entry.get("zipSha256") or ""

            if zip_size > GITHUB_ASSET_LIMIT:
                print(f"WARNING: {zip_name} is {zip_size / (1024**3):.2f} GiB (> 2 GiB GitHub Releases limit!)", file=sys.stderr)

            to_upload.append(zip_path)
            cache[filename] = db_sha
            if manifest_sha_changed or force:
                if prev_manifest_sha:
                    entry["version"] = int(entry.get("version") or 1) + 1
                else:
                    entry["version"] = int(entry.get("version") or 1)
                entry["updated"] = today
                updated_names.append(filename)

            entry["dbSize"] = db_size
            entry["size"] = zip_size
            entry["checksum"] = db_sha
            if zip_sha:
                entry["zipSha256"] = zip_sha
        elif os.path.exists(zip_path):
            entry["dbSize"] = db_size
            entry["size"] = os.path.getsize(zip_path)
            entry["checksum"] = db_sha
            entry["zipSha256"] = sha256_file(zip_path).lower()
            if remote_missing:
                print(f"[upload] {zip_name} (missing on release '{tag}', reusing existing archive)")
                to_upload.append(zip_path)

        if repo:
            entry["url"] = f"https://github.com/{repo}/releases/download/{tag}/{zip_name}"

manifest_after = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
manifest_changed = manifest_after != manifest_before

if not dry_run:
    if manifest_changed:
        with open(manifest_path, "w", encoding="utf-8") as f:
            f.write(manifest_after)
        print(f"Manifest updated: {manifest_path}")
    else:
        print(f"Manifest up to date: {manifest_path}")
else:
    print(f"Dry run — manifest would change: {manifest_changed}, updated entries: {updated_names}")

# Check git status on manifest/hash cache in case manual edits exist even when DB zips didn't rebuild.
rev = subprocess.run(
    ["git", "-C", app_dir, "rev-parse", "--show-toplevel"],
    capture_output=True,
    text=True,
)
git_root = rev.stdout.strip() if rev.returncode == 0 else ""
rel_manifest = os.path.relpath(manifest_path, git_root or app_dir)
rel_cache = os.path.relpath(hash_cache_path, git_root or app_dir)
git_dirty_manifest = False
if git_root:
    st = subprocess.run(
        ["git", "-C", git_root, "status", "--porcelain", "--", rel_manifest, rel_cache],
        capture_output=True,
        text=True,
    )
    git_dirty_manifest = bool(st.stdout.strip())

should_upload_release = bool(to_upload) or manifest_changed or manifest_only or release_missing
if not should_upload_release and not git_dirty_manifest:
    print("All matching DB archives and databases_manifest.json are already up to date.")
    sys.exit(0)

if dry_run:
    assets = [os.path.basename(p) for p in to_upload]
    if should_upload_release:
        assets.append(os.path.basename(manifest_path))
    print("Dry run — release assets to upload:", assets)
    if not no_push:
        print("Dry run — would commit & push:", [rel_manifest, rel_cache])
    sys.exit(0)

if should_upload_release:
    if not repo:
        print("Error: --repo <owner/repo> is required to upload releases.", file=sys.stderr)
        sys.exit(2)

    view = subprocess.run(
        ["gh", "release", "view", tag, "--repo", repo],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if view.returncode != 0:
        print(f"Creating release '{tag}' in {repo}...")
        subprocess.run(
            [
                "gh",
                "release",
                "create",
                tag,
                "--repo",
                repo,
                "--title",
                f"TipitakaPali Databases ({tag})",
                "--notes",
                "Zipped tipitakapali.org SQLite databases and databases_manifest.json",
            ],
            check=True,
        )

    upload_files = [*to_upload, manifest_path]
    cmd = ["gh", "release", "upload", tag, "--repo", repo, "--clobber", *upload_files]
    print(f"Uploading {len(upload_files)} asset(s) to {repo}@{tag}...")
    subprocess.run(cmd, check=True)

with open(hash_cache_path, "w", encoding="utf-8") as f:
    json.dump(cache, f, indent=2, sort_keys=True)
    f.write("\n")

if not no_push and git_root:
    subprocess.run(
        ["git", "-C", git_root, "add", "--", rel_manifest, rel_cache],
        check=True,
    )
    diff_cached = subprocess.run(
        ["git", "-C", git_root, "diff", "--cached", "--quiet", "--", rel_manifest, rel_cache],
    )
    if diff_cached.returncode != 0:
        summary = ", ".join(updated_names[:4])
        if len(updated_names) > 4:
            summary += f", +{len(updated_names) - 4} more"
        commit_msg = (
            f"Update databases_manifest.json ({summary})"
            if summary
            else f"Update databases_manifest.json ({today})"
        )
        subprocess.run(
            ["git", "-C", git_root, "commit", "--only", rel_manifest, rel_cache, "-m", commit_msg],
            check=True,
        )
        branch = subprocess.run(
            ["git", "-C", git_root, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        if branch and branch != "HEAD":
            print(f"Pushing {rel_manifest} to origin/{branch} so installed apps see the update...")
            subprocess.run(["git", "-C", git_root, "push", "origin", branch], check=True)
        else:
            print("Warning: detached HEAD; committed manifest locally but skipped git push.", file=sys.stderr)
    else:
        print("No git changes in manifest/hash cache to push.")
PY
