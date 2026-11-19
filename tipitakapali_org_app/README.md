# Tipitaka Pali CST (`tipitakapali_org_app`)

Offline-first Flutter desktop and mobile app for **TipitakaPali.org** (CST4 Pāḷi Canon, Aṭṭhakathā, Ṭīkā, translations, and dictionaries). It bundles the static Next.js frontend (`assets/web.zip`), runs a local shelf/SQLite backend inside the app, and downloads/updates SQLite databases from GitHub Releases.

---

## Workspace Layout

This Flutter project expects the sibling `tipitakapali.org` repository alongside it for web bundle syncing and database builds:

```text
0005_new-tipitakapali-org/
├── tipitakapali.org/              # Next.js static frontend + server_api/db/*.db sources
    └── tipitakapali_org_app/          # This Flutter app directory
    ├── assets/
    │   ├── web.zip                # Packaged offline Next.js static export
    │   ├── databases_manifest.json# Database catalog, checksums, sizes & release URLs
    │   └── icons/icon.png         # Source launcher icon (1024x1024)
    ├── install/linux/
    │   └── tipitakapali.desktop   # Linux desktop entry
    └── scripts/
        ├── sync_web_bundle.sh     # Builds root tipitakapali.org & updates assets/web.zip
        └── upload_db_releases.sh  # Zips DBs, uploads to GitHub Release, updates & pushes manifest
```

---

## App Identifiers & Versioning

Version format in `pubspec.yaml` is `YY.M.D+build` (currently `26.11.14+77`). Keep the build number (`+77`) strictly increasing when publishing upgrades over the previous `tpo_flutter` releases.

| Platform | Store / Target | Identifier |
| --- | --- | --- |
| **Android** | Google Play / APK | `org.tipitakapali.android` (`android/app/build.gradle.kts`) |
| **iOS** | App Store / TestFlight | `org.tipitakapali.ios.gmlpub` (`ios/Runner.xcodeproj/project.pbxproj`) |
| **macOS** | Mac App Store | `org.tipitakapali.mac.gmlpub` (`macos/Runner/Configs/AppInfo.xcconfig`) |
| **Windows** | Microsoft Store (MSIX) | `TipitakaPali.TipitakaPaliCST` (`pubspec.yaml` `msix_config`) |
| **Linux** | GTK Desktop | `org.tipitakapali.linux` (`linux/CMakeLists.txt`, `install/linux/tipitakapali.desktop`) |

---

## Local Development & Verification

Run commands from `tipitakapali_org_app/`:

```bash
flutter pub get
flutter analyze
flutter test
flutter run -d macos   # or windows, linux, android device, ios simulator
```

If macOS or iOS builds report that the sandbox is out of sync with `Podfile.lock`:

```bash
cd ios && pod install && cd ..
# or
cd macos && pod install && cd ..
```

To regenerate platform launcher icons after editing `assets/icons/icon.png`:

```bash
dart run flutter_launcher_icons
```

---

## Syncing the Offline Web Bundle

Whenever you change web UI code in the parent `tipitakapali.org` directory, rebuild and repackage `assets/web.zip`:

```bash
cd tipitakapali_org_app
./scripts/sync_web_bundle.sh
```

What `sync_web_bundle.sh` does:

1. Runs `NEXT_EXPORT=true STATIC_EXPORT=true npm run build` inside the parent `tipitakapali.org` root.
2. Compresses `../out` into `assets/web.zip` (excluding unneeded static route directories/fonts such as `book/`, `chapter/`, `translation/`, `.well-known/`, `sitemap*`, `robots.txt`, `Noto_Serif_SC*`, and `Noto_Serif_JP*`).
3. Extracts all 5 DPD family tables (`family_compounds`, `family_idioms`, `family_root`, `family_sets`, `family_word`) from `../server_api/db/dpd_goldendict.js` (supports both minified and unminified bundles) and writes `assets/dpd_family_data.json.gz`.

After syncing, commit `assets/web.zip` and rebuild the app.

---

## Updating & Publishing Databases

Installed apps check for database updates online by fetching `databases_manifest.json` from:

`https://raw.githubusercontent.com/tipitakapali/tipitakapali.org/refs/heads/main/tipitakapali_org_app/assets/databases_manifest.json`

(falling back to the bundled `assets/databases_manifest.json` and live GitHub Release `db` metadata when needed). When a newer `tipitaka.db` or translation DB is downloaded in-app, the app automatically rebuilds the corresponding local FTS5 search index (`fts_tipitaka.db` or `fts_<lang>.db`) if needed.

### Prerequisites

- GitHub CLI (`gh`) installed and authenticated (`gh auth status`) with write access to `tipitakapali/tipitakapali.org`
- `python3` and `zip` installed
- Source `.db` files placed in `../server_api/db` (or pass `--db-dir <path>`)
- Checked out on `main` (so the script can push `assets/databases_manifest.json`)

### Upload Workflow

```bash
cd tipitakapali_org_app

# 1. Preview which DB archives and manifest fields would change
./scripts/upload_db_releases.sh --dry-run

# 2. Zip changed DBs, upload to GitHub Release `db`, update & push assets/databases_manifest.json
./scripts/upload_db_releases.sh
```

Useful options for `upload_db_releases.sh`:

