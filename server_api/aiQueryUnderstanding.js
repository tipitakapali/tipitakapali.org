'use strict';

const dictEngine = require('./dictEngine');

// Stop words to exclude from naive token matching & catalog title matching
const QUERY_STOP_WORDS = new Set([
  'explain', 'what', 'which', 'where', 'when', 'who', 'how', 'why',
  'the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with',
  'by', 'from', 'about', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'their', 'there', 'these', 'those',
  'this', 'that', 'they', 'them', 'canonical', 'definitions', 'definition',
  'sutta', 'suttas', 'discourse', 'discourses', 'relevant', 'quote', 'passages', 'passage', 'text', 'please',
  'tell', 'me', 'give', 'list', 'show', 'explore', 'between', 'exact',
  'buddha', 'dhamma', 'sangha', 'saṅgha', 'teach', 'teaches', 'teaching', 'teachings',
  'say', 'says', 'said', 'talk', 'talks', 'overcome', 'overcoming', 'practice',
  'pali', 'pāḷi', 'canon', 'tipitaka', 'tipiṭaka', 'buddhism', 'buddhist', 'theravada', 'theravāda',
  'rule', 'rules', 'monk', 'monks', 'bhikkhu', 'bhikkhus', 'concept', 'concepts', 'meaning', 'mean',
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

// Detect language of inquiry (avoids misclassifying French/Spanish/Portuguese/German as Vietnamese)
function detectLanguage(text) {
  if (!text) return 'en';
  if (/[\u1000-\u109F]/.test(text)) return 'my';
  if (/[\u0D80-\u0DFF]/.test(text)) return 'si';
  if (/[\u0E00-\u0E7F]/.test(text)) return 'th';
  if (/[\u0E80-\u0EFF]/.test(text)) return 'lo';
  if (/[\u1780-\u17FF]/.test(text)) return 'km';
  if (/[\u0B80-\u0BFF]/.test(text)) return 'ta';
  if (/[\u0980-\u09FF]/.test(text)) return 'be';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u3040-\u30FF]/.test(text)) return 'ja';
  if (/[\uAC00-\uD7AF]/.test(text)) return 'ko';
  if (/[\u4E00-\u9FFF]/.test(text)) return 'zh';
  if (/[\u0400-\u04FF]/.test(text)) return 'ru';
  // Vietnamese-exclusive diacritics (ă, ơ, ư, đ, stacked vowel+tone, hook-above, dot-below —
  // intentionally excluding bare â/ê/ô which are shared with French and Portuguese)
  if (
    /[ăằắẳẵặầấẩẫậềếểễệồốổỗộơờớởỡợưừứửữựđảạẻẹẽỉịỏọủụỳỷỹỵ]/i.test(text) ||
    /\b(không|của|những|người|như thế nào|là gì|đức phật|bài kinh|tam tạng|sân hận|tâm từ|vô thường|vô ngã)\b/i.test(text)
  ) {
    return 'vi';
  }
  // European Latin-script languages (before falling back to Pāḷi/English)
  if (/[¿¡ñ]/i.test(text) || /\b(qué|cómo|enseña|sobre|sufrimiento|compasión|buda|cuál|cuáles)\b/i.test(text)) return 'es';
  if (/\b(qu['’]est-ce|comment|enseigne|bouddha|souffrance|pleine conscience|équanimité|bienveillance|quel|quelle)\b/i.test(text)) return 'fr';
  if (/[äöüß]/i.test(text) || /\b(was|wie|lehrt|über|achtsamkeit|weisheit|leiden|geduld|mitgefühl)\b/i.test(text)) return 'de';
  if (/[ãõç]/i.test(text) || /\b(o que é|como|ensina|sofrimento|compaixão|atenção plena|cânone)\b/i.test(text)) return 'pt';
  if (/[ěščřžů]/i.test(text)) return 'cs';
  if (/\b(apakah|bagaimana|ajaran|penderitaan|kebijaksanaan|perhatian penuh)\b/i.test(text)) return 'id';
  if (/[āīūṅñṭḍṇḷṃ]/i.test(text) && !/\b(the|what|how|explain|between|does|about|where|which|define|meaning)\b/i.test(text)) return 'pi';
  return 'en';
}

// Reusable concept-group templates for common Theravāda Buddhist research themes
const CONCEPT_GROUP_LEXICON = [
  {
    patterns: [/\banger\b/i, /\bill[\s-]?will\b/i, /\bhatred\b/i, /\bresentment\b/i, /\baversion\b/i, /\bkodha\b/i, /\bvy[aā]p[aā]da\b/i, /\bdosa\b/i, /\b[aā]gh[aā]ta\b/i, /\bpa[ṭt]igha\b/i, /sân\s*hận/i, /giận\s*dữ/i, /oán\s*hận/i, /ဒေါသ/i],
    group: {
      concept: 'Anger & Ill-will',
      pali_terms: ['kodha', 'vyāpāda', 'dosa', 'āghāta', 'paṭigha', 'vera'],
      pali_stems: ['kodh*', 'vyāpād*', 'dos*', 'āghāt*', 'paṭigh*', 'ver*'],
      english_keywords: ['anger', 'ill-will', 'hatred', 'resentment', 'aversion', 'hostility'],
      local_keywords: ['sân hận', 'phẫn nộ', 'oán hận', 'ဒေါသ'],
    },
  },
  {
    patterns: [/loving[\s-]?kindness/i, /\bgoodwill\b/i, /\bbenevolence\b/i, /\bmett[aā]\b/i, /\bavera\b/i, /\bakodha\b/i, /\badosa\b/i, /tâm\s*từ/i, /từ\s*bi/i, /lòng\s*từ/i, /မေတ္တာ/i],
    group: {
      concept: 'Loving-kindness (Mettā)',
      pali_terms: ['mettā', 'avera', 'abyāpajja', 'adosa', 'brahmavihāra'],
      pali_stems: ['mett*', 'aver*', 'abyāpajj*', 'ados*', 'brahmavihār*'],
      english_keywords: ['loving-kindness', 'goodwill', 'friendliness', 'non-hatred', 'benevolence'],
      local_keywords: ['tâm từ', 'từ ái', 'từ bi', 'မေတ္တာ'],
    },
  },
  {
    patterns: [/\bcompassion\b/i, /\bkaru[ṇn][aā]\b/i, /\bsympath/i, /bi\s*mẫn/i, /tâm\s*bi/i, /ကရုဏာ/i],
    group: {
      concept: 'Compassion (Karuṇā)',
      pali_terms: ['karuṇā', 'anukampā', 'avihiṃsā', 'brahmavihāra'],
      pali_stems: ['karuṇ*', 'anukamp*', 'avihiṃs*'],
      english_keywords: ['compassion', 'pity', 'sympathy', 'non-harming'],
      local_keywords: ['bi mẫn', 'lòng bi', 'tâm bi', 'ကရုဏာ'],
    },
  },
  {
    patterns: [/\bmindfulness\b/i, /\bawareness\b/i, /\bsati\b/i, /\bsatipa[ṭt][ṭt]h[aā]na\b/i, /\bsampaja[ñn][ñn]a\b/i, /chánh\s*niệm/i, /niệm\s*xứ/i, /tỉnh\s*giác/i, /သတိ/i],
    group: {
      concept: 'Mindfulness (Sati)',
      pali_terms: ['sati', 'satipaṭṭhāna', 'sampajañña', 'anupassanā', 'sammāsati'],
      pali_stems: ['sati*', 'satipaṭṭhān*', 'sampajaññ*', 'anupassan*'],
      english_keywords: ['mindfulness', 'awareness', 'clear comprehension', 'contemplation'],
      local_keywords: ['chánh niệm', 'niệm xứ', 'tỉnh giác', 'သတိ'],
    },
  },
  {
    patterns: [/\bbreath/i, /\b[aā]n[aā]p[aā]na/i, /hơi\s*thở/i, /nhập\s*tức/i, /အာနာပါန/i],
    group: {
      concept: 'Breathing (Ānāpāna)',
      pali_terms: ['ānāpānassati', 'assāsa', 'passāsa', 'kāyasaṅkhāra'],
      pali_stems: ['ānāpān*', 'assās*', 'passās*', 'kāyasaṅkhār*'],
      english_keywords: ['breathing', 'in-breath', 'out-breath', 'breath meditation'],
      local_keywords: ['hơi thở', 'thở vào', 'thở ra', 'အာနာပါန'],
    },
  },
  {
    patterns: [/\bconcentration\b/i, /\bjh[aā]na\b/i, /\bsam[aā]dhi\b/i, /\babsorption\b/i, /thiền\s*định/i, /chánh\s*định/i, /tâm\s*định/i, /định\s*tâm/i, /သမာဓိ/i, /ဈာန်/i],
    group: {
      concept: 'Concentration & Jhāna',
      pali_terms: ['samādhi', 'jhāna', 'ekaggatā', 'samatha', 'sammāsamādhi'],
      pali_stems: ['samādh*', 'jhān*', 'ekaggat*', 'samath*'],
      english_keywords: ['concentration', 'jhana', 'absorption', 'tranquility', 'unification'],
      local_keywords: ['thiền định', 'chánh định', 'định tâm', 'သမာဓိ', 'ဈာန်'],
    },
  },
  {
    patterns: [/\bwisdom\b/i, /\binsight\b/i, /\bpa[ñn][ñn][aā]\b/i, /\bvipassan[aā]\b/i, /\b[ñn][aā][ṇn]a\b/i, /trí\s*tuệ/i, /tuệ\s*giác/i, /minh\s*sát/i, /ပညာ/i, /ဝိပဿနာ/i],
    group: {
      concept: 'Wisdom & Insight (Paññā)',
      pali_terms: ['paññā', 'vipassanā', 'ñāṇa', 'yathābhūtañāṇadassana', 'sammādiṭṭhi'],
      pali_stems: ['paññ*', 'vipassan*', 'ñāṇ*', 'sammādiṭṭh*'],
      english_keywords: ['wisdom', 'insight', 'understanding', 'knowledge and vision', 'right view'],
      local_keywords: ['trí tuệ', 'tuệ giác', 'minh sát', 'ပညာ', 'ဝိပဿနာ'],
    },
  },
  {
    patterns: [/\bimpermanen/i, /\banicc/i, /vô\s*thường/i, /အနိစ္စ/i],
    group: {
      concept: 'Impermanence (Anicca)',
      pali_terms: ['anicca', 'aniccatā', 'vayadhamma', 'khayadhamma', 'vipariṇāmadhamma'],
      pali_stems: ['anicc*', 'vayadhamm*', 'vipariṇām*'],
      english_keywords: ['impermanence', 'impermanent', 'change', 'decay', 'passing away'],
      local_keywords: ['vô thường', 'biến hoại', 'အနိစ္စ'],
    },
  },
  {
    patterns: [/\bsuffering\b/i, /\bstress\b/i, /\bunsatisfactor/i, /\bdukkh/i, /khổ\s*đế/i, /khổ\s*đau/i, /đau\s*khổ/i, /khổ\s*não/i, /sufrimiento/i, /souffrance/i, /sofrimento/i, /ဒုက္ခ/i],
    group: {
      concept: 'Suffering (Dukkha)',
      pali_terms: ['dukkha', 'dukkhasacca', 'domanassa', 'upāyāsa', 'saṅkhāradukkha'],
      pali_stems: ['dukkh*', 'domanass*', 'upāyās*'],
      english_keywords: ['suffering', 'stress', 'pain', 'unsatisfactoriness', 'anguish'],
      local_keywords: ['khổ đế', 'khổ đau', 'đau khổ', 'ဒုက္ခ'],
    },
  },
  {
    patterns: [/\bnon[\s-]?self\b/i, /\bnot[\s-]?self\b/i, /\banatt/i, /\bselfless/i, /vô\s*ngã/i, /အနတ္တ/i],
    group: {
      concept: 'Non-Self (Anattā)',
      pali_terms: ['anattā', 'anattalakkhaṇa', 'suññata', 'attānudiṭṭhi', 'sakkāyadiṭṭhi'],
      pali_stems: ['anatt*', 'suññat*', 'sakkāyadiṭṭh*'],
      english_keywords: ['non-self', 'not-self', 'selfless', 'emptiness', 'identity view'],
      local_keywords: ['vô ngã', 'không phải tự ngã', 'အနတ္တ'],
    },
  },
  {
    patterns: [/\bkamma\b/i, /\bkarma\b/i, /\bvolition/i, /\bintention\b/i, /\bcetan[aā]\b/i, /\bvip[aā]ka\b/i, /nghiệp\s*báo/i, /tạo\s*nghiệp/i, /tác\s*ý/i, /ကံ/i],
    group: {
      concept: 'Kamma & Intention',
      pali_terms: ['kamma', 'cetanā', 'kammavipāka', 'kusala', 'akusala'],
      pali_stems: ['kamm*', 'cetan*', 'vipāk*'],
      english_keywords: ['kamma', 'karma', 'action', 'volition', 'intention', 'result'],
      local_keywords: ['nghiệp', 'tác ý', 'quả báo', 'ကံ'],
    },
  },
  {
    patterns: [/\bnibb[aā]na\b/i, /\bnirvana\b/i, /\bcessation\b/i, /\bliberation\b/i, /\bvimutti\b/i, /niết\s*bàn/i, /giải\s*thoát/i, /နိဗ္ဗာန်/i],
    group: {
      concept: 'Nibbāna & Liberation',
      pali_terms: ['nibbāna', 'nirodha', 'vimutti', 'amata', 'asaṅkhata', 'virāga'],
      pali_stems: ['nibbān*', 'nirodh*', 'vimutt*', 'asaṅkhat*', 'virāg*'],
      english_keywords: ['nibbana', 'nirvana', 'cessation', 'liberation', 'unconditioned', 'release'],
      local_keywords: ['niết bàn', 'giải thoát', 'đoạn diệt', 'နိဗ္ဗာန်'],
    },
  },
  {
    patterns: [/\bcraving\b/i, /\bdesire\b/i, /\bclinging\b/i, /\battachment\b/i, /\bta[ṇn]h[aā]\b/i, /\bup[aā]d[aā]na\b/i, /\blobha\b/i, /tham\s*ái/i, /ái\s*dục/i, /chấp\s*thủ/i, /တဏှာ/i],
    group: {
      concept: 'Craving & Clinging',
      pali_terms: ['taṇhā', 'upādāna', 'lobha', 'rāga', 'chandarāga'],
      pali_stems: ['taṇh*', 'upādān*', 'lobh*', 'rāg*'],
      english_keywords: ['craving', 'clinging', 'attachment', 'greed', 'lust', 'desire'],
      local_keywords: ['tham ái', 'chấp thủ', 'ái dục', 'တဏှာ'],
    },
  },
  {
    patterns: [/\bvirtue\b/i, /\bmoral/i, /\bethic/i, /\bprecept/i, /\bs[iī]la\b/i, /\bvinaya\b/i, /\bp[aā]timokkha\b/i, /giới\s*luật/i, /trì\s*giới/i, /ngũ\s*giới/i, /giới\s*hạnh/i, /သီလ/i, /ဝိနည်း/i],
    group: {
      concept: 'Virtue & Monastic Discipline (Sīla / Vinaya)',
      pali_terms: ['sīla', 'vinaya', 'sikkhāpada', 'pātimokkha', 'saṃvara'],
      pali_stems: ['sīl*', 'vinay*', 'sikkhāpad*', 'pātimokkh*'],
      english_keywords: ['virtue', 'morality', 'precept', 'discipline', 'ethics', 'restraint'],
      local_keywords: ['giới luật', 'trì giới', 'giới hạnh', 'သီလ', 'ဝိနည်း'],
    },
  },
  {
    patterns: [/\bdependent\s*origination\b/i, /\bpa[ṭt]iccasamupp[aā]d/i, /\bconditioned\b/i, /\bsa[ṅn]kh[aā]r/i, /duyên\s*khởi/i, /hành\s*uẩn/i, /ပဋိစ္စသမုပ္ပါဒ်/i, /သင်္ခါရ/i],
    group: {
      concept: 'Dependent Origination & Formations',
      pali_terms: ['paṭiccasamuppāda', 'saṅkhāra', 'avijjā', 'paccaya', 'idappaccayatā'],
      pali_stems: ['paṭiccasamuppād*', 'saṅkhār*', 'avijj*', 'paccay*'],
      english_keywords: ['dependent origination', 'conditioned', 'formations', 'volitional formations', 'conditionality'],
      local_keywords: ['duyên khởi', 'hành uẩn', 'vô minh', 'ပဋိစ္စသမုပ္ပါဒ်'],
    },
  },
  {
    patterns: [/\bfive\s*aggregates\b/i, /\bkhandha\b/i, /\baggregates\b/i, /ngũ\s*uẩn/i, /ခန္ဓာ/i],
    group: {
      concept: 'Five Aggregates (Pañcakkhandha)',
      pali_terms: ['khandha', 'upādānakkhandha', 'rūpa', 'vedanā', 'saññā', 'saṅkhāra', 'viññāṇa'],
      pali_stems: ['khandh*', 'upādānakkhandh*', 'vedan*', 'viññāṇ*'],
      english_keywords: ['aggregates', 'five aggregates', 'clinging aggregates', 'form', 'feeling', 'perception', 'consciousness'],
      local_keywords: ['ngũ uẩn', 'thủ uẩn', 'sắc thọ tưởng hành thức', 'ခန္ဓာ'],
    },
  },
  {
    patterns: [/\bhindrance/i, /\bn[iī]vara[ṇn]a\b/i, /\bsloth\b/i, /\brestlessness\b/i, /\bdoubt\b/i, /triền\s*cái/i, /năm\s*triền\s*cái/i, /နီဝရဏ/i],
    group: {
      concept: 'Five Hindrances (Nīvaraṇa)',
      pali_terms: ['nīvaraṇa', 'kāmacchanda', 'vyāpāda', 'thinamiddha', 'uddhaccakukkucca', 'vicikicchā'],
      pali_stems: ['nīvaraṇ*', 'kāmacchand*', 'thinamiddh*', 'uddhacc*', 'vicikicch*'],
      english_keywords: ['hindrances', 'sensual desire', 'sloth and torpor', 'restlessness', 'doubt'],
      local_keywords: ['triền cái', 'hôn trầm', 'trạo cử', 'hoài nghi', 'နီဝရဏ'],
    },
  },
  {
    patterns: [/\bawakening\s*factor/i, /\benlightenment\s*factor/i, /\bbojjha[ṅn]ga\b/i, /giác\s*chi/i, /thất\s*giác\s*chi/i, /ဗောဇ္ဈင်/i],
    group: {
      concept: 'Seven Factors of Awakening (Bojjhaṅga)',
      pali_terms: ['bojjhaṅga', 'satisambojjhaṅga', 'dhammavicaya', 'vīriya', 'pīti', 'passaddhi', 'upekkhā'],
      pali_stems: ['bojjhaṅg*', 'dhammavicay*', 'vīriy*', 'passaddh*', 'upekkh*'],
      english_keywords: ['awakening factors', 'enlightenment factors', 'investigation', 'energy', 'rapture', 'tranquility', 'equanimity'],
      local_keywords: ['giác chi', 'trạch pháp', 'khinh an', 'xả', 'ဗောဇ္ဈင်'],
    },
  },
  {
    patterns: [/\bgenerosit/i, /\bgiving\b/i, /\bd[aā]na\b/i, /\bcharity\b/i, /bố\s*thí/i, /ဒါန/i],
    group: {
      concept: 'Generosity (Dāna)',
      pali_terms: ['dāna', 'cāga', 'pariccāga', 'dakkhiṇā', 'puñña'],
      pali_stems: ['dān*', 'cāg*', 'pariccāg*', 'puññ*'],
      english_keywords: ['generosity', 'giving', 'charity', 'offering', 'merit'],
      local_keywords: ['bố thí', 'phước đức', 'cúng dường', 'ဒါန'],
    },
  },
  {
    patterns: [/\brebirth\b/i, /\bdeath\b/i, /\bdying\b/i, /\bmaran/i, /\bmara[ṇn]a\b/i, /\bcuti\b/i, /\bpa[ṭt]isandhi\b/i, /\bbhava\b/i, /tái\s*sinh/i, /sự\s*chết/i, /sinh\s*tử/i, /သေခြင်း/i],
    group: {
      concept: 'Death & Rebirth',
      pali_terms: ['maraṇa', 'punabbhava', 'jāti', 'upapatti', 'cuti', 'paṭisandhi'],
      pali_stems: ['maraṇ*', 'punabbhav*', 'upapatt*', 'paṭisandh*'],
      english_keywords: ['death', 'rebirth', 'dying', 're-becoming', 'passing away'],
      local_keywords: ['tái sinh', 'sinh tử', 'chết', 'သေခြင်း'],
    },
  },
  {
    patterns: [/\bdefine\b/i, /\bdefinition\b/i, /\bmeaning\s+of\b/i, /\bwhat\s+is\b/i, /\betymolog/i, /định\s*nghĩa/i, /là\s*gì/i, /nghĩa\s*là/i, /qu['’]est-ce/i, /qué\s+es/i, /o\s+que\s+é/i, /အဓိပ္ပာယ်/i],
    isDefinitionIntent: true,
  },
];

function extractHeuristicConceptGroups(userQuery, detectedTerms = [], matchedKb = null) {
  const groups = [];
  const seenConcepts = new Set();

  for (const entry of CONCEPT_GROUP_LEXICON) {
    if (entry.isDefinitionIntent) continue;
    if (entry.patterns.some((pat) => pat.test(userQuery))) {
      if (!seenConcepts.has(entry.group.concept)) {
        seenConcepts.add(entry.group.concept);
        groups.push({ ...entry.group });
      }
      if (groups.length >= 4) break;
    }
  }

  if (matchedKb && groups.length === 0) {
    const kbName = (matchedKb.target_suttas && matchedKb.target_suttas[0]) || 'Primary Canonical Topic';
    if (!seenConcepts.has(kbName)) {
      const paliTerms = (matchedKb.pali_terms || []).slice(0, 6);
      const paliStems = Array.from(new Set(
        paliTerms
          .flatMap((t) => String(t).split(/\s+/))
          .map((tok) => extractPaliStem(tok))
          .filter((s) => s.length >= 3)
          .map((s) => `${s}*`)
      )).slice(0, 8);
      const engFallback = String(userQuery || '')
        .toLowerCase()
        .replace(/[^a-z\s-]/gi, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !QUERY_STOP_WORDS.has(w));
      groups.push({
        concept: kbName,
        pali_terms: paliTerms,
        pali_stems: paliStems,
        english_keywords: Array.from(new Set([kbName.replace(/\s*\(.*?\)/, '').trim(), ...engFallback])).slice(0, 6),
      });
    }
  }

  if (groups.length === 0) {
    const engTokens = String(userQuery || '')
      .toLowerCase()
      .replace(/[^a-zāīūṅñṭḍṇḷṃ\s-]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !QUERY_STOP_WORDS.has(w));
    const uniqueEng = Array.from(new Set(engTokens)).slice(0, 6);
    const paliTerms = Array.from(new Set(detectedTerms)).slice(0, 6);
    const paliStems = Array.from(new Set(paliTerms.map((t) => `${extractPaliStem(t)}*`).filter((s) => s.length >= 4)));
    if (paliTerms.length > 0 || uniqueEng.length > 0) {
      groups.push({
        concept: paliTerms[0] || uniqueEng.slice(0, 2).join(' ') || 'Core Topic',
        pali_terms: paliTerms,
        pali_stems: paliStems,
        english_keywords: uniqueEng.filter((w) => !paliTerms.includes(w)).slice(0, 5),
      });
    }
  }

  return groups.slice(0, 4);
}

function normalizeConceptGroups(rawGroups, fallbackTerms = [], fallbackStems = []) {
  const normalized = [];
  const list = Array.isArray(rawGroups) ? rawGroups : [];
  for (const g of list) {
    if (!g) continue;
    if (typeof g === 'string') {
      const clean = g.trim();
      if (!clean) continue;
      normalized.push({
        concept: clean,
        pali_terms: [clean],
        pali_stems: [`${extractPaliStem(clean)}*`],
        english_keywords: [clean],
      });
      continue;
    }
    const concept = String(g.concept || g.name || g.label || g.topic || '').trim();
    const paliTerms = Array.from(new Set(
      (Array.isArray(g.pali_terms) ? g.pali_terms
        : Array.isArray(g.pali_keywords) ? g.pali_keywords
        : Array.isArray(g.pali) ? g.pali
        : Array.isArray(g.terms) ? g.terms : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    )).slice(0, 8);
    let paliStems = Array.from(new Set(
      (Array.isArray(g.pali_stems) ? g.pali_stems : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    )).slice(0, 8);
    if (paliStems.length === 0 && paliTerms.length > 0) {
      paliStems = Array.from(new Set(
        paliTerms
          .map((t) => extractPaliStem(t.split(/\s+/)[0]))
          .filter((s) => s.length >= 3)
          .map((s) => `${s}*`)
      )).slice(0, 8);
    }
    const englishKeywords = Array.from(new Set(
      (Array.isArray(g.english_keywords) ? g.english_keywords
        : Array.isArray(g.english_synonyms) ? g.english_synonyms
        : Array.isArray(g.english) ? g.english
        : Array.isArray(g.keywords) ? g.keywords : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    )).slice(0, 8);
    const localKeywords = Array.from(new Set(
      (Array.isArray(g.local_keywords) ? g.local_keywords : [])
        .map((x) => String(x || '').trim())
        .filter(Boolean)
    )).slice(0, 6);

    if (paliTerms.length > 0 || paliStems.length > 0 || englishKeywords.length > 0 || localKeywords.length > 0) {
      normalized.push({
        concept: concept || paliTerms[0] || englishKeywords[0] || `Concept ${normalized.length + 1}`,
        pali_terms: paliTerms,
        pali_stems: paliStems,
        english_keywords: englishKeywords,
        ...(localKeywords.length > 0 ? { local_keywords: localKeywords } : {}),
      });
    }
    if (normalized.length >= 4) break;
  }

  if (normalized.length === 0 && (fallbackTerms.length > 0 || fallbackStems.length > 0)) {
    normalized.push({
      concept: fallbackTerms[0] || 'Core Topic',
      pali_terms: fallbackTerms.slice(0, 6),
      pali_stems: fallbackStems.slice(0, 6),
      english_keywords: [],
    });
  }
  return normalized;
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
      startPara = 9;
      endPara = 22;
    } else if (n === 35 && sub === 28) {
      suttaTitle = 'Ādittapariyāya Sutta (Fire Sermon)';
      startPara = 83;
      endPara = 90;
    } else if (n === 45 && sub === 8) {
      suttaTitle = 'Maggavibhaṅga Sutta';
      startPara = 46;
      endPara = 58;
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
      1: 's0401m.mul', 2: 's0402m1.mul', 3: 's0402m2.mul', 4: 's0402m3.mul',
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
      suttaTitle = 'Āghātapaṭivinaya Sutta';
      chapIdx = 16;
      startPara = 1089;
      endPara = 1096;
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
    default_sutta_para: 46,
    strategy: [
      'Search SN 45.8 (s0305m.mul:c0:p46) for canonical definitions of the eight factors.',
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
    default_sutta_para: 9,
    strategy: [
      'Retrieve canonical definitions of the 12 links in direct and reverse order (SN 12.2, s0302m.mul §9).',
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
    patterns: [/mett[aā]\s*sutta/i, /kara[ṇn][iī]yamett/i, /kinh\s*(?:từ\s*bi|tâm\s*từ|từ\s*ái)/i, /loving[\s-]?kindness\s+(?:sutta|discourse)/i],
    intent: 'sutta_lookup',
    target_suttas: ['Karaṇīyamettā Sutta (Khp 9 / Snp 1.8)'],
    pali_terms: ['karaṇīyamettāsutta', 'mettā', 'sabbe sattā bhavantu sukhitattā', 'mātā yathā niyaṃ puttaṃ', 'mānasam bhāvaye aparimāṇaṃ'],
    locations: { pitakas: ['sutta'], nikayas: ['kn'], books: ['s0501m.mul', 's0505m.mul'] },
    default_sutta_para: 243,
    strategy: [
      'Fetch Karaṇīyamettā Sutta (s0501m.mul:c8:p243 / s0505m.mul:c0:p478).',
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
    default_sutta_para: 530,
    strategy: [
      'Explain clearly that the Diamond and Heart Sūtras are Mahāyāna Sanskrit texts outside the Theravāda Pāḷi CST canon.',
      'Guide to the primary Pāḷi canonical discourses on Suññatā: MN 121, MN 122, and SN 35.85.'
    ],
    summary: 'Identified inquiry for Mahāyāna texts (Diamond/Heart Sūtra); framing response in relation to canonical Theravāda Suññatā discourses (MN 121, MN 122).'
  }
];

// Extract genuine Pāḷi terms from user prompt via DPD (filtering out English-to-Pāḷi <b class=epd> reverse entries,
// while optionally harvesting canonical Pāḷi equivalents from <b class=epd> when an English concept isn't in our lexicon)
function extractTermsFromPrompt(userQuery, { includeEpdReverse = false } = {}) {
  if (!userQuery) return [];
  const words = userQuery
    .toLowerCase()
    .replace(/[^a-zāīūṅñṭḍṇḷṃ\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !QUERY_STOP_WORDS.has(w));

  const validPaliTerms = [];
  const reversePaliTerms = [];
  const seen = new Set();
  const seenRev = new Set();

  for (const w of words.slice(0, 10)) {
    if (seen.has(w)) continue;
    seen.add(w);
    try {
      const res = dictEngine.lookupDPDFast(w, false);
      if (res && Array.isArray(res.dpd) && res.dpd.length > 0) {
        const hasNativePaliEntry = res.dpd.some((item) => item.html && !/class=["']?epd["']?/i.test(item.html));
        if (hasNativePaliEntry) {
          validPaliTerms.push(w);
        } else if (includeEpdReverse) {
          // Harvest top Pāḷi lemmas from DPD's English-to-Pāḷi reverse dictionary
          for (const item of res.dpd.slice(0, 1)) {
            const epdMatches = [...String(item.html || '').matchAll(/<b\s+class=["']?epd["']?[^>]*>([^<]+)<\/b>/gi)];
            for (const m of epdMatches.slice(0, 3)) {
              const lemma = m[1].trim().toLowerCase().split(/\s+/)[0];
              if (lemma.length >= 3 && !seenRev.has(lemma)) {
                seenRev.add(lemma);
                reversePaliTerms.push(lemma);
              }
            }
          }
        }
      }
    } catch (e) {}
  }
  return validPaliTerms.length > 0 ? validPaliTerms : reversePaliTerms.slice(0, 6);
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 1: COMPREHENSIVE QUERY DECOMPOSITION (OFFLINE HEURISTIC ENGINE)
// ═══════════════════════════════════════════════════════════════════════════

function heuristicQueryUnderstanding(userQuery, conversationHistory = [], dbTipitaka = null, dbSummaries = null) {
  const trimmed = (userQuery || '').trim();
  const lang = detectLanguage(trimmed);
  const SUPPORTED_TRANS_LANGS = new Set([
    'en', 'vi', 'my', 'si', 'zh', 'km', 'th', 'lo', 'ta', 'hi', 'mr',
    'id', 'cs', 'de', 'es', 'fr', 'ja', 'pt', 'ru', 'ko', 'ne', 'be',
  ]);
  const transLangs = ['en'];
  if (SUPPORTED_TRANS_LANGS.has(lang) && !transLangs.includes(lang)) {
    transLangs.push(lang);
  }
  const isDefinitionQuestion = CONCEPT_GROUP_LEXICON.some(
    (entry) => entry.isDefinitionIntent && entry.patterns.some((pat) => pat.test(trimmed))
  );

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
      const detectedTerms = extractTermsFromPrompt(trimmed);
      const conceptGroups = extractHeuristicConceptGroups(trimmed, detectedTerms, null);
      if (conceptGroups.length === 0) {
        conceptGroups.push({
          concept: resolved.sutta_name,
          pali_terms: [resolved.sutta_name.replace(/\s*\(.*?\)/, '').trim()],
          pali_stems: Array.from(new Set(paliStems.map((s) => `${s}*`))),
          english_keywords: [],
        });
      }
      return {
        intent: 'sutta_lookup',
        detected_language: lang,
        core_question: trimmed,
        concept_groups: conceptGroups,
        canonical_pali_terms: Array.from(new Set([resolved.sutta_name, resolved.citation, ...detectedTerms])),
        pali_stems: Array.from(new Set(paliStems.map((s) => `${s}*`))),
        english_keywords: Array.from(new Set(conceptGroups.flatMap((g) => g.english_keywords || []))),
        needs_bold_definitions: isDefinitionQuestion || detectedTerms.length > 0,
        key_terms_for_bold_def: detectedTerms.slice(0, 3),
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
          'Cross-reference classical Aṭṭhakathā commentary and bold definitions for doctrinal context.',
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
    const detectedTerms = extractTermsFromPrompt(trimmed);
    const conceptGroups = extractHeuristicConceptGroups(trimmed, detectedTerms, matchedKb);
    const allPaliTerms = Array.from(new Set([
      ...matchedKb.pali_terms,
      ...conceptGroups.flatMap((g) => g.pali_terms || []),
    ]));
    const paliStems = Array.from(new Set([
      ...allPaliTerms.map(extractPaliStem).filter((s) => s.length >= 3).map((s) => `${s}*`),
      ...conceptGroups.flatMap((g) => g.pali_stems || []),
    ]));
    const englishKeywords = Array.from(new Set(conceptGroups.flatMap((g) => g.english_keywords || [])));
    const keyTermsForBoldDef = allPaliTerms
      .filter((t) => !/\s/.test(t) && t.length >= 3)
      .slice(0, 3);
    return {
      intent: isDefinitionQuestion && matchedKb.intent !== 'sutta_lookup' ? 'term_analysis' : matchedKb.intent,
      detected_language: lang,
      core_question: trimmed,
      concept_groups: conceptGroups,
      canonical_pali_terms: allPaliTerms.slice(0, 12),
      pali_stems: paliStems.slice(0, 12),
      english_keywords: englishKeywords.slice(0, 12),
      needs_bold_definitions: isDefinitionQuestion || matchedKb.intent === 'doctrinal_explanation',
      key_terms_for_bold_def: keyTermsForBoldDef,
      target_sutta_names: matchedKb.target_suttas,
      recommended_locations: matchedKb.locations,
      default_sutta_para: matchedKb.default_sutta_para || null,
      translation_languages: transLangs,
      initial_search_strategy: matchedKb.strategy,
      user_facing_summary: matchedKb.summary,
      source: 'heuristic_kb',
    };
  }

  // 3. Database Catalog Match: only trigger for specific named sutta/chapter lookups
  // (avoid hijacking multi-concept doctrinal questions or Vinaya/Abhidhamma questions)
  const preDetectedTerms = extractTermsFromPrompt(trimmed, { includeEpdReverse: false });
  const preLexiconGroups = extractHeuristicConceptGroups(trimmed, [], null);
  const looksLikeSuttaLookup = /\b(sutta|suttaṃ|vagga|vaggo|discourse|kinh|သုတ်)\b/i.test(trimmed);

  if (dbTipitaka && (looksLikeSuttaLookup || preLexiconGroups.length === 0)) {
    try {
      const words = trimmed
        .toLowerCase()
        .replace(/[^a-zāīūṅñṭḍṇḷṃ\s]/gi, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 5 && !QUERY_STOP_WORDS.has(w));

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
          const conceptGroups = extractHeuristicConceptGroups(trimmed, [w, ...preDetectedTerms], null);
          const nikCode = cRow.book_code.startsWith('s01')
            ? 'dn'
            : cRow.book_code.startsWith('s02')
            ? 'mn'
            : cRow.book_code.startsWith('s03')
            ? 'sn'
            : cRow.book_code.startsWith('s04')
            ? 'an'
            : 'kn';
          return {
            intent: 'sutta_lookup',
            detected_language: lang,
            core_question: trimmed,
            concept_groups: conceptGroups,
            canonical_pali_terms: Array.from(new Set([sTitle, w, ...preDetectedTerms])),
            pali_stems: Array.from(new Set([`${extractPaliStem(w)}*`, ...conceptGroups.flatMap((g) => g.pali_stems || [])])),
            english_keywords: Array.from(new Set(conceptGroups.flatMap((g) => g.english_keywords || []))),
            needs_bold_definitions: isDefinitionQuestion,
            key_terms_for_bold_def: preDetectedTerms.slice(0, 3),
            target_sutta_names: [sTitle],
            recommended_locations: {
              pitakas: ['sutta'],
              nikayas: [nikCode],
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

  // 4. Concept-Group Lexicon + DPD Dictionary (including English-to-Pāḷi reverse lookup when lexicon had no hits)
  const detectedTerms = preDetectedTerms.length > 0
    ? preDetectedTerms
    : extractTermsFromPrompt(trimmed, { includeEpdReverse: true });
  const conceptGroups = extractHeuristicConceptGroups(trimmed, detectedTerms, null);
  const groupPaliTerms = conceptGroups.flatMap((g) => g.pali_terms || []);
  const groupStems = conceptGroups.flatMap((g) => g.pali_stems || []);
  const groupEnglish = conceptGroups.flatMap((g) => g.english_keywords || []);

  const allTerms = Array.from(new Set([...detectedTerms, ...groupPaliTerms]));
  const fallbackTerms = allTerms.length > 0 ? allTerms : (trimmed.split(/\s+/).slice(0, 3));
  const stems = Array.from(new Set([
    ...groupStems,
    ...fallbackTerms.map(extractPaliStem).filter((s) => s.length >= 3).map((s) => `${s}*`),
  ]));
  const keyTermsForBoldDef = allTerms.filter((t) => !/\s/.test(t) && t.length >= 3).slice(0, 3);

  // Detect explicit Piṭaka / Nikāya scope if mentioned in the user's inquiry.
  // Leave empty for general inquiries so Vinaya, Abhidhamma, Khuddaka, and Visuddhimagga are never masked out.
  const explicitPitakas = [];
  const explicitNikayas = [];
  if (/\b(vinaya|p[aā]timokkha|p[aā]r[aā]jika|p[aā]cittiya|monastic\s+rule|bhikkhu\s+rule|luật\s*tạng|ဝိနည်း)\b/i.test(trimmed)) {
    explicitPitakas.push('vinaya');
  }
  if (/\b(abhidhamma|dhammasa[ṅn]ga[ṇn][iī]|vibha[ṅn]ga|pa[ṭt][ṭt]h[aā]na|cetasika|vi\s*diệu\s*pháp|အဘိဓမ္မာ)\b/i.test(trimmed)) {
    explicitPitakas.push('abhidhamma');
  }
  if (/\b(d[iī]gha\s*nik[aā]ya|tr[uư][ờo]ng\s*b[ộo])\b/i.test(trimmed)) explicitNikayas.push('dn');
  if (/\b(majjhima\s*nik[aā]ya|trung\s*b[ộo])\b/i.test(trimmed)) explicitNikayas.push('mn');
  if (/\b(sa[ṃm]yutta\s*nik[aā]ya|t[uư][ơo]ng\s*[uư]ng)\b/i.test(trimmed)) explicitNikayas.push('sn');
  if (/\b(a[ṅn]guttara\s*nik[aā]ya|t[aă]ng\s*chi)\b/i.test(trimmed)) explicitNikayas.push('an');
  if (/\b(khuddaka\s*nik[aā]ya|ti[ểe]u\s*b[ộo])\b/i.test(trimmed)) explicitNikayas.push('kn');
  if (/\b(j[aā]taka|b[ổo]n\s*sanh)\b/i.test(trimmed)) explicitNikayas.push('ja');

  const intent = explicitPitakas.includes('vinaya')
    ? 'monastic_rule'
    : isDefinitionQuestion
    ? 'term_analysis'
    : (conceptGroups.length >= 2 ? 'doctrinal_explanation' : (allTerms.length > 0 ? 'doctrinal_explanation' : 'general_dhamma'));

  return {
    intent,
    detected_language: lang,
    core_question: trimmed,
    concept_groups: conceptGroups,
    canonical_pali_terms: fallbackTerms.slice(0, 12),
    pali_stems: stems.slice(0, 12),
    english_keywords: Array.from(new Set(groupEnglish)).slice(0, 12),
    needs_bold_definitions: isDefinitionQuestion || keyTermsForBoldDef.length > 0,
    key_terms_for_bold_def: keyTermsForBoldDef,
    target_sutta_names: [],
    recommended_locations: {
      pitakas: explicitPitakas,
      nikayas: explicitNikayas,
      books: [],
    },
    default_sutta_para: null,
    translation_languages: transLangs,
    initial_search_strategy: [
      conceptGroups.length >= 2
        ? `Run concept-group boolean search intersecting: ${conceptGroups.map((g) => g.concept).join(' AND ')}`
        : `Search canonical passages & titles for: ${fallbackTerms.slice(0, 4).join(', ')}`,
      keyTermsForBoldDef.length > 0
        ? `Check pre-indexed canonical bold definitions & DPD for: ${keyTermsForBoldDef.join(', ')}`
        : 'Search CST full-text database across Pāḷi and English translations',
      'Read exact root paragraphs and cross-reference Aṭṭhakathā/Ṭīkā commentary',
    ],
    user_facing_summary: conceptGroups.length >= 2
      ? `Decomposed inquiry into ${conceptGroups.length} concept groups (${conceptGroups.map((g) => g.concept).join(' + ')}) for multi-concept Pāḷi & English canonical search.`
      : `Investigating Dhamma inquiry across the canonical books with identified terms: ${fallbackTerms.slice(0, 5).join(', ')}.`,
    source: 'heuristic_general',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  STEP 1: AI PROMPT UNDERSTANDING ENGINE (GEMINI / OPENAI / OPENROUTER)
// ═══════════════════════════════════════════════════════════════════════════

const kAiUnderstandingSystemPrompt = `You are Ani (AI Nissaya)'s Scholarly Query Understanding Engine for the Chaṭṭha Saṅgāyana Tipiṭaka (Pāḷi Canon).
Your duty is Step 1 of the canonical research loop:
1. Break the user's research question down into 1 to 4 MAIN CONCEPT GROUPS.
2. For each concept group, suggest precise Pāḷi technical terms & canonical synonyms (in Roman IAST diacritics), Pāḷi prefix stems (terminal vowel -a/-ā/-e/-o stripped + *), English keywords & synonyms (for English translation FTS5), AND optional "local_keywords" in the user's own language if the user did not ask in English (for native-language translation FTS5).
3. Identify whether canonical bold definitions (Aṭṭhakathā/Ṭīkā/Mūla term definitions) should be queried, and list up to 3 single-word Pāḷi headwords in "key_terms_for_bold_def".
4. Map the inquiry to candidate Sutta names, Piṭakas, Nikāyas, and CST book codes (leave pitakas/nikayas empty arrays [] unless the inquiry specifically targets one Piṭaka or Nikāya).

## Canonical Knowledge Guidelines
- Polyglot Fluency: The user may ask in English, Vietnamese, Burmese, Pāḷi, Chinese, Thai, Sinhala, German, French, Spanish, Japanese, etc. Detect the exact language code in "detected_language" and include it in "translation_languages" alongside "en".
- Concept-Group Decomposition Best Practices:
  * Multi-facet questions (e.g. "How does the Buddha teach overcoming anger with loving-kindness?") MUST be split into distinct concept groups:
    - Group 1: "Overcoming Anger" -> pali_terms: ["kodha", "vyāpāda", "āghāta", "dosa", "vera"], english_keywords: ["anger", "ill-will", "resentment", "hatred"]
    - Group 2: "Loving-kindness (Mettā)" -> pali_terms: ["mettā", "avera", "akodha", "adosa"], english_keywords: ["loving-kindness", "goodwill", "non-hatred", "benevolence"]
  * Term / definition questions (e.g. "What is saṅkhāra?" or "Explain papañca") -> set intent: "term_analysis", needs_bold_definitions: true, key_terms_for_bold_def: ["saṅkhāra"], and include contextual synonyms in concept_groups.
  * Sutta lookup examples:
    - "bánh mật", "mật hoàn", "honey ball", "ပျားလုံး" -> Madhupiṇḍika Sutta (MN 18, s0201m.mul).
    - "quán niệm hơi thở", "mindfulness of breathing", "အာနာပါနဿတိ" -> Ānāpānassati Sutta (MN 118, s0203m.mul).
    - "đại bát niết bàn", "parinibbana", "last days of buddha" -> Mahāparinibbāna Sutta (DN 16, s0102m.mul).
    - "tứ diệu đế", "four noble truths", "သစ္စာလေးပါး" -> Dhammacakkappavattana Sutta (SN 56.11, s0305m.mul) & Saccavibhaṅga (MN 141).
    - "tứ niệm xứ", "satipatthana", "သတိပဋ္ဌာန်" -> Mahāsatipaṭṭhāna (DN 22, s0102m.mul) & Satipaṭṭhāna (MN 10, s0201m.mul).
    - "duyên khởi", "dependent origination" -> Paṭiccasamuppāda-vibhaṅga (SN 12.2, s0302m.mul) & Mahānidāna (DN 15).
    - "vô ngã", "non-self", "anattā" -> Anattalakkhaṇa Sutta (SN 22.59, s0303m.mul).
    - "kālāma", "kesamutti" -> Kesamutti Sutta (AN 3.65, s0402m2.mul).
  * If the user asks about Mahāyāna Sanskrit sūtras ("Kim Cang" / Diamond Sūtra, "Bát Nhã" / Heart Sūtra), note they are outside the Theravāda Pāḷi Canon and point to Pāḷi Suññatā discourses (MN 121, MN 122, SN 35.85).
- Always strip terminal vowels (-a, -ā, -e, -o) for Pāḷi stems (e.g. "madhupiṇḍik*", "kodh*", "mett*", "saṅkhār*", "sati*" — never shorten "sati" to "sat*").
- CST book code map:
  * DN 1-13 -> s0101m.mul, DN 14-23 -> s0102m.mul, DN 24-34 -> s0103m.mul
  * MN 1-50 -> s0201m.mul, MN 51-100 -> s0202m.mul, MN 101-152 -> s0203m.mul
  * SN 1-11 -> s0301m.mul, SN 12-21 -> s0302m.mul, SN 22-34 -> s0303m.mul, SN 35-44 -> s0304m.mul, SN 45-56 -> s0305m.mul
  * AN 1 -> s0401m.mul, AN 2 -> s0402m1.mul, AN 3 -> s0402m2.mul, AN 4 -> s0402m3.mul, AN 5 -> s0403m1.mul, AN 6 -> s0403m2.mul, AN 7 -> s0403m3.mul, AN 8 -> s0404m1.mul, AN 9 -> s0404m2.mul, AN 10 -> s0404m3.mul, AN 11 -> s0404m4.mul
  * Dhp -> s0502m.mul, Snp -> s0505m.mul, Jātaka -> s0513m.mul
  * Vinaya -> vin01m.mul, vin02m1.mul–vin02m4.mul
  * Abhidhamma -> abh01m.mul, abh02m.mul, abh03m1.mul–abh03m11.mul

## Output Schema
Return STRICTLY valid JSON adhering to:
{
  "intent": "sutta_lookup" | "doctrinal_explanation" | "term_analysis" | "monastic_rule" | "comparison" | "grammar_analysis" | "general_dhamma",
  "detected_language": "en" | "vi" | "my" | "th" | "zh" | "si" | "pi" | "de" | "fr" | "es" | "pt" | "ja" | "ko" | "other",
  "core_question": "Single clear sentence defining what is specifically being asked",
  "concept_groups": [
    {
      "concept": "Short name of Main Concept Group 1",
      "pali_terms": ["exact Pali lemma", "Pali synonym 1", "Pali synonym 2"],
      "pali_stems": ["stem1*", "stem2*"],
      "english_keywords": ["English keyword", "English synonym 1", "English synonym 2"],
      "local_keywords": ["optional keywords in user's non-English language"]
    }
  ],
  "needs_bold_definitions": true,
  "key_terms_for_bold_def": ["up to 3 single Pali headwords to look up in canonical bold definitions"],
  "canonical_pali_terms": ["flat list of primary Pali terms in Roman IAST"],
  "pali_stems": ["flat list of Pali stems ending in *"],
  "target_sutta_names": ["specific sutta names if identifiable, e.g. Madhupiṇḍika Sutta (MN 18)"],
  "recommended_locations": {
    "pitakas": [],
    "nikayas": [],
    "books": []
  },
  "translation_languages": ["en"],
  "initial_search_strategy": [
    "Step 1: Intersect concept groups using search_concepts",
    "Step 2: Check canonical bold definitions & DPD for core terms",
    "Step 3: Read exact root paragraphs and Aṭṭhakathā/Ṭīkā commentary"
  ],
  "user_facing_summary": "1-2 concise sentences summarizing how Ani broke down the question and which canonical sources will be investigated."
}`;

function safeParseJsonObject(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {}
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch (_) {}
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }
  return null;
}

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
    if (onStatus) onStatus('Analyzing prompt with canonical concept-group engine…');
    return heuristicQueryUnderstanding(trimmed, conversationHistory, dbTipitaka, dbSummaries);
  }

  // 2. Call AI model for deep concept-group query understanding
  if (onStatus) onStatus('🧠 Ani is decomposing your inquiry into concept groups & Pāḷi/English synonyms…');

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
Dissect this prompt into main concept groups with Pāḷi terms/stems and English synonyms according to the system instructions. Output ONLY the JSON object.`;

  try {
    if (provider === 'gemini') {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${toolModel}:generateContent?key=${apiKey.trim()}`;
      const payload = {
        system_instruction: { parts: [{ text: kAiUnderstandingSystemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userAnalysisPrompt }] }],
        generationConfig: {
          response_mime_type: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 1536,
        },
      };

      const res = await fetch(geminiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const json = await res.json();
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        const parsed = safeParseJsonObject(text);
        if (parsed) {
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

      let res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      });

      // Some OpenRouter / custom models reject response_format: json_object (HTTP 400/422)
      if (!res.ok && (res.status === 400 || res.status === 422)) {
        const retryPayload = { ...payload };
        delete retryPayload.response_format;
        res = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(retryPayload),
          signal: AbortSignal.timeout(15000),
        });
      }

      if (res.ok) {
        const json = await res.json();
        const text = json.choices?.[0]?.message?.content;
        const parsed = safeParseJsonObject(text);
        if (parsed) {
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
  const SUPPORTED_TRANS_LANGS = new Set([
    'en', 'vi', 'my', 'si', 'zh', 'km', 'th', 'lo', 'ta', 'hi', 'mr',
    'id', 'cs', 'de', 'es', 'fr', 'ja', 'pt', 'ru', 'ko', 'ne', 'be',
  ]);
  const lang = parsed.detected_language || detectLanguage(originalQuery);
  const rawTerms = Array.isArray(parsed.canonical_pali_terms) ? parsed.canonical_pali_terms : [];
  const rawStems = Array.isArray(parsed.pali_stems) ? parsed.pali_stems : [];

  const conceptGroups = normalizeConceptGroups(parsed.concept_groups, rawTerms, rawStems);
  const terms = Array.from(new Set([
    ...rawTerms,
    ...conceptGroups.flatMap((g) => g.pali_terms || []),
  ])).filter(Boolean);

  let stems = Array.from(new Set([
    ...rawStems,
    ...conceptGroups.flatMap((g) => g.pali_stems || []),
  ])).filter(Boolean);

  if (stems.length === 0 && terms.length > 0) {
    stems = Array.from(new Set(terms.map((t) => extractPaliStem(t.split(/\s+/)[0])).filter((s) => s.length >= 3).map((s) => `${s}*`)));
  }

  const englishKeywords = Array.from(new Set(
    conceptGroups.flatMap((g) => g.english_keywords || [])
  )).filter(Boolean);

  const keyTermsForBoldDef = Array.from(new Set([
    ...(Array.isArray(parsed.key_terms_for_bold_def) ? parsed.key_terms_for_bold_def : []),
    ...terms.filter((t) => !/\s/.test(t) && t.length >= 3),
  ])).slice(0, 3);

  const transLangs = Array.isArray(parsed.translation_languages)
    ? parsed.translation_languages.filter((l) => SUPPORTED_TRANS_LANGS.has(l))
    : [];
  if (!transLangs.includes('en')) transLangs.unshift('en');
  if (SUPPORTED_TRANS_LANGS.has(lang) && !transLangs.includes(lang)) transLangs.push(lang);

  let defaultPara = null;
  const targetSuttas = Array.isArray(parsed.target_sutta_names) ? parsed.target_sutta_names : [];
  let locations = parsed.recommended_locations || {
    pitakas: [],
    nikayas: [],
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
    concept_groups: conceptGroups,
    canonical_pali_terms: terms.slice(0, 12),
    pali_stems: stems.slice(0, 12),
    english_keywords: englishKeywords.slice(0, 12),
    needs_bold_definitions: parsed.needs_bold_definitions !== undefined
      ? Boolean(parsed.needs_bold_definitions)
      : (parsed.intent === 'term_analysis' || parsed.intent === 'doctrinal_explanation'),
    key_terms_for_bold_def: keyTermsForBoldDef,
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
  extractHeuristicConceptGroups,
  normalizeConceptGroups,
  safeParseJsonObject,
  kAiUnderstandingSystemPrompt,
  CANONICAL_KNOWLEDGE_BASE,
  CONCEPT_GROUP_LEXICON,
};
