'use strict';

const dictEngine = require('./dictEngine');

// Stop words to exclude from naive token matching
const QUERY_STOP_WORDS = new Set([
  'explain', 'what', 'which', 'where', 'when', 'who', 'how', 'why',
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'from', 'about', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'their', 'there', 'these', 'those',
  'this', 'that', 'they', 'them', 'canonical', 'definitions', 'definition',
  'sutta', 'suttas', 'relevant', 'quote', 'passages', 'passage', 'text', 'please',
  'tell', 'me', 'give', 'list', 'show', 'explore', 'between', 'exact',
  'tìm', 'giúp', 'tôi', 'bài', 'kinh', 'có', 'tên', 'giống', 'như', 'hay', 'cho', 'biết',
  'số', 'hiệu', 'và', 'tóm', 'tắt', 'nội', 'dung', 'chính', 'với', 'trích', 'dẫn',
  'về', 'điều', 'gì', 'ý', 'nghĩa', 'dạy', 'những', 'của', 'đức', 'phật',
  'ရှာပေးပါ', 'သုတ်', 'သို့မဟုတ်', 'ကဲ့သို့', 'အမည်ရှိသော', 'ဖော်ပြပေးပါ', 'အကြောင်း', 'ရှင်းပြပါ'
]);

// Strip terminal vowels for Pali stem generation
function extractPaliStem(word) {
  if (!word || typeof word !== 'string') return '';
  const clean = word.trim().toLowerCase().replace(/[^a-zāīūṅñṭḍṇḷṃ]/gi, '');
  if (clean.length < 3) return clean;
  return clean.replace(/[aāeo]$/i, '');
}

// Detect language of inquiry
function detectLanguage(text) {
  if (!text) return 'en';
  if (/[\u1000-\u109F]/.test(text)) return 'my';
  if (/[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i.test(text)) return 'vi';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
  if (/[āīūṅñṭḍṇḷṃ]/i.test(text)) return 'pi';
  return 'en';
}

// ═══════════════════════════════════════════════════════════════════════════
//  CANONICAL CITATION PARSER & DIRECT DATABASE GROUNDING
// ═══════════════════════════════════════════════════════════════════════════

function normalizeBurmeseDigits(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[၀-၉]/g, (d) => String('၀၁၂၃၄၅၆၇၈၉'.indexOf(d)));
}

function parseCanonicalCitation(text) {
  if (!text || typeof text !== 'string') return null;
  // Convert Burmese digits to Arabic numbers first
  const normalized = normalizeBurmeseDigits(text);

  // 1. Match standard citations: MN 118, M-118, DN 16, D-16, SN 56.11, SN 12.2, AN 3.65, AN 4.24, Dhp 183, Dhp 1
  const regex = /\b(?:(MN|M|DN|D|SN|S|AN|A|Dhp|Khp|Ud|Iti|Snp)\s*[-.:/]?\s*([0-9]+)(?:[.:/]([0-9]+))?)\b/i;
  const m = normalized.match(regex);
  if (m) {
    let book = m[1].toUpperCase();
    if (book === 'M') book = 'MN';
    if (book === 'D') book = 'DN';
    if (book === 'S') book = 'SN';
    if (book === 'A') book = 'AN';
    const num = parseInt(m[2], 10);
    const subNum = m[3] !== undefined ? parseInt(m[3], 10) : null;
    return { book, num, subNum, raw: m[0] };
  }

  // 2. Check Vietnamese Dhp pattern: 'Pháp Cú câu 1', 'Pháp Cú 183', 'Kinh Pháp Cú số 1'
  const dhpVi = normalized.match(/ph[aá]p\s*c[uú](?:\s*(?:c[aâ]u|k[eệ]|b[aà]i|s[oố])?\s*([0-9]+))?/i);
  if (dhpVi) {
    return { book: 'DHP', num: dhpVi[1] ? parseInt(dhpVi[1], 10) : 1, subNum: null, raw: dhpVi[0] };
  }

  // 3. Check Vietnamese Nikāya patterns
  const mnVi = normalized.match(/trung\s*b[ộo](?:\s*(?:kinh|s[oố]|b[aà]i)?\s*([0-9]+))/i);
  if (mnVi) return { book: 'MN', num: parseInt(mnVi[1], 10), subNum: null, raw: mnVi[0] };

  const dnVi = normalized.match(/tr[uư][ờo]ng\s*b[ộo](?:\s*(?:kinh|s[oố]|b[aà]i)?\s*([0-9]+))/i);
  if (dnVi) return { book: 'DN', num: parseInt(dnVi[1], 10), subNum: null, raw: dnVi[0] };

  const snVi = normalized.match(/t[uư][ơo]ng\s*[uư]ng(?:\s*(?:kinh|s[oố]|b[aà]i)?\s*([0-9]+)(?:[.:/]([0-9]+))?)/i);
  if (snVi) return { book: 'SN', num: parseInt(snVi[1], 10), subNum: snVi[2] ? parseInt(snVi[2], 10) : null, raw: snVi[0] };

  const anVi = normalized.match(/t[aă]ng\s*chi(?:\s*(?:kinh|s[oố]|b[aà]i)?\s*([0-9]+)(?:[.:/]([0-9]+))?)/i);
  if (anVi) return { book: 'AN', num: parseInt(anVi[1], 10), subNum: anVi[2] ? parseInt(anVi[2], 10) : null, raw: anVi[0] };

  // 4. Check Burmese Nikāya patterns
  const mnMy = normalized.match(/(?:မဇ္ဈိမ|မဇ္ဈိမနိကာယ်)\s*(?:အမှတ်|သုတ်)?\s*([0-9]+)/);
  if (mnMy) return { book: 'MN', num: parseInt(mnMy[1], 10), subNum: null, raw: mnMy[0] };

  const dnMy = normalized.match(/(?:ဒီဃ|ဒီဃနိကာယ်)\s*(?:အမှတ်|သုတ်)?\s*([0-9]+)/);
  if (dnMy) return { book: 'DN', num: parseInt(dnMy[1], 10), subNum: null, raw: dnMy[0] };

  const snMy = normalized.match(/(?:သံယုတ်|သံယုတ္တနိကာယ်)\s*(?:အမှတ်)?\s*([0-9]+)(?:[.:/]([0-9]+))?/);
  if (snMy) return { book: 'SN', num: parseInt(snMy[1], 10), subNum: snMy[2] ? parseInt(snMy[2], 10) : null, raw: snMy[0] };

  const anMy = normalized.match(/(?:အင်္ဂုတ္တိုရ်|အင်္ဂုတ္တရနိကာယ်)\s*(?:အမှတ်)?\s*([0-9]+)(?:[.:/]([0-9]+))?/);
  if (anMy) return { book: 'AN', num: parseInt(anMy[1], 10), subNum: anMy[2] ? parseInt(anMy[2], 10) : null, raw: anMy[0] };

  const dhpMy = normalized.match(/(?:ဓမ္မပဒ)\s*(?:ဂါထာ)?\s*([0-9]+)/);
  if (dhpMy) return { book: 'DHP', num: parseInt(dhpMy[1], 10), subNum: null, raw: dhpMy[0] };

  return null;
}

