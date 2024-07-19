# Tipitakapali.org Computer Software

Offline applications for Windows, Linux, and Mac (Intel x64, Mac Silicon arm64 (M1, M2..) ) can be downloaded from:

[https://github.com/tipitakapali/tipitakapali.org/releases](https://github.com/tipitakapali/tipitakapali.org/releases)

Please note: Since the code is not signed with a paid certificate, do not install from unknown sources.

Each release file includes a `sha512` value in its respective `.yml` file for verification.

On Unix like Ubuntu, you can check for example:

```bash 

sha512sum Tipitakapali.org-24.7.19-arm64.dmg | awk '{print $1}' | xxd -r -p | base64

bn89Z8Mx6p3iG2xHRByU6zLueYFzLllrdrW+WoFpis8gCNfyqftwqaMtlrT1UvwpvIj7/WlUag86
zih6gOxZRg==

```

## Naming Convention

Releases follow this naming pattern: `Tipitakapali.org-{version[-architecture]}.{ext}`

## For Windows:

- Download the `.exe` file.

---

## For Linux:

- Recommended: Download the `.AppImage` file.

- Alternatively, download the `.deb` file.

---

## For Mac:


- For Apple Silicon M1, M2 etc.. (arm64) machines: download the `-arm64.dmg` file.

- For Mac Intel x64 machines: download `Tipitakapali.org-{version}.dmg`.



---

## Mobile App:

- We intend to develop mobile apps in the future. We may update it here in this readme file.


Be well and happy!