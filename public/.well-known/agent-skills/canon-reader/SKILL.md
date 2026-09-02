---
name: canon-reader
description: Read and retrieve texts from the 217 canonical books and 2,695 chapters of the Chaṭṭha Saṅgāyana Tipiṭaka Pāḷi Canon (Vinaya, Sutta, Abhidhamma, Añña).
---

# Pāḷi Canon Reader Skill

Use this skill to navigate the Buddhist Pāḷi Canon, fetch book contents, read specific sutta passages, or search paragraphs.

## Canon Hierarchy

1. **Vinaya Piṭaka** (Monastic Code): `vin01m`, `vin02m`, etc.
2. **Sutta Piṭaka** (Discourses):
   - Dīgha Nikāya (`s0101m`, `s0102m`, `s0103m`)
   - Majjhima Nikāya (`s0201m`, `s0202m`, `s0203m`)
   - Saṃyutta Nikāya (`s0301m` - `s0305m`)
   - Aṅguttara Nikāya (`s0401m` - `s0411m`)
   - Khuddaka Nikāya (`s0501m` Khuddakapāṭha, `s0502m` Dhammapada, `s0503m` Udāna, etc.)
3. **Abhidhamma Piṭaka** (Philosophical Analysis): Dhammasaṅgaṇī, Vibhaṅga, Paṭṭhāna, etc.
4. **Añña Texts**: Visuddhimagga, Milindapañha, and classical grammars.

## Direct URLs
- **Canonical Book URL**: `https://tipitakapali.org/book/{book_code}`
- **Specific Chapter URL**: `https://tipitakapali.org/book/{book_code}/{chapter_num}`
- **Specific Verse/Paragraph**: `https://tipitakapali.org/book/{book_code}#para-{num}`
  - Example: `https://tipitakapali.org/book/s0502m.mul#para-1` (Dhammapada Verse 1)
