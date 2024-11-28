# Download offline Tipitakapali.org:

- [https://github.com/tipitakapali/tipitakapali.org/releases](https://github.com/tipitakapali/tipitakapali.org/releases)

## Please note:

- You can also use the online web app: [https://tipitakapali.org](https://tipitakapali.org)

- Since the code is **NOT** signed with a paid certificate, pls do not download or install from unknown sources.

Each release file includes a `sha512` value in its respective `.yml` file for verification.

<details>
<summary>On Unix like Debian/Ubuntu..., you can check for example:</summary>

```bash 

echo test > test.txt       

sha512sum test.txt | awk '{print $1}' | xxd -r -p | base64 

Dj51I0q8aPQ3ioaz9LMqGYujAYRbDNblAQbodDRXAMxmY6hsHqEl3F6SvhfJj5oPhcqdX1ldsgEv
fMNXGUXBIw==

```

</details>
