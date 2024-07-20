# Tipitakapali.org Computer Software

Offline applications for Windows, Linux, and Mac (Intel x64, Mac Silicon arm64 (M1, M2..) ) can be downloaded from:

[https://github.com/tipitakapali/tipitakapali.org/releases](https://github.com/tipitakapali/tipitakapali.org/releases)

Please note: Since the code is not signed with a paid certificate, do not install from unknown sources.

Each release file includes a `sha512` value in its respective `.yml` file for verification.

On Unix like Ubuntu, you can check for example:

```bash 

echo test > test.txt       

sha512sum test.txt | awk '{print $1}' | xxd -r -p | base64 

Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEv
fMNXGUXBIw==

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


- For both Apple Silicon (arm64) **M1, M2 etc..** and **Intel** x64 machines, download the `${{ env.VERSION }}-universal.dmg` build. It has a larger size, but can be installed on both machines. 



---

## Mobile App:

- We intend to develop mobile apps in the future. We may update it here in this readme file.


Be well and happy!