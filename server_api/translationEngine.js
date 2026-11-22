'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const {
  hasChapterTransPack,
  readChapterTranslationPack,
  tryParseGuid,
} = require('./tipitakaCoreHelper');

const LANG_MAP = {
  english: 'en',
  vietnamese: 'vi',
  myanmar: 'my',
  sinhala: 'si',
  thai: 'th',
  chinese: 'zh',
  khmer: 'km',
  lao: 'lo',
  tamil: 'ta',
  german: 'de',
  japanese: 'ja',
  korean: 'ko',
  indonesian: 'id',
  nepali: 'ne',
  portuguese: 'pt',
  russian: 'ru',
  hindi: 'hi',
  bengali: 'be',
  spanish: 'es',
  french: 'fr',
  czech: 'cs',
  marathi: 'mr',
  my_nissaya: 'my_nissaya',
};

const CODE_TO_ID = Object.fromEntries(Object.entries(LANG_MAP).map(([k, v]) => [v, k]));

class TranslationEngine {
  constructor(dbDir) {
    this.dbDir = dbDir || path.join(__dirname, 'db');
    this.databases = new Map(); // langCode -> { db, stmtChapter, stmtPara, stmtGuid, meta }
    this.initDatabases();
  }

  getDbCandidates(filename) {
    const candidates = [];
    if (process.env.USER_DATA_PATH) {
      candidates.push(path.join(process.env.USER_DATA_PATH, 'db', filename));
      candidates.push(path.join(process.env.USER_DATA_PATH, filename));
    }
    if (process.env.DB_DIR) {
      candidates.push(path.join(process.env.DB_DIR, filename));
    }
    candidates.push(path.join(this.dbDir, filename));
    candidates.push(path.join(__dirname, 'db', filename));
    candidates.push(path.join(__dirname, filename));
    return candidates;
  }

  resolveDbPath(filename) {
    const candidates = this.getDbCandidates(filename);
    const found = candidates.find((p) => fs.existsSync(p));
    return found ? path.resolve(found) : null;
  }

