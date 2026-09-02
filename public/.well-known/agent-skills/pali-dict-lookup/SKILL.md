---
name: pali-dict-lookup
description: Query the Digital Pāḷi Dictionary (DPD) and canonical lexicons for word definitions, grammar, roots, case inflections, and compound decompositions.
---

# Digital Pāḷi Dictionary (DPD) Lookup

Use this skill when you need accurate lexical definitions, grammatical analysis, declension tables, or roots for terms found in the Pāḷi Canon.

## API Usage

### Primary DPD Lookup
- **URL**: `GET https://api.tipitakapali.org/api/dict/lookup?w={word}&dict=dpd`
- **Example**: `curl -s "https://api.tipitakapali.org/api/dict/lookup?w=mett%C4%81&dict=dpd"`
- **Response**:
  ```json
  {
    "word": "mettā",
    "counts": { "dpd": 1 },
    "dpd": [
      {
        "word": "mettā",
        "pos": "fem",
        "grammar": "fem, noun",
        "meaning": "loving-kindness, friendliness, goodwill",
        "html": "..."
      }
    ]
  }
  ```

### Secondary Classical Lexicons (PTS, Myanmar, Sinhala, Sanskrit)
- **URL**: `GET https://api.tipitakapali.org/api/dict/lookup?w={word}&dict=others`
- **Example**: `curl -s "https://api.tipitakapali.org/api/dict/lookup?w=mett%C4%81&dict=others"`

### Inflection Tables
- **URL**: `GET https://api.tipitakapali.org/api/dict/inf?w={table_id}`
- **Example**: `curl -s "https://api.tipitakapali.org/api/dict/inf?w=declension_mett%C4%81_1"`