function resolveCanonicalCitation(book, num, subNum, dbTipitaka) {
  if (!book || !num) return null;
  const b = book.toUpperCase();
  const n = parseInt(num, 10);
  const sub = subNum !== undefined && subNum !== null ? parseInt(subNum, 10) : null;

  // 1. Majjhima Nikāya (MN 1 - 152)
  if (b === 'MN' && n >= 1 && n <= 152) {
    let bookCode, chapIdx, suttaInVagga;
    if (n <= 50) {
      bookCode = 's0201m.mul';
      chapIdx = Math.floor((n - 1) / 10);
      suttaInVagga = ((n - 1) % 10) + 1;
    } else if (n <= 100) {
      bookCode = 's0202m.mul';
      chapIdx = Math.floor((n - 51) / 10);
      suttaInVagga = ((n - 51) % 10) + 1;
    } else {
      bookCode = 's0203m.mul';
      const rem = n - 100;
      if (rem <= 10) { chapIdx = 0; suttaInVagga = rem; }
      else if (rem <= 20) { chapIdx = 1; suttaInVagga = rem - 10; }
      else if (rem <= 30) { chapIdx = 2; suttaInVagga = rem - 20; }
      else if (rem <= 42) { chapIdx = 3; suttaInVagga = rem - 30; }
      else { chapIdx = 4; suttaInVagga = rem - 42; }
    }

    let suttaTitle = `MN ${n}`;
    let startPara = null;
    let endPara = null;

    if (dbTipitaka) {
      try {
        const row = dbTipitaka.prepare(`
          SELECT DISTINCT book_code, chapter_index, sutta_title, MIN(para_index) as start_para, MAX(para_index) as end_para
          FROM canon_paragraphs
          WHERE book_code = ? AND chapter_index = ? AND sutta_title LIKE ?
          GROUP BY sutta_title
        `).get(bookCode, chapIdx, `${suttaInVagga}.%`);

        if (row) {
          suttaTitle = row.sutta_title.replace(/^[0-9]+\.\s*/, '').replace(/ṃ$/, '').trim();
          startPara = row.start_para;
          endPara = row.end_para;
        }
      } catch (e) {}
    }

    return {
      citation: `MN ${n}`,
      sutta_name: `${suttaTitle} (MN ${n})`,
      book_code: bookCode,
      chapter_index: chapIdx,
      start_para: startPara,
      end_para: endPara,
      nikaya: 'mn',
    };
  }

  // 2. Dīgha Nikāya (DN 1 - 34)
  if (b === 'DN' && n >= 1 && n <= 34) {
    let bookCode, chapIdx;
    if (n <= 13) { bookCode = 's0101m.mul'; chapIdx = n - 1; }
    else if (n <= 23) { bookCode = 's0102m.mul'; chapIdx = n - 14; }
    else { bookCode = 's0103m.mul'; chapIdx = n - 24; }

    let suttaTitle = `DN ${n}`;
    let startPara = null;
    let endPara = null;

    if (dbTipitaka) {
      try {
        const chap = dbTipitaka.prepare('SELECT title FROM chapters WHERE book_code = ? AND chapter_index = ?').get(bookCode, chapIdx);
        if (chap) {
          suttaTitle = chap.title.replace(/^[0-9]+\.\s*/, '').replace(/ṃ$/, '').trim();
        }
        const bounds = dbTipitaka.prepare(`
          SELECT MIN(para_index) as start_para, MAX(para_index) as end_para
          FROM canon_paragraphs
          WHERE book_code = ? AND chapter_index = ?
        `).get(bookCode, chapIdx);
        if (bounds) {
          startPara = bounds.start_para;
          endPara = bounds.end_para;
        }
      } catch (e) {}
    }

    return {
      citation: `DN ${n}`,
      sutta_name: `${suttaTitle} (DN ${n})`,
      book_code: bookCode,
      chapter_index: chapIdx,
      start_para: startPara,
      end_para: endPara,
      nikaya: 'dn',
    };
  }

  // 3. Saṃyutta Nikāya (SN 1 - 56)
  if (b === 'SN' && n >= 1 && n <= 56) {
    let bookCode, chapIdx;
    if (n <= 11) { bookCode = 's0301m.mul'; chapIdx = n - 1; }
    else if (n <= 21) { bookCode = 's0302m.mul'; chapIdx = n - 12; }
    else if (n <= 34) { bookCode = 's0303m.mul'; chapIdx = n - 22; }
    else if (n <= 44) { bookCode = 's0304m.mul'; chapIdx = n - 35; }
    else { bookCode = 's0305m.mul'; chapIdx = n - 45; }

    let suttaTitle = `SN ${n}${sub ? '.' + sub : ''}`;
    let startPara = null;
    let endPara = null;

    // Special known SN suttas
    if (n === 56 && sub === 11) {
      suttaTitle = 'Dhammacakkappavattana Sutta';
      startPara = 2473;
      endPara = 2485;
    } else if (n === 22 && sub === 59) {
      suttaTitle = 'Anattalakkhaṇa Sutta';
      startPara = 322;
      endPara = 333;
    } else if (n === 12 && sub === 2) {
      suttaTitle = 'Paṭiccasamuppāda-vibhaṅga Sutta';
      startPara = 2;
      endPara = 15;
    } else if (n === 35 && sub === 28) {
      suttaTitle = 'Ādittapariyāya Sutta (Fire Sermon)';
      startPara = 28;
      endPara = 35;
    } else if (n === 45 && sub === 8) {
      suttaTitle = 'Maggavibhaṅga Sutta';
      startPara = 8;
      endPara = 20;
    } else if (dbTipitaka) {
      try {
        if (sub) {
          const sRow = dbTipitaka.prepare(`
            SELECT DISTINCT sutta_title, MIN(para_index) as start_para, MAX(para_index) as end_para
            FROM canon_paragraphs
            WHERE book_code = ? AND chapter_index = ? AND (sutta_title LIKE ? OR para_num = ?)
            GROUP BY sutta_title
          `).get(bookCode, chapIdx, `${sub}.%`, String(sub));
          if (sRow) {
            suttaTitle = sRow.sutta_title.replace(/^[0-9]+\.\s*/, '').replace(/ṃ$/, '').trim();
            startPara = sRow.start_para;
            endPara = sRow.end_para;
          }
        }
        if (!startPara) {
          const chap = dbTipitaka.prepare('SELECT title FROM chapters WHERE book_code = ? AND chapter_index = ?').get(bookCode, chapIdx);
          if (chap) suttaTitle = chap.title.replace(/^[0-9]+\.\s*/, '').replace(/ṃ$/, '').trim();
          const bounds = dbTipitaka.prepare('SELECT MIN(para_index) as start_para, MAX(para_index) as end_para FROM canon_paragraphs WHERE book_code = ? AND chapter_index = ?').get(bookCode, chapIdx);
          if (bounds) {
            startPara = bounds.start_para;
            endPara = bounds.end_para;
          }
        }
      } catch (e) {}
    }

    return {
      citation: `SN ${n}${sub ? '.' + sub : ''}`,
      sutta_name: `${suttaTitle} (SN ${n}${sub ? '.' + sub : ''})`,
      book_code: bookCode,
      chapter_index: chapIdx,
      start_para: startPara,
      end_para: endPara,
      nikaya: 'sn',
    };
  }

  // 4. Aṅguttara Nikāya (AN 1 - 11)
  if (b === 'AN' && n >= 1 && n <= 11) {
    const bookMap = {
      1: 's0401m1.mul', 2: 's0402m1.mul', 3: 's0402m2.mul', 4: 's0402m3.mul',
      5: 's0403m1.mul', 6: 's0403m2.mul', 7: 's0403m3.mul',
      8: 's0404m1.mul', 9: 's0404m2.mul', 10: 's0404m3.mul', 11: 's0404m4.mul'
    };
    const bookCode = bookMap[n];
    let suttaTitle = `AN ${n}${sub ? '.' + sub : ''}`;
    let chapIdx = 0;
    let startPara = null;
    let endPara = null;

    if (n === 3 && sub === 65) {
      suttaTitle = 'Kesamutti Sutta / Kālāma Sutta';
      chapIdx = 6;
      startPara = 586;
      endPara = 600;
    } else if (n === 4 && sub === 24) {
      suttaTitle = 'Kāḷakārāma Sutta';
      chapIdx = 2;
      startPara = 271;
      endPara = 285;
    } else if (n === 5 && sub === 161) {
      suttaTitle = 'Aghātapaṭivinaya Sutta';
      chapIdx = 16;
      startPara = 161;
      endPara = 175;
    } else if (dbTipitaka && sub) {
      try {
        const sRow = dbTipitaka.prepare(`
          SELECT DISTINCT chapter_index, sutta_title, MIN(para_index) as start_para, MAX(para_index) as end_para
          FROM canon_paragraphs
          WHERE book_code = ? AND (para_num = ? OR sutta_title LIKE ?)
          GROUP BY sutta_title
        `).get(bookCode, String(sub), `${sub}.%`);
        if (sRow) {
          suttaTitle = sRow.sutta_title.replace(/^[0-9]+\.\s*/, '').replace(/ṃ$/, '').trim();
          chapIdx = sRow.chapter_index;
          startPara = sRow.start_para;
          endPara = sRow.end_para;
        }
      } catch (e) {}
    }

    return {
      citation: `AN ${n}${sub ? '.' + sub : ''}`,
      sutta_name: `${suttaTitle} (AN ${n}${sub ? '.' + sub : ''})`,
      book_code: bookCode,
      chapter_index: chapIdx,
      start_para: startPara || 0,
      end_para: endPara || 10,
      nikaya: 'an',
    };
  }

  // 5. Dhammapada (Dhp 1 - 423)
  if (b === 'DHP') {
    const bookCode = 's0502m.mul';
    let chapIdx = 0;
    let startPara = n;
    let endPara = n + 3;

    if (dbTipitaka) {
      try {
        const pRow = dbTipitaka.prepare('SELECT chapter_index, para_index FROM canon_paragraphs WHERE book_code = ? AND para_num = ? LIMIT 1').get(bookCode, String(n));
        if (pRow) {
          chapIdx = pRow.chapter_index;
          startPara = pRow.para_index;
          endPara = pRow.para_index + 3;
        }
      } catch (e) {}
    }

    return {
      citation: `Dhp ${n}`,
      sutta_name: `Dhammapada verse ${n}`,
      book_code: bookCode,
      chapter_index: chapIdx,
      start_para: startPara,
      end_para: endPara,
      nikaya: 'dhp',
    };
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CANONICAL THEMATIC KNOWLEDGE BASE (MULTILINGUAL)
// ═══════════════════════════════════════════════════════════════════════════

const CANONICAL_KNOWLEDGE_BASE = [
  // 1. Honey Ball / Madhupiṇḍika (MN 18)
  {
    patterns: [/mật\s*hoàn/i, /bánh\s*mật/i, /madhupi[ṇn][ḍd]ik/i, /honey\s*ball/i, /honey\s*cake/i, /honeyball/i, /ပျားလုံး/i, /ပျားမုန့်/i],
    intent: 'sutta_lookup',
    target_suttas: ['Madhupiṇḍika Sutta (MN 18)'],
    pali_terms: ['madhupiṇḍika', 'madhu', 'papañca', 'papañcasaññāsaṅkhā', 'cakkhu', 'rūpa', 'cakkhuviññāṇa', 'phassa', 'vedanā', 'saññā', 'vitakka'],
    locations: { pitakas: ['sutta'], nikayas: ['mn'], books: ['s0201m.mul'] },
    default_sutta_para: 669,
    strategy: [
      'Fetch discourse opening from Majjhima Nikāya (s0201m.mul:c1:p669).',
      'Read paragraphs §669–§678 for Mahākaccāna\'s exposition of mental proliferation (papañca).',
      'Examine Aṭṭhakathā commentary (s0201a.att) for the honey-ball simile.'
    ],
    summary: 'Identified inquiry for the "Honey-ball Discourse" (Madhupiṇḍika Sutta, MN 18) in the Majjhima Nikāya on papañca (conceptual proliferation).'
  },

  // 2. Mindfulness of Breathing / Ānāpānassati (MN 118)
  {
    patterns: [/quán\s*niệm\s*hơi\s*thở/i, /nhập\s*tức\s*xuất\s*tức/i, /[aā]n[aā]p[aā]nassati/i, /[aā]n[aā]p[aā]nasati/i, /mindfulness\s*of\s*breathing/i, /breath\s*meditation/i, /အာနာပါနဿတိ/i, /အာနာပါန/i],
    intent: 'sutta_lookup',
    target_suttas: ['Ānāpānassati Sutta (MN 118)'],
    pali_terms: ['ānāpānassati', 'dīghaṃ assasanto', 'kāyasaṅkhāra', 'passambhayam', 'pīti', 'sukha', 'cittasaṅkhāra', 'aniccānupassī', 'virāgānupassī', 'nirodhānupassī', 'paṭinissaggānupassī'],
    locations: { pitakas: ['sutta'], nikayas: ['mn'], books: ['s0203m.mul'] },
    default_sutta_para: 438,
    strategy: [
      'Fetch root discourse from Majjhima Nikāya (s0203m.mul:c1:p438).',
      'Read the 16 steps of breath meditation across the 4 tetrads (kāya, vedanā, citta, dhamma).',
      'Cross-reference how Ānāpānassati fulfills the 4 Satipaṭṭhāna and 7 Bojjhaṅga.'
    ],
    summary: 'Identified inquiry for the Ānāpānassati Sutta (MN 118) on the sixteen steps of mindfulness of breathing.'
  },

  // 3. Great Passing Away / Mahāparinibbāna (DN 16)
  {
    patterns: [/đại\s*bát\s*niết\s*bàn/i, /mah[aā]parinibb[aā]na/i, /parinibb[aā]na\s*sutta/i, /last\s*days\s*of\s*the\s*buddha/i, /last\s*words/i, /lời\s*dạy\s*cuối\s*cùng/i, /မဟာပရိနိဗ္ဗာန/i],
    intent: 'sutta_lookup',
    target_suttas: ['Mahāparinibbāna Sutta (DN 16)'],
    pali_terms: ['mahāparinibbāna', 'vayadhammā saṅkhārā', 'appamādena sampādetha', 'catusaṃvejanīyaṭṭhānāni', 'dhammadīpā', 'attadīpā', 'catumahāpadesa'],
    locations: { pitakas: ['sutta'], nikayas: ['dn'], books: ['s0102m.mul'] },
    default_sutta_para: 286,
    strategy: [
      'Fetch opening and key passages from Dīgha Nikāya (s0102m.mul:c2:p286).',
      'Read the Buddha\'s final instructions: "vayadhammā saṅkhārā appamādena sampādetha" (§588).',
      'Review the Four Great Authorities (cattāro mahāpadesā) and self-refuge instruction (attadīpā viharatha).'
    ],
    summary: 'Identified inquiry for the Mahāparinibbāna Sutta (DN 16) in the Dīgha Nikāya on the Buddha\'s final journey and instructions.'
  },

  // 4. Four Noble Truths / Dhammacakkappavattana (SN 56.11, MN 141)
  {
    patterns: [/tứ\s*diệu\s*đế/i, /bốn\s*thánh\s*đế/i, /four\s*noble\s*truths/i, /chuyển\s*pháp\s*luân/i, /dhammacakka/i, /ariyasacc/i, /သစ္စာလေးပါး/i, /ဓမ္မစကြာ/i],
    intent: 'doctrinal_explanation',
    target_suttas: ['Dhammacakkappavattana Sutta (SN 56.11)', 'Saccavibhaṅga Sutta (MN 141)'],
    pali_terms: ['cattāri ariyasaccāni', 'dukkha', 'samudaya', 'nirodha', 'magga', 'pariññeyya', 'pahātabba', 'sacchikātabba', 'bhāvetabba', 'tiparivaṭṭa'],
    locations: { pitakas: ['sutta'], nikayas: ['sn', 'mn'], books: ['s0305m.mul', 's0203m.mul'] },
    default_sutta_para: 2473,
    strategy: [
      'Retrieve First Sermon from Saṃyutta Nikāya (s0305m.mul:c11:p2473).',
      'Read canonical definitions of the 4 Truths and their 3 turnings with 12 aspects (tiparivaṭṭaṃ dvādasākāraṃ).',
      'Cross-reference Sāriputta\'s analytical breakdown in Saccavibhaṅga Sutta (MN 141, s0203m.mul §1171).'
    ],
    summary: 'Identified inquiry regarding the Four Noble Truths (Cattāri Ariyasaccāni) taught in SN 56.11 and MN 141.'
  },

  // 5. Four Foundations of Mindfulness / Satipaṭṭhāna (DN 22, MN 10)
  {
    patterns: [/tứ\s*niệm\s*xứ/i, /mah[aā]satipa[ṭt][ṭt]h[aā]na/i, /satipa[ṭt][ṭt]h[aā]na/i, /four\s*foundations\s*of\s*mindfulness/i, /quán\s*thân/i, /သတိပဋ္ဌာန်/i],
    intent: 'doctrinal_explanation',
    target_suttas: ['Mahāsatipaṭṭhāna Sutta (DN 22)', 'Satipaṭṭhāna Sutta (MN 10)'],
    pali_terms: ['cattāro satipaṭṭhānā', 'kāyānupassanā', 'vedanānupassanā', 'cittānupassanā', 'dhammānupassanā', 'ekāyano maggo', 'ātāpī', 'sampajāno', 'satimā'],
    locations: { pitakas: ['sutta'], nikayas: ['dn', 'mn'], books: ['s0102m.mul', 's0201m.mul'] },
    default_sutta_para: 1340,
    strategy: [
      'Fetch Mahāsatipaṭṭhāna Sutta from Dīgha Nikāya (s0102m.mul:c8:p1340).',
      'Review the opening "ekāyano ayaṃ maggo" and 4 contemplations.',
      'Cross-reference MN 10 (s0201m.mul §285).'
    ],
    summary: 'Identified inquiry for the Four Foundations of Mindfulness (Satipaṭṭhāna) in DN 22 and MN 10.'
  },

  // 6. Characteristic of Non-Self / Anattalakkhaṇa (SN 22.59)
  {
    patterns: [/vô\s*ngã\s*tướng/i, /anattalakkha[ṇn]a/i, /characteristic\s*of\s*non-self/i, /second\s*sermon/i, /vô\s*ngã/i, /anatt[aā]/i, /not-self/i, /non-self/i, /အနတ္တလက္ခဏ/i, /အနတ္တ/i],
    intent: 'doctrinal_explanation',
    target_suttas: ['Anattalakkhaṇa Sutta (SN 22.59)'],
    pali_terms: ['anattā', 'rūpaṃ anattā', 'vedanā anattā', 'saññā anattā', 'saṅkhārā anattā', 'viññāṇaṃ anattā', 'netaṃ mama', 'nesohamasmi', 'na meso attā'],
    locations: { pitakas: ['sutta'], nikayas: ['sn'], books: ['s0303m.mul'] },
    default_sutta_para: 322,
    strategy: [
      'Fetch the Second Sermon from Khandhasaṃyutta (s0303m.mul:c0:p322).',
      'Examine the Buddha\'s dialectical refutation of self in each of the 5 aggregates.',
      'Check the formula: "Netaṃ mama, nesohamasmi, na meso attā".'
    ],
    summary: 'Identified inquiry on the doctrine of Anattā (Non-self) in the Anattalakkhaṇa Sutta (SN 22.59).'
  },

  // 7. Noble Eightfold Path / Maggavibhaṅga (SN 45.8, MN 117)
  {
    patterns: [/bát\s*chánh\s*đạo/i, /bát\s*thánh\s*đạo/i, /noble\s*eightfold\s*path/i, /a[ṭt][ṭt]ha[ṅn]gika\s*magga/i, /eightfold\s*path/i, /မဂ္ဂင်ရှစ်ပါး/i],
    intent: 'doctrinal_explanation',
    target_suttas: ['Maggavibhaṅga Sutta (SN 45.8)', 'Mahācattārīsaka Sutta (MN 117)'],
    pali_terms: ['ariya aṭṭhaṅgika magga', 'sammādiṭṭhi', 'sammāsaṅkappa', 'sammāvācā', 'sammākammanta', 'sammā-ājīva', 'sammāvāyāma', 'sammāsati', 'sammāsamādhi'],
    locations: { pitakas: ['sutta'], nikayas: ['sn', 'mn'], books: ['s0305m.mul', 's0203m.mul'] },
    default_sutta_para: 8,
    strategy: [
      'Search SN 45.8 (s0305m.mul:c0:p8) for canonical definitions of the eight factors.',
      'Review MN 117 (s0203m.mul §423) on Right View as the forerunner.'
    ],
    summary: 'Identified inquiry regarding the Noble Eightfold Path (Ariya Aṭṭhaṅgika Magga) in SN 45.8 and MN 117.'
  },

  // 8. Dependent Origination / Paṭiccasamuppāda (SN 12.2, DN 15)
  {
    patterns: [/thập\s*nhị\s*nhân\s*duyên/i, /duyên\s*khởi/i, /pa[ṭt]iccasamupp[aā]d/i, /dependent\s*origination/i, /12\s*links/i, /ပဋိစ္စသမုပ္ပါဒ်/i],
    intent: 'doctrinal_explanation',
    target_suttas: ['Paṭiccasamuppāda-vibhaṅga Sutta (SN 12.2)', 'Mahānidāna Sutta (DN 15)'],
    pali_terms: ['paṭiccasamuppāda', 'avijjā', 'saṅkhāra', 'viññāṇa', 'nāmarūpa', 'saḷāyatana', 'phassa', 'vedanā', 'taṇhā', 'upādāna', 'bhava', 'jāti', 'jarāmaraṇa'],
    locations: { pitakas: ['sutta'], nikayas: ['sn', 'dn'], books: ['s0302m.mul', 's0102m.mul'] },
    default_sutta_para: 2,
    strategy: [
      'Retrieve canonical definitions of the 12 links in direct and reverse order (SN 12.2, s0302m.mul §2).',
      'Cross-reference Mahānidāna Sutta (DN 15, s0102m.mul §228) on consciousness and name-and-form.'
    ],
    summary: 'Identified inquiry regarding Dependent Origination (Paṭiccasamuppāda) in SN 12.2 and DN 15.'
  },

  // 9. Kālāma Sutta / Free Inquiry (AN 3.65)
  {
    patterns: [/k[aā]l[aā]ma/i, /kesamutti/i, /ca-la-ma/i, /người\s*k[aā]l[aā]ma/i, /dân\s*k[aā]l[aā]ma/i, /free\s*inquiry/i, /10\s*criteria/i],
    intent: 'sutta_lookup',
    target_suttas: ['Kesamutti Sutta / Kālāma Sutta (AN 3.65)'],
    pali_terms: ['kesamutti', 'kālāma', 'mā anussavena', 'mā paramparāya', 'mā itikirāya', 'yada tumhe kālāmā attanāva jāneyyātha', 'cattāro assāsā'],
    locations: { pitakas: ['sutta'], nikayas: ['an'], books: ['s0402m2.mul'] },
    default_sutta_para: 586,
    strategy: [
      'Read Kālāma Sutta in Aṅguttara Nikāya (s0402m2.mul:c6:p586).',
      'Examine the 10 invalid grounds of belief and the 4 consolations (cattāro assāsā).'
    ],
    summary: 'Identified inquiry for the Kālāma Sutta (Kesamutti Sutta, AN 3.65) on free inquiry and spiritual discernment.'
  },

  // 10. Dhammapada (Dhp)
  {
    patterns: [/ph[aá]p\s*c[uú]/i, /dhammapada/i, /dhp/i],
    intent: 'sutta_lookup',
    target_suttas: ['Dhammapada (Dhp)'],
    pali_terms: ['dhammapada', 'yamakavagga', 'manopubbaṅgamā dhammā', 'appamāda', 'citta', 'sabbapāpassa akaraṇaṃ'],
    locations: { pitakas: ['sutta'], nikayas: ['kn', 'dhp'], books: ['s0502m.mul'] },
    default_sutta_para: 4,
    strategy: [
      'Open Dhammapada verses in Khuddaka Nikāya (s0502m.mul).',
      'Read matching verse and cross-reference Dhammapada-Aṭṭhakathā (s0502a.att).'
    ],
    summary: 'Identified inquiry regarding the Dhammapada (Dhp) verses.'
  },

  // 11. Supreme Net / Brahmajāla (DN 1)
  {
    patterns: [/phạm\s*võng/i, /brahmaj[aā]la/i, /62\s*views/i, /s[aá]u\s*m[uư][oơ]i\s*hai\s*t[aà]\s*ki[eế]n/i],
    intent: 'sutta_lookup',
    target_suttas: ['Brahmajāla Sutta (DN 1)'],
    pali_terms: ['brahmajāla', 'cūḷasīla', 'majjhimasīla', 'mahāsīla', 'diṭṭhi', 'sassatavāda', 'ucchedavāda'],
    locations: { pitakas: ['sutta'], nikayas: ['dn'], books: ['s0101m.mul'] },
    default_sutta_para: 0,
    strategy: [
      'Fetch Brahmajāla Sutta from Dīgha Nikāya (s0101m.mul:c0:p0).',
      'Review the 3 tiers of morality and the catalog of 62 philosophical views.'
    ],
    summary: 'Identified inquiry for the Brahmajāla Sutta (DN 1) on canonical morality and the 62 views.'
  },

  // 12. Fruits of the Contemplative Life / Sāmaññaphala (DN 2)
  {
    patterns: [/sa-m[oô]n\s*qu[aả]/i, /s[aā]ma[ññ][ññ]aphala/i, /fruits\s*of\s*recluseship/i, /fruits\s*of\s*the\s*contemplative\s*life/i],
    intent: 'sutta_lookup',
    target_suttas: ['Sāmaññaphala Sutta (DN 2)'],
    pali_terms: ['sāmaññaphala', 'anupubbasikkhā', 'jhāna', 'ñāṇadassana', 'āsavakkhayañāṇa', 'ajitasattukāro'],
    locations: { pitakas: ['sutta'], nikayas: ['dn'], books: ['s0101m.mul'] },
    default_sutta_para: 216,
    strategy: [
      'Fetch Sāmaññaphala Sutta (s0101m.mul:c1:p216).',
      'Review the King Ajātasattu dialogue and the sequential benefits of monastic life.'
    ],
    summary: 'Identified inquiry for the Sāmaññaphala Sutta (DN 2) in the Dīgha Nikāya.'
  },

  // 13. Loving-Kindness / Mettā Sutta (Khp 9, Snp 1.8)
  {
    patterns: [/từ\s*bi/i, /mett[aā]\s*sutta/i, /kara[ṇn][iī]yamett/i, /loving-kindness/i, /metta/i, /tâm\s*từ/i],
    intent: 'doctrinal_explanation',
    target_suttas: ['Karaṇīyamettā Sutta (Khp 9 / Snp 1.8)'],
    pali_terms: ['karaṇīyamettāsutta', 'mettā', 'sabbe sattā bhavantu sukhitattā', 'mātā yathā niyaṃ puttaṃ', 'mānasam bhāvaye aparimāṇaṃ'],
    locations: { pitakas: ['sutta'], nikayas: ['kn'], books: ['s0501m.mul', 's0505m.mul'] },
    default_sutta_para: 10,
    strategy: [
      'Fetch Karaṇīyamettā Sutta (s0501m.mul §10 / s0505m.mul §143).',
      'Examine the simile of the mother protecting her only child with her life.'
    ],
    summary: 'Identified inquiry regarding the Karaṇīyamettā Sutta (Khp 9 / Snp 1.8) on universal loving-kindness.'
  },

  // 14. Non-canonical / Mahāyāna Reference (Kim Cang, Bát Nhã, etc.)
  {
    patterns: [/kim\s*cang/i, /b[aá]t\s*nh[aã]/i, /diamond\s*sutra/i, /heart\s*sutra/i, /vajracchedik/i, /praj[ñn][aā]p[aā]ramit/i],
    intent: 'comparison',
    target_suttas: ['Cūḷasuññata Sutta (MN 121)', 'Mahāsuññata Sutta (MN 122)', 'Suññatasaṃyutta (SN 35.85)'],
    pali_terms: ['suññatā', 'suññato lokaṃ avekkhassu', 'cūḷasuññata', 'mahāsuññata'],
    locations: { pitakas: ['sutta'], nikayas: ['mn', 'sn'], books: ['s0203m.mul', 's0304m.mul'] },
    default_sutta_para: 480,
    strategy: [
      'Explain clearly that the Diamond and Heart Sūtras are Mahāyāna Sanskrit texts outside the Theravāda Pāḷi CST canon.',
      'Guide to the primary Pāḷi canonical discourses on Suññatā: MN 121, MN 122, and SN 35.85.'
    ],
    summary: 'Identified inquiry for Mahāyāna texts (Diamond/Heart Sūtra); framing response in relation to canonical Theravāda Suññatā discourses (MN 121, MN 122).'
  }
];

// Extract potential Pali terms from user prompt using dictionary lookup
function extractTermsFromPrompt(userQuery) {
  if (!userQuery) return [];
  const words = userQuery
    .toLowerCase()
    .replace(/[^a-zāīūṅñṭḍṇḷṃ\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !QUERY_STOP_WORDS.has(w));

  const validTerms = [];
  const seen = new Set();

  for (const w of words.slice(0, 10)) {
    if (seen.has(w)) continue;
    seen.add(w);
    try {
      const res = dictEngine.lookupDPDFast(w, false);
      if (res && Array.isArray(res.dpd) && res.dpd.length > 0) {
        validTerms.push(w);
      }
    } catch (e) {}
  }
  return validTerms;
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 1: COMPREHENSIVE QUERY DECOMPOSITION (OFFLINE HEURISTIC ENGINE)
// ═══════════════════════════════════════════════════════════════════════════

function heuristicQueryUnderstanding(userQuery, conversationHistory = [], dbTipitaka = null, dbSummaries = null) {
  const trimmed = (userQuery || '').trim();
  const lang = detectLanguage(trimmed);
  const transLangs = ['en'];
  if (lang === 'vi' && !transLangs.includes('vi')) transLangs.push('vi');
  if (lang === 'my' && !transLangs.includes('my')) transLangs.push('my');

  // 1. Direct Citation Check (e.g. MN 118, DN 16, SN 56.11, AN 3.65, Dhp 183)
  const citationMatch = parseCanonicalCitation(trimmed);
  if (citationMatch) {
    const resolved = resolveCanonicalCitation(
      citationMatch.book,
      citationMatch.num,
      citationMatch.subNum,
      dbTipitaka
    );

    if (resolved) {
      const paliStems = [extractPaliStem(resolved.sutta_name), extractPaliStem(resolved.citation)].filter(Boolean);
      return {
        intent: 'sutta_lookup',
        detected_language: lang,
        core_question: trimmed,
        canonical_pali_terms: [resolved.sutta_name, resolved.citation],
        pali_stems: Array.from(new Set(paliStems.map((s) => `${s}*`))),
        target_sutta_names: [resolved.sutta_name],
        recommended_locations: {
          pitakas: ['sutta'],
          nikayas: [resolved.nikaya],
          books: [resolved.book_code],
        },
        default_sutta_para: resolved.start_para,
        translation_languages: transLangs,
        initial_search_strategy: [
          `Open ${resolved.sutta_name} in ${resolved.book_code} (paragraphs §${resolved.start_para}–§${resolved.end_para || resolved.start_para + 6}).`,
          'Retrieve root Pāḷi text with verified English and translation passages.',
          'Cross-reference classical Aṭṭhakathā commentary for doctrinal context.',
          'Examine technical Pāḷi terminology in Digital Pāḷi Dictionary (DPD).'
        ],
        user_facing_summary: `Identified inquiry for ${resolved.sutta_name} in the ${resolved.nikaya.toUpperCase()} (${resolved.book_code} §${resolved.start_para}).`,
        source: 'canonical_citation_grounding',
      };
    }
  }

  // 2. Canonical Thematic Knowledge Base Match
  const matchedKb = CANONICAL_KNOWLEDGE_BASE.find((kb) =>
    kb.patterns.some((pat) => pat.test(trimmed))
  );

  if (matchedKb) {
    const paliStems = matchedKb.pali_terms.map(extractPaliStem).filter(Boolean);
    return {
      intent: matchedKb.intent,
      detected_language: lang,
      core_question: trimmed,
      canonical_pali_terms: matchedKb.pali_terms,
      pali_stems: Array.from(new Set(paliStems.map((s) => `${s}*`))),
      target_sutta_names: matchedKb.target_suttas,
      recommended_locations: matchedKb.locations,
      default_sutta_para: matchedKb.default_sutta_para || null,
      translation_languages: transLangs,
      initial_search_strategy: matchedKb.strategy,
      user_facing_summary: matchedKb.summary,
      source: 'heuristic_kb',
    };
  }

  // 3. Database Catalog Match: Search chapters and toc for suttas matching prompt tokens
  if (dbTipitaka) {
    try {
      const words = trimmed
        .toLowerCase()
        .replace(/[^a-zāīūṅñṭḍṇḷṃ\s]/gi, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !QUERY_STOP_WORDS.has(w));

      for (const w of words.slice(0, 3)) {
        const cRow = dbTipitaka.prepare(`
          SELECT c.book_code, c.chapter_index, c.title, MIN(p.para_index) as start_para
          FROM chapters c
          JOIN canon_paragraphs p ON p.book_code = c.book_code AND p.chapter_index = c.chapter_index
          WHERE c.title LIKE ? AND c.book_code LIKE 's0%m.mul'
          GROUP BY c.book_code, c.chapter_index
          LIMIT 1
        `).get(`%${w}%`);

        if (cRow) {
          const sTitle = cRow.title.replace(/^[0-9]+\.\s*/, '').replace(/ṃ$/, '').trim();
          return {
            intent: 'sutta_lookup',
            detected_language: lang,
            core_question: trimmed,
            canonical_pali_terms: [sTitle, w],
            pali_stems: [`${extractPaliStem(w)}*`],
            target_sutta_names: [sTitle],
            recommended_locations: {
              pitakas: ['sutta'],
              nikayas: [cRow.book_code.startsWith('s01') ? 'dn' : cRow.book_code.startsWith('s02') ? 'mn' : cRow.book_code.startsWith('s03') ? 'sn' : 'an'],
              books: [cRow.book_code],
            },
            default_sutta_para: cRow.start_para,
            translation_languages: transLangs,
            initial_search_strategy: [
              `Search section titles for "${sTitle}" in ${cRow.book_code}.`,
              `Read canonical paragraphs starting at §${cRow.start_para}.`,
              'Retrieve translations and cross-reference commentary.'
            ],
            user_facing_summary: `Identified matching discourse: "${sTitle}" in ${cRow.book_code} §${cRow.start_para}.`,
            source: 'database_catalog_match',
          };
        }
      }
    } catch (e) {}
  }

  // 4. Generic Extraction via DPD Dictionary
  const detectedTerms = extractTermsFromPrompt(trimmed);
  const stems = detectedTerms.map(extractPaliStem).filter(Boolean);

  const fallbackTerms = detectedTerms.length > 0 ? detectedTerms : (trimmed.split(/\s+/).slice(0, 2));

  return {
    intent: detectedTerms.length > 0 ? 'doctrinal_explanation' : 'general_dhamma',
    detected_language: lang,
    core_question: trimmed,
    canonical_pali_terms: fallbackTerms,
    pali_stems: stems.length > 0 ? Array.from(new Set(stems.map((s) => `${s}*`))) : fallbackTerms.map((t) => `${extractPaliStem(t)}*`),
    target_sutta_names: [],
    recommended_locations: {
      pitakas: ['sutta'],
      nikayas: ['mn', 'sn', 'dn', 'an'],
      books: ['s0201m.mul', 's0301m.mul'],
    },
    default_sutta_para: null,
    translation_languages: transLangs,
    initial_search_strategy: [
      `Search section titles for terms: ${fallbackTerms.join(', ')}`,
      'Search CST full-text database across the Four Primary Nikāyas',
      'Read matching paragraph passages and cross-reference commentary'
    ],
    user_facing_summary: `Investigating Dhamma inquiry across the canonical books with identified terms: ${fallbackTerms.join(', ')}.`,
    source: 'heuristic_general',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 1: AI PROMPT UNDERSTANDING ENGINE (GEMINI / OPENAI / OPENROUTER)
// ═══════════════════════════════════════════════════════════════════════════

const kAiUnderstandingSystemPrompt = `You are Ani (AI Nissaya)'s Scholarly Query Understanding Engine for the Chaṭṭha Saṅgāyana Tipiṭaka (Pāḷi Canon).
Your duty is Step 1 of the canonical research loop: dissect the user's inquiry, penetrate the underlying doctrinal or canonical intent, extract exact Pāḷi technical terms, map the question to specific Canonical books / Nikāyas, and formulate a high-precision research strategy.

## Canonical Knowledge Guidelines
- Polyglot Fluency: The user may ask in English, Vietnamese, Burmese, Pali, Chinese, Thai, or other languages.
- Sutta Identifications:
  * "bánh mật", "mật hoàn", "honey ball", "honey cake", "ပျားလုံး", "ပျားမုန့်" -> Madhupiṇḍika Sutta (MN 18, Majjhima Nikāya, s0201m.mul).
  * "quán niệm hơi thở", "nhập tức xuất tức", "mindfulness of breathing", "အာနာပါနဿတိ" -> Ānāpānassati Sutta (MN 118, Majjhima Nikāya, s0203m.mul §438).
  * "đại bát niết bàn", "parinibbana", "last days of buddha", "မဟာပရိနိဗ္ဗာန" -> Mahāparinibbāna Sutta (DN 16, Dīgha Nikāya, s0102m.mul §286).
  * "tứ diệu đế", "bốn thánh đế", "four noble truths", "သစ္စာလေးပါး" -> Dhammacakkappavattana Sutta (SN 56.11, s0305m.mul §2473) & Saccavibhaṅga (MN 141).
  * "tứ niệm xứ", "satipatthana", "mindfulness", "သတိပဋ္ဌာန်" -> Mahāsatipaṭṭhāna (DN 22, s0102m.mul §1340) & Satipaṭṭhāna (MN 10, s0201m.mul §285).
  * "duyên khởi", "thập nhị nhân duyên", "dependent origination", "paṭiccasamuppāda" -> SN 12.2 (s0302m.mul) & DN 15.
  * "vô ngã", "non-self", "anattā" -> Anattalakkhaṇa Sutta (SN 22.59, s0303m.mul §322).
  * "kālāma", "kesamutti", "ca-la-ma" -> AN 3.65 (s0402m2.mul §586).
  * "pháp cú", "dhammapada", "dhp" -> Dhammapada (s0502m.mul).
  * "sân hận", "giận", "anger", "vyāpāda", "kodha" -> AN 5.161, Dhp 221-223.
- If the user asks about Mahāyāna Sanskrit sūtras ("Kim Cang" / Diamond Sūtra, "Bát Nhã" / Heart Sūtra), identify them as Mahāyāna texts outside the Theravāda Canon and direct to Pāḷi Suññatā discourses (MN 121, MN 122).
- Always provide Pāḷi stems with terminal vowels (-a, -ā, -e, -o) stripped for prefix matching (e.g. "madhupiṇḍik*", "dhamm*", "sacc*", "khandh*").
- Map Nikāyas to canonical CST book codes:
  * DN 1-13 -> s0101m.mul, DN 14-23 -> s0102m.mul, DN 24-34 -> s0103m.mul
  * MN 1-50 -> s0201m.mul, MN 51-100 -> s0202m.mul, MN 101-152 -> s0203m.mul
  * SN 1-11 -> s0301m.mul, SN 12-21 -> s0302m.mul, SN 22-34 -> s0303m.mul, SN 35-44 -> s0304m.mul, SN 45-56 -> s0305m.mul
  * AN 1 -> s0401m1.mul, AN 2 -> s0402m1.mul, AN 3 -> s0402m2.mul, AN 4 -> s0402m3.mul, AN 5-7 -> s0403m*.mul, AN 8-11 -> s0404m*.mul
  * Dhp -> s0502m.mul, Jataka -> s0513m.mul
  * Vinaya -> vin01m.mul to vin05m.mul
  * Abhidhamma -> abh01m.mul to abh07m.mul

## Output Schema
Return STRICTLY valid JSON adhering to:
{
  "intent": "sutta_lookup" | "doctrinal_explanation" | "term_analysis" | "monastic_rule" | "comparison" | "general_dhamma",
  "detected_language": "en" | "vi" | "my" | "pi" | "zh" | "other",
  "core_question": "Single clear sentence defining what is specifically being asked",
  "canonical_pali_terms": ["array of exact Pali terms in Roman IAST script"],
  "pali_stems": ["array of stems ending in * (e.g. madhupiṇḍik*, sacc*)"],
  "target_sutta_names": ["array of specific sutta names (e.g. Madhupiṇḍika Sutta (MN 18))"],
  "recommended_locations": {
    "pitakas": ["sutta" | "vinaya" | "abhidhamma"],
    "nikayas": ["dn" | "mn" | "sn" | "an" | "kn" | "dhp" | "ja"],
    "books": ["s0201m.mul", "s0102m.mul"]
  },
  "translation_languages": ["en", "vi"],
  "initial_search_strategy": [
    "Step 1: exact tool action to discover sections",
    "Step 2: exact tool action to read paragraphs",
    "Step 3: exact tool action to review commentaries"
  ],
  "user_facing_summary": "1-2 concise, elegant sentences explaining Ani's understanding of the inquiry to the user."
}`;

async function understandUserQuery({
  userQuery,
  conversationHistory = [],
  provider = 'gemini',
  apiKey = '',
  baseUrl = '',
  toolModel = 'gemini-flash-lite-latest',
  dbTipitaka = null,
  dbSummaries = null,
  onStatus = null,
}) {
  const trimmed = (userQuery || '').trim();
  if (!trimmed) {
    return heuristicQueryUnderstanding('Dhamma inquiry', conversationHistory, dbTipitaka, dbSummaries);
  }

  // 1. If no API key, use rich heuristic knowledge base and database grounding
  if (!apiKey || apiKey.trim().length < 5) {
    if (onStatus) onStatus('Analyzing prompt with canonical heuristic knowledge base…');
    return heuristicQueryUnderstanding(trimmed, conversationHistory, dbTipitaka, dbSummaries);
  }

  // 2. Call AI model for deep query understanding
  if (onStatus) onStatus('🧠 Ani is analyzing your prompt and formulating canonical research plan…');

  const contextMessages = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const m of conversationHistory.slice(-4)) {
      if (m.content && m.role) {
        contextMessages.push({
          role: m.role === 'assistant' ? 'model' : 'user',
          text: m.content.substring(0, 300),
        });
      }
    }
  }

  const userAnalysisPrompt = `USER INQUIRY:
"${trimmed}"

${contextMessages.length > 0 ? `PREVIOUS CONTEXT:\n${contextMessages.map((c) => `${c.role}: ${c.text}`).join('\n')}\n` : ''}
Dissect this prompt according to the system instructions. Output ONLY the JSON object.`;

  try {
    if (provider === 'gemini') {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${toolModel}:generateContent?key=${apiKey.trim()}`;
      const payload = {
        system_instruction: { parts: [{ text: kAiUnderstandingSystemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userAnalysisPrompt }] }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 1024,
        },
      };

      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          return enrichUnderstandingResult(parsed, trimmed, dbTipitaka);
        }
      }
    } else {
      // OpenAI / OpenRouter / Compatible endpoints
      const endpoint = (baseUrl && baseUrl.trim())
        ? `${baseUrl.trim().replace(/\/+$/, '')}/chat/completions`
        : provider === 'openrouter'
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';

      const payload = {
        model: toolModel || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: kAiUnderstandingSystemPrompt },
          { role: 'user', content: userAnalysisPrompt },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      };

      const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`,
      };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = 'https://tipitakapali.org';
        headers['X-Title'] = 'tipitakapali.org';
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });

      if (res.ok) {
        const json = await res.json();
        const text = json.choices?.[0]?.message?.content;
        if (text) {
          const parsed = JSON.parse(text);
          return enrichUnderstandingResult(parsed, trimmed, dbTipitaka);
        }
      }
    }
  } catch (err) {
    console.warn('[AI Query Understanding] Error calling model, falling back to heuristic:', err.message);
  }

  // Fallback to heuristic
  return heuristicQueryUnderstanding(trimmed, conversationHistory, dbTipitaka, dbSummaries);
}

function enrichUnderstandingResult(parsed, originalQuery, dbTipitaka = null) {
  const lang = parsed.detected_language || detectLanguage(originalQuery);
  const terms = Array.isArray(parsed.canonical_pali_terms) ? parsed.canonical_pali_terms : [];
  let stems = Array.isArray(parsed.pali_stems) ? parsed.pali_stems : [];

  if (stems.length === 0 && terms.length > 0) {
    stems = terms.map((t) => `${extractPaliStem(t)}*`);
  }

  const transLangs = Array.isArray(parsed.translation_languages) ? parsed.translation_languages : ['en'];
  if (lang === 'vi' && !transLangs.includes('vi')) transLangs.push('vi');
  if (lang === 'my' && !transLangs.includes('my')) transLangs.push('my');

  let defaultPara = null;
  const targetSuttas = Array.isArray(parsed.target_sutta_names) ? parsed.target_sutta_names : [];
  let locations = parsed.recommended_locations || {
    pitakas: ['sutta'],
    nikayas: ['mn', 'sn'],
    books: [],
  };

  // Ground target suttas against database to obtain exact paragraph boundaries if possible
  const citationMatch = parseCanonicalCitation(originalQuery) || (targetSuttas[0] ? parseCanonicalCitation(targetSuttas[0]) : null);
  if (citationMatch) {
    const res = resolveCanonicalCitation(citationMatch.book, citationMatch.num, citationMatch.subNum, dbTipitaka);
    if (res) {
      defaultPara = res.start_para;
      if (res.book_code && (!locations.books || locations.books.length === 0)) {
        locations.books = [res.book_code];
      }
      if (res.nikaya && (!locations.nikayas || locations.nikayas.length === 0)) {
        locations.nikayas = [res.nikaya];
      }
    }
  }

  return {
    intent: parsed.intent || 'doctrinal_explanation',
    detected_language: lang,
    core_question: parsed.core_question || originalQuery,
    canonical_pali_terms: terms,
    pali_stems: stems,
    target_sutta_names: targetSuttas,
    recommended_locations: locations,
    default_sutta_para: defaultPara,
    translation_languages: transLangs,
    initial_search_strategy: Array.isArray(parsed.initial_search_strategy) ? parsed.initial_search_strategy : [],
    user_facing_summary: parsed.user_facing_summary || `Analyzing canonical sources for: "${originalQuery}"`,
    source: 'ai_engine',
  };
}

module.exports = {
  understandUserQuery,
  heuristicQueryUnderstanding,
  parseCanonicalCitation,
  resolveCanonicalCitation,
  detectLanguage,
  extractPaliStem,
  kAiUnderstandingSystemPrompt,
  CANONICAL_KNOWLEDGE_BASE,
};