  initDatabases() {
    // Look for all translation_*.db files in candidate directories
    const searchDirs = [
      this.dbDir,
      path.join(__dirname, 'db'),
      process.env.DB_DIR,
      process.env.USER_DATA_PATH ? path.join(process.env.USER_DATA_PATH, 'db') : null,
    ].filter(Boolean);

    const seenFiles = new Set();
    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const m = f.match(/^translation_([a-z_]+)\.db$/i);
          if (m) {
            const langCode = m[1].toLowerCase();
            if (!this.databases.has(langCode)) {
              const fullPath = path.join(dir, f);
              if (!seenFiles.has(fullPath)) {
                seenFiles.add(fullPath);
                this.loadDatabase(langCode, fullPath);
              }
            }
          }
        }
      } catch (err) {
        console.warn(`[TranslationEngine] Error scanning directory ${dir}:`, err.message);
      }
    }

    console.log(`[TranslationEngine] Initialized ${this.databases.size} translation database(s): [${Array.from(this.databases.keys()).join(', ')}]`);
  }

  loadDatabase(langCode, fullPath) {
    try {
      const db = new Database(fullPath, { readonly: true });
      db.exec(`
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA query_only = 1;
      `);

      const isV2 = hasChapterTransPack(db);

      const stmtChapter = !isV2
        ? db.prepare(`
            SELECT para_index, guid, para_num, translation, sentence_count, sentences_json
            FROM paragraph_translations
            WHERE book_code = ? AND chapter_index = ?
            ORDER BY para_index ASC
          `)
        : null;

      const stmtPara = !isV2
        ? db.prepare(`
            SELECT para_index, guid, para_num, translation, sentence_count, sentences_json
            FROM paragraph_translations
            WHERE book_code = ? AND para_index = ?
            LIMIT 1
          `)
        : null;

      const stmtGuid = !isV2
        ? db.prepare(`
            SELECT book_code, chapter_index, para_index, guid, para_num, translation, sentence_count, sentences_json
            FROM paragraph_translations
            WHERE guid = ?
            LIMIT 1
          `)
        : null;

      const stmtMinChap = db.prepare(
        isV2
          ? 'SELECT MIN(chapter_index) AS min_ch FROM chapter_trans_pack WHERE book_code = ?'
          : 'SELECT MIN(chapter_index) AS min_ch FROM paragraph_translations WHERE book_code = ?'
      );

      let meta = {};
      try {
        const rows = db.prepare('SELECT key, value FROM translation_meta').all();
        for (const r of rows) {
          meta[r.key] = r.value;
        }
      } catch (_) {}

      this.databases.set(langCode, {
        db,
        isV2,
        stmtChapter,
        stmtPara,
        stmtGuid,
        stmtMinChap,
        meta,
        path: fullPath,
      });
      return true;
    } catch (err) {
      console.warn(`[TranslationEngine] Failed to load ${fullPath}:`, err.message);
      return false;
    }
  }

  ensureLanguage(lang) {
    const code = (LANG_MAP[lang.toLowerCase()] || lang).toLowerCase();
    if (this.databases.has(code)) return code;

    // Try on-demand discovery
    const dbPath = this.resolveDbPath(`translation_${code}.db`);
    if (dbPath && this.loadDatabase(code, dbPath)) {
      return code;
    }
    return null;
  }

  getAvailableLanguages() {
    // Refresh check if new databases were converted
    this.initDatabases();

    const list = [];
    for (const [code, entry] of this.databases.entries()) {
      const m = entry.meta || {};
      list.push({
        code,
        id: CODE_TO_ID[code] || code,
        name: m.name || code.toUpperCase(),
        native_name: m.native_name || code.toUpperCase(),
        flag: m.flag || '🌐',
        total_sentences: m.total_sentences ? parseInt(m.total_sentences, 10) : undefined,
        total_paragraphs: m.total_paragraphs ? parseInt(m.total_paragraphs, 10) : undefined,
        total_books: m.total_books ? parseInt(m.total_books, 10) : undefined,
        converted_at: m.converted_at || null,
      });
    }
    return list;
  }

  getFirstTranslatedChapter(langCode, bookCode) {
    const entry = this.databases.get(langCode);
    if (!entry || !entry.stmtMinChap || !bookCode) return null;
    try {
      const row = entry.stmtMinChap.get(bookCode);
      if (row && row.min_ch !== null && row.min_ch !== undefined) {
        return Number(row.min_ch);
      }
    } catch (_) {}
    return null;
  }

  getChapterRows(langCode, cleanCode, cIdx) {
    const entry = this.databases.get(langCode);
    if (!entry) return [];
    if (entry.isV2) {
      const pack = readChapterTranslationPack(entry.db, cleanCode, cIdx);
      if (!pack || pack.size === 0) return [];
      const keys = Array.from(pack.keys()).sort((a, b) => a - b);
      return keys.map((pi) => {
        const item = pack.get(pi);
        const sents = Array.isArray(item.sentences) ? item.sentences : [];
        return {
          para_index: pi,
          guid: `${cleanCode}:c${cIdx}:n${item.paraNum ?? ''}:p${pi}`,
          para_num: item.paraNum,
          translation: item.translation,
          sentence_count: sents.length,
          sentences: sents,
        };
      });
    }

    const rows = entry.stmtChapter.all(cleanCode, cIdx);
    return rows.map((r) => {
      let parsedSents = null;
      if (r.sentences_json) {
        try {
          parsedSents = JSON.parse(r.sentences_json);
        } catch (_) {}
      }
      return {
        para_index: r.para_index,
        guid: r.guid,
        para_num: r.para_num,
        translation: r.translation,
        sentence_count: r.sentence_count,
        sentences: parsedSents,
      };
    });
  }

  getChapterTranslations(bookCode, chapterIndex, requestedLangs = [], includeSentences = false) {
    let cleanCode = (bookCode || '').replace('.xml', '');
    const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
    if (chapSuffixMatch) {
      cleanCode = chapSuffixMatch[1];
    }
    const cIdx = parseInt(chapterIndex, 10);

    const langCodes = (Array.isArray(requestedLangs) ? requestedLangs : [requestedLangs])
      .map((l) => this.ensureLanguage(l))
      .filter(Boolean);

    const result = {
      book_code: cleanCode,
      chapter_index: cIdx,
      languages: langCodes,
      translations: {},
    };
    if (includeSentences) result.sentences = {};

    for (const code of langCodes) {
      const entry = this.databases.get(code);
      if (!entry) continue;

      try {
        const rows = this.getChapterRows(code, cleanCode, cIdx);
        const paraMap = {};
        const sentMap = {};
        for (const r of rows) {
          if (r.translation !== null && r.translation !== undefined) {
            paraMap[r.para_index] = r.translation;
          }
          if (includeSentences && Array.isArray(r.sentences) && r.sentences.length > 0) {
            sentMap[r.para_index] = r.sentences;
          }
        }
        result.translations[code] = paraMap;
        if (includeSentences) result.sentences[code] = sentMap;
      } catch (err) {
        console.warn(`[TranslationEngine] Error fetching chapter for ${code}:`, err.message);
      }
    }

    return result;
  }

  getChapterTranslationsDetailed(bookCode, chapterIndex, requestedLangs = []) {
    let cleanCode = (bookCode || '').replace('.xml', '');
    const chapSuffixMatch = cleanCode.match(/^(.*?\.(?:mul|att|tik|nrf))(\d+)$/i);
    if (chapSuffixMatch) {
      cleanCode = chapSuffixMatch[1];
    }
    const cIdx = parseInt(chapterIndex, 10);

    const langCodes = (Array.isArray(requestedLangs) ? requestedLangs : [requestedLangs])
      .map((l) => this.ensureLanguage(l))
      .filter(Boolean);

    const result = {
      book_code: cleanCode,
      chapter_index: cIdx,
      languages: langCodes,
      paragraphs: {},
    };

    for (const code of langCodes) {
      const entry = this.databases.get(code);
      if (!entry) continue;

      try {
        const rows = this.getChapterRows(code, cleanCode, cIdx);
        for (const r of rows) {
          if (!result.paragraphs[r.para_index]) {
            result.paragraphs[r.para_index] = {
              para_index: r.para_index,
              guid: r.guid,
              para_num: r.para_num,
              translations: {},
            };
          }
          result.paragraphs[r.para_index].translations[code] = {
            text: r.translation,
            sentence_count: r.sentence_count,
            sentences: Array.isArray(r.sentences) && r.sentences.length > 0 ? r.sentences : null,
          };
        }
      } catch (err) {
        console.warn(`[TranslationEngine] Error fetching detailed chapter for ${code}:`, err.message);
      }
    }

    return result;
  }

  getGuidTranslation(guid, requestedLangs = []) {
    const langCodes = (Array.isArray(requestedLangs) ? requestedLangs : [requestedLangs])
      .map((l) => this.ensureLanguage(l))
      .filter(Boolean);

    const result = {
      guid,
      translations: {},
    };

    const parsedGuid = tryParseGuid(guid);

    for (const code of langCodes) {
      const entry = this.databases.get(code);
      if (!entry) continue;
      try {
        if (entry.isV2) {
          if (!parsedGuid) continue;
          const pack = readChapterTranslationPack(entry.db, parsedGuid.bookCode, parsedGuid.chapterIndex);
          const item = pack.get(parsedGuid.paraIndex);
          if (item && (item.translation || (item.sentences && item.sentences.length > 0))) {
            result.translations[code] = {
              text: item.translation,
              book_code: parsedGuid.bookCode,
              chapter_index: parsedGuid.chapterIndex,
              para_index: parsedGuid.paraIndex,
              para_num: item.paraNum,
              sentences: item.sentences && item.sentences.length > 0 ? item.sentences : null,
            };
          }
          continue;
        }

        const row = entry.stmtGuid.get(guid);
        if (row) {
          result.translations[code] = {
            text: row.translation,
            book_code: row.book_code,
            chapter_index: row.chapter_index,
            para_index: row.para_index,
            para_num: row.para_num,
            sentences: row.sentences_json ? JSON.parse(row.sentences_json) : null,
          };
        }
      } catch (err) {}
    }
    return result;
  }

  closeDatabases() {
    for (const [code, entry] of this.databases.entries()) {
      try {
        if (entry.db && typeof entry.db.close === 'function') {
          entry.db.close();
        }
      } catch (_) {}
    }
    this.databases.clear();
  }
}

let engineInstance = null;
function getTranslationEngine(dbDir) {
  if (!engineInstance) {
    engineInstance = new TranslationEngine(dbDir);
  }
  return engineInstance;
}

module.exports = {
  TranslationEngine,
  getTranslationEngine,
  LANG_MAP,
  CODE_TO_ID,
};