| Flag | Purpose |
| --- | --- |
| `--dry-run` | Print what would be zipped, updated in the manifest, uploaded, and pushed without modifying anything. |
| `--only a.db,b.db` | Process only the named database files (comma-separated). |
| `--force` | Re-zip and re-upload matching DBs even if their SHA-256 matches `.db_upload_hashes.json`. |
| `--manifest-only` | Regenerate/upload `databases_manifest.json` from existing local `.db`/`.db.zip` files without re-zipping unchanged DBs. |
| `--no-push` | Update `assets/databases_manifest.json` and upload GitHub Release assets, but skip `git commit` & `git push`. |
| `--db-dir <path>` | Override the source DB directory (default: `../server_api/db`). |
| `--repo <owner/repo>` | Override GitHub repository (auto-detected from `git remote`, fallback `tipitakapali/tipitakapali.org`). |
| `--tag <tag>` | Override GitHub Release tag (default: `db`). |

Note: If you changed a database in place without `--force` or when editing metadata manually, confirm `updated`, `dbSize`, `size`, `checksum`, `zipSha256`, and `version` in `assets/databases_manifest.json` reflect the new release before pushing.

---

## Building & Publishing Apps

Before creating release builds for any store:
1. Update the version and increment the build number in `pubspec.yaml` (`version: YY.M.D+build`).
2. Run `./scripts/sync_web_bundle.sh` if web assets changed.
3. Run `flutter pub get && flutter test`.

### 1. Android (Google Play Store / Direct APK)

1. Configure release signing before publishing to Google Play. Currently `android/app/build.gradle.kts` sets `signingConfig = signingConfigs.getByName("debug")` in `buildTypes.release` (there is no `android/key.properties` committed). Add your upload keystore (`key.properties`) and wire `signingConfigs.create("release")` in `android/app/build.gradle.kts`.
2. Build an App Bundle for Google Play or a split/universal APK:
   ```bash
   flutter build appbundle --release
   # Output: build/app/outputs/bundle/release/app-release.aab

   # Optional standalone APK:
   flutter build apk --release
   # Output: build/app/outputs/flutter-apk/app-release.apk
   ```
3. Upload `app-release.aab` in Google Play Console under package `org.tipitakapali.android`.

### 2. iOS (App Store Connect / TestFlight)

Requires macOS with Xcode and an Apple Developer signing identity/provisioning profile for `org.tipitakapali.ios.gmlpub`:

```bash
cd ios && pod install && cd ..
flutter build ipa --release
```

- Output: `build/ios/ipa/*.ipa` (or open `ios/Runner.xcworkspace` in Xcode and use **Product > Archive**).
- Upload via Xcode Organizer or Apple's Transporter app to App Store Connect, then submit via TestFlight / App Store.

### 3. macOS (Mac App Store)

Requires macOS with Xcode and Mac App Store distribution certificates for `org.tipitakapali.mac.gmlpub` (App Sandbox and network entitlements are configured in `macos/Runner/Release.entitlements`):

```bash
cd macos && pod install && cd ..
flutter build macos --release
```

Then archive and upload via Xcode:
1. Open `macos/Runner.xcworkspace` in Xcode.
2. Select **Any Mac (Apple Silicon, Intel)** as the build destination.
3. Run **Product > Archive**.
4. In the Xcode Organizer, click **Distribute App > App Store Connect > Upload**.

### 4. Windows (Microsoft Store MSIX & Portable Zip)

Built automatically via GitHub Actions (`.github/workflows/build_windows_linux.yml`), or locally on Windows 10/11 with Visual Studio Desktop C++ workload, Windows SDK, and NuGet installed. The `msix` package is already configured under `msix_config` in `pubspec.yaml` (`store: true`).

#### Automated Build via GitHub Actions

1. Push to `main`, push a version tag (e.g. `git tag v26.11.14 && git push origin v26.11.14`), or run **Actions > Build Windows and Linux > Run workflow** on GitHub.
2. Download the Windows artifacts from the workflow run (or the GitHub Release created for a `v*` tag):
   - `tipitakapali-windows-msix`: contains `tipitakapali_org.msix` ready to upload to Microsoft Store.
   - `tipitakapali-windows-portable`: contains `tipitakapali-windows-x64.zip`.

#### Local Windows Build

```powershell
flutter pub get
flutter build windows --release
dart run msix:create --build-windows false
```

- Upload the generated `build\windows\x64\runner\Release\tipitakapali_org.msix` to your Microsoft Store submission.
- Because `store: true` is enabled in `msix_config`, the Microsoft Store handles final signing upon ingestion.
- If testing sideloaded installs locally outside the Store, use a local test certificate without `store: true`.

### 5. Linux

Built automatically via GitHub Actions (`.github/workflows/build_windows_linux.yml` in a `debian:testing` container, producing the `tipitakapali-linux-x64` artifact containing `tipitakapali-linux-x64.tar.gz`), or locally on Linux with GTK and WPE WebKit 2.0 development packages for `flutter_inappwebview_linux` installed (`clang`, `cmake`, `ninja-build`, `pkg-config`, `libgtk-3-dev`, `libsqlite3-dev`, `libepoxy-dev`, `libsecret-1-dev`, `libwayland-dev`, `libwpe-1.0-dev`, `libwpewebkit-2.0-dev`, `libwpebackend-fdo-1.0-dev`):

```bash
flutter pub get
flutter build linux --release
```

- Output bundle directory: `build/linux/x64/release/bundle/` (binary name `tipitakapali_app`, GTK app ID `org.tipitakapali.linux`).
- Desktop launcher template is provided at `install/linux/tipitakapali.desktop` (`Exec=tipitakapali_app`, `Icon=tipitakapali_app`, `StartupWMClass=org.tipitakapali.linux`) for packaging into `.tar.gz`, `.deb`, Flatpak, or Snap distributions.
