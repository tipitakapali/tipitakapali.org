// Pure-Dart Pāli script converter, Velthuis input helper, and search/dictionary normalizer.
//
// Mirrors `tipitakapali.org/services/transliterate.js` across 17 scripts without
// requiring a JavaScript runtime.

enum PaliScript {
  roman('roman', 'Roman', 'Roman'),
  sinhala('sinhala', 'Sinhala', 'සිංහල'),
  devanagari('devanagari', 'Devanagari', 'नागरी'),
  myanmar('myanmar', 'Myanmar', 'ဗမာစာ'),
  thai('thai', 'Thai', 'ไทย'),
  lao('lao', 'Lao', 'ລາວ'),
  khmer('khmer', 'Khmer', 'ភាសាខ្មែរ'),
  bengali('bengali', 'Bengali', 'বাংলা'),
  gurmukhi('gurmukhi', 'Gurmukhi', 'ਗੁਰਮੁਖੀ'),
  taitham('taitham', 'Tai Tham', 'ᨲ᩠ᩅᩫᨵᨾ᩠ᨾ᩼'),
  gujarati('gujarati', 'Gujarati', 'ગુજરાતી'),
  telugu('telugu', 'Telugu', 'తెలుగు'),
  kannada('kannada', 'Kannada', 'ಕನ್ನಡ'),
  malayalam('malayalam', 'Malayalam', 'മലയാളം'),
  brahmi('brahmi', 'Brahmi', 'Brāhmī'),
  tibetan('tibetan', 'Tibetan', 'བོད་སྐད།'),
  cyrillic('cyrillic', 'Cyrillic', 'кириллица');

  final String id;
  final String englishName;
  final String nativeName;

  const PaliScript(this.id, this.englishName, this.nativeName);

  String get webId => this == PaliScript.lao ? 'laos' : id;

  static PaliScript fromId(String? id) {
    final normalized = id?.trim().toLowerCase();
    if (normalized == null || normalized.isEmpty) {
      return PaliScript.roman;
    }
    if (normalized == 'laos') {
      return PaliScript.lao;
    }
    for (final s in values) {
      if (s.id == normalized) return s;
    }
    return PaliScript.roman;
  }

  /// Column index in the parallel character tables (`_specials`, `_consonants`, `_vowels`).
  int get tableIndex {
    switch (this) {
      case PaliScript.sinhala:
        return 0;
      case PaliScript.devanagari:
        return 1;
      case PaliScript.roman:
        return 2;
      case PaliScript.thai:
        return 3;
      case PaliScript.lao:
        return 4;
      case PaliScript.myanmar:
        return 5;
      case PaliScript.khmer:
        return 6;
      case PaliScript.bengali:
        return 7;
      case PaliScript.gurmukhi:
        return 8;
      case PaliScript.taitham:
        return 9;
      case PaliScript.gujarati:
        return 10;
      case PaliScript.telugu:
        return 11;
      case PaliScript.kannada:
        return 12;
      case PaliScript.malayalam:
        return 13;
      case PaliScript.brahmi:
        return 14;
      case PaliScript.tibetan:
        return 15;
      case PaliScript.cyrillic:
        return 16;
    }
  }
}

class PaliScriptConverter {
  PaliScriptConverter._();

  // Order of columns:
  // 0:SI, 1:HI, 2:RO, 3:THAI, 4:LAO, 5:MY, 6:KM, 7:BENG, 8:GURM,
  // 9:THAM, 10:GUJA, 11:TELU, 12:KANN, 13:MALA, 14:BRAH, 15:TIBT, 16:CYRL
  static const List<List<String>> _specials = [
    ['අ', 'अ', 'a', 'อ', 'ອ', 'အ', 'អ', 'অ', 'ਅ', 'ᩋ', 'અ', 'అ', 'ಅ', 'അ', '𑀅', 'ཨ', 'а'],
    ['ආ', 'आ', 'ā', 'อา', 'ອາ', 'အာ', 'អា', 'আ', 'ਆ', 'ᩌ', 'આ', 'ఆ', 'ಆ', 'ആ', '𑀆', 'ཨཱ', 'а̄'],
    ['ඉ', 'इ', 'i', 'อิ', 'ອິ', 'ဣ', 'ឥ', 'ই', 'ਇ', 'ᩍ', 'ઇ', 'ఇ', 'ಇ', 'ഇ', '𑀇', 'ཨི', 'и'],
    ['ඊ', 'ई', 'ī', 'อี', 'ອີ', 'ဤ', 'ឦ', 'ঈ', 'ਈ', 'ᩎ', 'ઈ', 'ఈ', 'ಈ', 'ഈ', '𑀈', 'ཨཱི', 'ӣ'],
    ['උ', 'उ', 'u', 'อุ', 'ອຸ', 'ဥ', 'ឧ', 'উ', 'ਉ', 'ᩏ', 'ઉ', 'ఉ', 'ಉ', 'ഉ', '𑀉', 'ཨུ', 'у'],
    ['ඌ', 'ऊ', 'ū', 'อู', 'ອູ', 'ဦ', 'ឩ', 'ঊ', 'ਊ', 'ᩐ', 'ઊ', 'ఊ', 'ಊ', 'ഊ', '𑀊', 'ཨཱུ', 'ӯ'],
    ['එ', 'ए', 'e', 'อเ', 'ອເ', 'ဧ', 'ឯ', 'এ', 'ਏ', 'ᩑ', 'એ', 'ఏ', 'ಏ', 'ഏ', '𑀏', 'ཨེ', 'е'],
    ['ඔ', 'ओ', 'o', 'อโ', 'ອໂ', 'ဩ', 'ឱ', 'ও', 'ਓ', 'ᩒ', 'ઓ', 'ఓ', 'ಓ', 'ഓ', '𑀑', 'ཨོ', 'о'],
    ['ං', 'ं', 'ṃ', 'ํ', 'ໍ', 'ံ', 'ំ', 'ং', 'ਂ', 'ᩴ', 'ં', 'ం', 'ಂ', 'ം', '𑀁', 'ཾ', 'м̣'],
    ['ඃ', 'ः', 'ḥ', 'ะ', 'ະ', 'း', 'ះ', 'ঃ', 'ਃ', 'ᩡ', 'ઃ', 'ః', 'ಃ', 'ഃ', '𑀂', 'ཿ', 'х̣'],
    ['්', '्', '', 'ฺ', '຺', '္', '្', '্', '੍', '᩠', '્', '్', '್', '്', '𑁆', '྄', ''],
    ['0', '०', '0', '๐', '໐', '၀', '០', '০', '੦', '᪐', '૦', '౦', '೦', '൦', '𑁦', '༠', '0'],
    ['1', '१', '1', '๑', '໑', '၁', '១', '১', '੧', '᪑', '૧', '౧', '೧', '൧', '𑁧', '༡', '1'],
    ['2', '२', '2', '๒', '໒', '၂', '២', '২', '੨', '᪒', '૨', '౨', '೨', '൨', '𑁨', '༢', '2'],
    ['3', '३', '3', '๓', '໓', '၃', '៣', '৩', '੩', '᪓', '૩', '౩', '೩', '൩', '𑁩', '༣', '3'],
    ['4', '४', '4', '๔', '໔', '၄', '៤', '৪', '੪', '᪔', '૪', '౪', '೪', '൪', '𑁪', '༤', '4'],
    ['5', '५', '5', '๕', '໕', '၅', '៥', '৫', '੫', '᪕', '૫', '౫', '೫', '൫', '𑁫', '༥', '5'],
    ['6', '६', '6', '๖', '໖', '၆', '៦', '৬', '੬', '᪖', '૬', '౬', '೬', '൬', '𑁬', '༦', '6'],
    ['7', '७', '7', '๗', '໗', '၇', '៧', '৭', '੭', '᪗', '૭', '౭', '೭', '൭', '𑁭', '༧', '7'],
    ['8', '८', '8', '๘', '໘', '၈', '៨', '৮', '੮', '᪘', '૮', '౮', '೮', '൮', '𑁮', '༨', '8'],
    ['9', '९', '9', '๙', '໙', '၉', '៩', '৯', '੯', '᪙', '૯', '౯', '೯', '൯', '𑁯', '༩', '9'],
  ];

  static const List<List<String>> _consonants = [
    ['ක', 'क', 'k', 'ก', 'ກ', 'က', 'ក', 'ক', 'ਕ', 'ᨠ', 'ક', 'క', 'ಕ', 'ക', '𑀓', 'ཀ', 'к'],
    ['ඛ', 'ख', 'kh', 'ข', 'ຂ', 'ခ', 'ខ', 'খ', 'ਖ', 'ᨡ', 'ખ', 'ఖ', 'ಖ', 'ഖ', '𑀔', 'ཁ', 'кх'],
    ['ග', 'ग', 'g', 'ค', 'ຄ', 'ဂ', 'គ', 'গ', 'ਗ', 'ᨣ', 'ગ', 'గ', 'ಗ', 'ഗ', '𑀕', 'ག', 'г'],
    ['ඝ', 'घ', 'gh', 'ฆ', 'ຆ', 'ဃ', 'ឃ', 'ঘ', 'ਘ', 'ᨥ', 'ઘ', 'ఘ', 'ಘ', 'ഘ', '𑀖', 'གྷ', 'гх'],
    ['ඞ', 'ङ', 'ṅ', 'ง', 'ງ', 'င', 'ង', 'ঙ', 'ਙ', 'ᨦ', 'ઙ', 'ఙ', 'ಙ', 'ങ', '𑀗', 'ང', 'н̇'],
    ['ච', 'च', 'c', 'จ', 'ຈ', 'စ', 'ច', 'চ', 'ਚ', 'ᨧ', 'ચ', 'చ', 'ಚ', 'ച', '𑀘', 'ཙ', 'ч'],
    ['ඡ', 'छ', 'ch', 'ฉ', 'ຉ', 'ဆ', 'ឆ', 'ছ', 'ਛ', 'ᨨ', 'છ', 'ఛ', 'ಛ', 'ഛ', '𑀙', 'ཚ', 'чх'],
    ['ජ', 'ज', 'j', 'ช', 'ຊ', 'ဇ', 'ជ', 'জ', 'ਜ', 'ᨩ', 'જ', 'జ', 'ಜ', 'ജ', '𑀚', 'ཛ', 'дж'],
    ['ඣ', 'झ', 'jh', 'ฌ', 'ຌ', 'ဈ', 'ឈ', 'ঝ', 'ਝ', 'ᨫ', 'ઝ', 'ఝ', 'ಝ', 'ഝ', '𑀛', 'ཛྷ', 'джх'],
    ['ඤ', 'ञ', 'ñ', 'ญ', 'ຎ', 'ဉ', 'ញ', 'ঞ', 'ਞ', 'ᨬ', 'ઞ', 'ఞ', 'ಞ', 'ഞ', '𑀜', 'ཉ', 'н̃'],
    ['ට', 'ट', 'ṭ', 'ฏ', 'ຏ', 'ဋ', 'ដ', 'ট', 'ਟ', 'ᨭ', 'ટ', 'ట', 'ಟ', 'ട', '𑀝', 'ཊ', 'т̣'],
    ['ඨ', 'ठ', 'ṭh', 'ฐ', 'ຐ', 'ဌ', 'ឋ', 'ঠ', 'ਠ', 'ᨮ', 'ઠ', 'ఠ', 'ಠ', 'ഠ', '𑀞', 'ཋ', 'т̣х'],
    ['ඩ', 'ड', 'ḍ', 'ฑ', 'ຑ', 'ဍ', 'ឌ', 'ড', 'ਡ', 'ᨯ', 'ડ', 'డ', 'ಡ', 'ഡ', '𑀟', 'ཌ', 'д̣'],
    ['ඪ', 'ढ', 'ḍh', 'ฒ', 'ຒ', 'ဎ', 'ឍ', 'ঢ', 'ਢ', 'ᨰ', 'ઢ', 'ఢ', 'ಢ', 'ഢ', '𑀠', 'ཌྷ', 'д̣х'],
    ['ණ', 'ण', 'ṇ', 'ณ', 'ຓ', 'ဏ', 'ណ', 'ণ', 'ਣ', 'ᨱ', 'ણ', 'ణ', 'ಣ', 'ണ', '𑀡', 'ཎ', 'н̣'],
    ['ත', 'त', 't', 'ต', 'ຕ', 'တ', 'ត', 'ত', 'ਤ', 'ᨲ', 'ત', 'త', 'ತ', 'ത', '𑀢', 'ཏ', 'т'],
    ['ථ', 'थ', 'th', 'ถ', 'ຖ', 'ထ', 'ថ', 'থ', 'ਥ', 'ᨳ', 'થ', 'థ', 'ಥ', 'ഥ', '𑀣', 'ཐ', 'тх'],
    ['ද', 'द', 'd', 'ท', 'ທ', 'ဒ', 'ទ', 'দ', 'ਦ', 'ᨴ', 'દ', 'ద', 'ದ', 'ദ', '𑀤', 'ད', 'д'],
    ['ධ', 'ध', 'dh', 'ธ', 'ຘ', 'ဓ', 'ធ', 'ধ', 'ਧ', 'ᨵ', 'ધ', 'ధ', 'ಧ', 'ധ', '𑀥', 'དྷ', 'дх'],
    ['න', 'न', 'n', 'น', 'ນ', 'န', 'ន', 'ন', 'ਨ', 'ᨶ', 'ન', 'న', 'ನ', 'ന', '𑀦', 'ན', 'н'],
    ['ප', 'प', 'p', 'ป', 'ປ', 'ပ', 'ប', 'প', 'ਪ', 'ᨸ', 'પ', 'ప', 'ಪ', 'പ', '𑀧', 'པ', 'п'],
    ['ඵ', 'फ', 'ph', 'ผ', 'ຜ', 'ဖ', 'ផ', 'ফ', 'ਫ', 'ᨹ', 'ફ', 'ఫ', 'ಫ', 'ഫ', '𑀨', 'ཕ', 'пх'],
    ['බ', 'ब', 'b', 'พ', 'ພ', 'ဗ', 'ព', 'ব', 'ਬ', 'ᨻ', 'બ', 'బ', 'ಬ', 'ബ', '𑀩', 'བ', 'б'],
    ['භ', 'भ', 'bh', 'ภ', 'ຠ', 'ဘ', 'ភ', 'ভ', 'ਭ', 'ᨽ', 'ભ', 'భ', 'ಭ', 'ഭ', '𑀪', 'བྷ', 'бх'],
    ['ම', 'म', 'm', 'ม', 'ມ', 'မ', 'ម', 'ম', 'ਮ', 'ᨾ', 'મ', 'మ', 'ಮ', 'മ', '𑀫', 'མ', 'м'],
    ['ය', 'य', 'y', 'ย', 'ຍ', 'ယ', 'យ', 'য', 'ਯ', 'ᨿ', 'ય', 'య', 'ಯ', 'യ', '𑀬', 'ཡ', 'й'],
    ['ර', 'र', 'r', 'ร', 'ຣ', 'ရ', 'រ', 'র', 'ਰ', 'ᩁ', 'ર', 'ర', 'ರ', 'ര', '𑀭', 'ར', 'р'],
    ['ල', 'ल', 'l', 'ล', 'ລ', 'လ', 'ល', 'ল', 'ਲ', 'ᩃ', 'લ', 'ల', 'ಲ', 'ല', '𑀮', 'ལ', 'л'],
    ['ළ', 'ळ', 'ḷ', 'ฬ', 'ຬ', 'ဠ', 'ឡ', 'ল়', 'ਲ਼', 'ᩊ', 'ળ', 'ళ', 'ಳ', 'ള', '𑀴', 'ལ༹', 'л̣'],
    ['ව', 'व', 'v', 'ว', 'ວ', 'ဝ', 'វ', 'ৰ', 'ਵ', 'ᩅ', 'વ', 'వ', 'ವ', 'വ', '𑀯', 'ཝ', 'в'],
    ['ස', 'स', 's', 'ส', 'ສ', 'သ', 'ស', 'স', 'ਸ', 'ᩈ', 'સ', 'స', 'ಸ', 'സ', '𑀲', 'ས', 'с'],
    ['හ', 'ह', 'h', 'ห', 'ຫ', 'ဟ', 'ហ', 'হ', 'ਹ', 'ᩉ', 'હ', 'ह', 'ಹ', 'ഹ', '𑀳', 'ཧ', 'х'],
  ];

  static const List<List<String>> _vowels = [
    ['ා', 'ा', 'ā', 'า', 'າ', 'ာ', 'ា', 'া', 'ਾ', 'ᩣ', 'ા', 'ా', 'ಾ', 'ാ', '𑀸', 'ཱ', 'а̄'],
    ['ි', 'ि', 'i', 'ิ', 'ິ', 'ိ', 'ិ', 'ি', 'ਿ', 'ᩥ', 'િ', 'ి', 'ಿ', 'ി', '𑀺', 'ི', 'и'],
    ['ී', 'ी', 'ī', 'ี', 'ີ', 'ီ', 'ី', 'ী', 'ੀ', 'ᩦ', 'ી', 'ీ', 'ೀ', 'ീ', '𑀻', 'ཱི', 'ӣ'],
    ['ු', 'ु', 'u', 'ุ', 'ຸ', 'ု', 'ុ', 'ু', 'ੁ', 'ᩩ', 'ુ', 'ు', 'ು', 'ു', '𑀼', 'ུ', 'у'],
    ['ූ', 'ू', 'ū', 'ู', 'ູ', 'ူ', 'ូ', 'ূ', 'ੂ', 'ᩪ', 'ૂ', 'ూ', 'ಊ', 'ൂ', '𑀽', 'ཱུ', 'ӯ'],
    ['ෙ', 'े', 'e', 'เ', 'ເ', 'ေ', 'េ', 'ে', 'ੇ', 'ᩮ', 'ે', 'े', 'ೇ', 'േ', '𑁂', 'ེ', 'е'],
    ['ො', 'ो', 'o', 'โ', 'ໂ', 'ော', 'ោ', 'ো', 'ੋ', 'ᩮᩣ', 'ો', 'ो', 'ೋ', 'ോ', '𑁄', 'ོ', 'о'],
  ];

  // Note Kannada/Telugu/Gujarati vowel signs need exact entries from transliterate.js:
  static final List<List<String>> _fixedVowels = [
    _vowels[0],
    _vowels[1],
    _vowels[2],
    _vowels[3],
    ['ූ', 'ू', 'ū', 'ู', 'ູ', 'ူ', 'ូ', 'ূ', 'ੂ', 'ᩪ', 'ૂ', 'ూ', 'ೂ', 'ൂ', '𑀽', 'ཱུ', 'ӯ'],
    ['ෙ', 'े', 'e', 'เ', 'ເ', 'ေ', 'េ', 'ে', 'ੇ', 'ᩮ', 'ે', 'ె', 'ೇ', 'േ', '𑁂', 'ེ', 'е'],
    ['ො', 'ो', 'o', 'โ', 'ໂ', 'ော', 'ោ', 'ো', 'ੋ', 'ᩮᩣ', 'ો', 'ొ', 'ೋ', 'ോ', '𑁄', 'ོ', 'о'],
  ];

  static const Map<String, String> _sinhVowelSigns = {
    'අ': '',
    'ආ': 'ා',
    'ඉ': 'ි',
    'ඊ': 'ී',
    'උ': 'ු',
    'ඌ': 'ූ',
    'එ': 'ෙ',
    'ඔ': 'ො',
  };

  static String typeVelthuis(String input) {
    if (input.isEmpty) return '';
    return input
        .replaceAll('aa', 'ā')
        .replaceAll('ii', 'ī')
        .replaceAll('uu', 'ū')
        .replaceAll('m..', 'ṁ')
        .replaceAll('.m', 'ṃ')
        .replaceAll('.n', 'ṇ')
        .replaceAll('.d', 'ḍ')
        .replaceAll('ll.', 'ḹ')
        .replaceAll('.l', 'ḷ')
        .replaceAll('.h', 'ḥ')
        .replaceAll('.r', 'ṛ')
        .replaceAll('rr.', 'ṝ')
        .replaceAll('.s', 'ṣ')
        .replaceAll('"s', 'ś')
        .replaceAll('s..', 'ś')
        .replaceAll('.t', 'ṭ')
        .replaceAll('~n', 'ñ')
        .replaceAll(',,n', 'ñ')
        .replaceAll('"n', 'ṅ')
        .replaceAll('n..', 'ṅ')
        .replaceAll('AA', 'Ā')
        .replaceAll('II', 'Ī')
        .replaceAll('UU', 'Ū')
        .replaceAll('M..', 'Ṁ')
        .replaceAll('.M', 'Ṃ')
        .replaceAll('.N', 'Ṇ')
        .replaceAll('.D', 'Ḍ')
        .replaceAll('LL.', 'Ḹ')
        .replaceAll('.L', 'Ḷ')
        .replaceAll('.H', 'Ḥ')
        .replaceAll('.R', 'Ṛ')
        .replaceAll('RR.', 'Ṝ')
        .replaceAll('.S', 'Ṣ')
        .replaceAll('"S', 'Ś')
        .replaceAll('S..', 'Ś')
        .replaceAll('.T', 'Ṭ')
        .replaceAll('~N', 'Ñ')
        .replaceAll(',,N', 'Ñ')
        .replaceAll('"N', 'Ṅ')
        .replaceAll('N..', 'Ṅ');
  }

  /// Capitalizes the first Unicode letter of a Pāli string while preserving prefixes.
  static String capitalizePali(String text) {
    if (text.isEmpty) return '';
    return text.replaceFirstMapped(
      RegExp(r'^([\s\d.\-()\[\]/#:*]*)([\p{L}])', unicode: true),
      (m) => '${m.group(1)}${m.group(2)!.toUpperCase()}',
    );
  }

  /// Converts standard Roman Pāḷi text into [target] script.
  static String convertFromRoman(String romanText, PaliScript target) {
    if (romanText.isEmpty || target == PaliScript.roman) {
      return romanText;
    }
    final sinh = _toSinhala(romanText, PaliScript.roman);
    return _fromSinhala(sinh, target);
  }

  /// Converts any supported Pāḷi script or Velthuis input into lowercase/original Roman Pāḷi.
  static String convertToRoman(String text) {
    if (text.isEmpty) return '';
    var converted = typeVelthuis(text);
    final hasNonLatin = RegExp(
      r'[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]',
      unicode: true,
    ).hasMatch(converted);
    if (hasNonLatin) {
      final roman = _convertAnyNonLatinToRoman(converted);
      if (roman.trim().isNotEmpty) {
        converted = roman;
      }
    }
    return converted.replaceAll('ṁ', 'ṃ').replaceAll('Ṁ', 'ṃ');
  }

  static String normalizePaliForSearch(String text) {
    if (text.isEmpty) return '';
    var s = convertToRoman(text).toLowerCase();
    return s
        .replaceAll(RegExp(r'[āàáâãä]'), 'a')
        .replaceAll(RegExp(r'[īìíîï]'), 'i')
        .replaceAll(RegExp(r'[ūùúûü]'), 'u')
        .replaceAll(RegExp(r'[ēèéêë]'), 'e')
        .replaceAll(RegExp(r'[ōòóôö]'), 'o')
        .replaceAll(RegExp(r'[ṃṁ]'), 'm')
        .replaceAll(RegExp(r'[ṅñṇ]'), 'n')
        .replaceAll('ṭ', 't')
        .replaceAll('ḍ', 'd')
        .replaceAll('ḷ', 'l')
        .replaceAll('ś', 's')
        .replaceAll('ṣ', 's')
        .replaceAll('ṛ', 'r')
        .replaceAll('ṝ', 'r')
        .replaceAll('ḥ', 'h')
        .replaceAll(RegExp(r'[\s.,;:!?()\[\]{}"\x27\-_/\\]+'), ' ')
        .trim();
  }

  /// Normalizes a clicked or typed word for dictionary lookup, mirroring
  /// `normalizeDictWord` in `tipitakapali.org/server_api/dictEngine.js`.
  static String cleanDictionaryQuery(String rawWord) {
    if (rawWord.trim().isEmpty) return '';
    if (rawWord.startsWith('##')) return rawWord.trim();
    var text = convertToRoman(rawWord);
    text = text.replaceAll('ṁ', 'ṃ').replaceAll('Ṁ', 'ṃ');
    // Separate quote particles e.g. ’’ti, ’ti, ’’pi, ’va
    text = text.replaceAllMapped(
      RegExp(
        r"([’'\x22”»›]+)(ti|pi|va|eva|iti|api|nti)\b",
        caseSensitive: false,
      ),
      (m) => ' ${m.group(2)!}',
    );
    text = text.replaceAll(RegExp(r"[‘’“”\x22'`«»‹›„]"), ' ');
    text = text.replaceAll(
      RegExp(r'[.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§၊။।॥]'),
      ' ',
    );
    text = text.replaceFirst(RegExp(r'^[√\s\d.\-]+'), '');
    return text.toLowerCase().replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  static String _convertAnyNonLatinToRoman(String text) {
    final cleaned = text.replaceAll(RegExp(r'\u200C|\u200D'), '');
    final out = StringBuffer();
    PaliScript? currentScript;
    final segment = StringBuffer();

    void flush() {
      final seg = segment.toString();
      segment.clear();
      if (seg.isEmpty) return;
      if (currentScript == null || currentScript == PaliScript.roman) {
        out.write(seg);
      } else {
        final sinh = _toSinhala(seg, currentScript);
        out.write(_fromSinhala(sinh, PaliScript.roman));
      }
    }

    for (final rune in cleaned.runes) {
      final script = _detectScriptForRune(rune);
      if (script != currentScript) {
        flush();
        currentScript = script;
      }
      segment.writeCharCode(rune);
    }
    flush();
    return out.toString();
  }

  static PaliScript? _detectScriptForRune(int code) {
    if (code >= 0x0D80 && code <= 0x0DFF) return PaliScript.sinhala;
    if (code >= 0x0900 && code <= 0x097F) return PaliScript.devanagari;
    if ((code >= 0x0E00 && code <= 0x0E7F) || code == 0xF70F || code == 0xF700) {
      return PaliScript.thai;
    }
    if (code >= 0x0E80 && code <= 0x0EFF) return PaliScript.lao;
    if (code >= 0x1000 && code <= 0x109F) return PaliScript.myanmar;
    if (code >= 0x1780 && code <= 0x17FF) return PaliScript.khmer;
    if (code >= 0x0980 && code <= 0x09FF) return PaliScript.bengali;
    if (code >= 0x0A00 && code <= 0x0A7F) return PaliScript.gurmukhi;
    if (code >= 0x1A20 && code <= 0x1AAF) return PaliScript.taitham;
    if (code >= 0x0A80 && code <= 0x0AFF) return PaliScript.gujarati;
    if (code >= 0x0C00 && code <= 0x0C7F) return PaliScript.telugu;
    if (code >= 0x0C80 && code <= 0x0CFF) return PaliScript.kannada;
    if (code >= 0x0D00 && code <= 0x0D7F) return PaliScript.malayalam;
    if (code >= 0x11000 && code <= 0x1107F) return PaliScript.brahmi;
    if (code >= 0x0F00 && code <= 0x0FFF) return PaliScript.tibetan;
    if ((code >= 0x0400 && code <= 0x04FF) || (code >= 0x0300 && code <= 0x036F)) {
      return PaliScript.cyrillic;
    }
    if ((code >= 0x0000 && code <= 0x017F) || (code >= 0x1E00 && code <= 0x1EFF)) {
      return PaliScript.roman;
    }
    return null;
  }

  static String _toSinhala(String text, PaliScript source) {
    if (source == PaliScript.sinhala) return text;
    var s = text.replaceAll(RegExp(r'\u200C|\u200D'), '');
    switch (source) {
      case PaliScript.roman:
        s = s.toLowerCase().replaceAll('ṁ', 'ṃ');
        break;
      case PaliScript.thai:
        s = s
            .replaceAll('ฎ', 'ฏ')
            .replaceAll('\u0E36', 'ิํ')
            .replaceAll('\uF70F', 'ญ')
            .replaceAll('\uF700', 'ฐ');
        s = s.replaceAllMapped(
          RegExp(r'([เโ])([ก-ฮ])'),
          (m) => '${m.group(2)}${m.group(1)}',
        );
        break;
      case PaliScript.lao:
        s = s.replaceAllMapped(
          RegExp(r'([ເໂ])([ກ-ຮ])'),
          (m) => '${m.group(2)}${m.group(1)}',
        );
        break;
      case PaliScript.khmer:
        s = s.replaceAll('\u17B9', 'ិំ').replaceAll('\u17D1', '្');
        break;
      case PaliScript.myanmar:
        s = s
            .replaceAll('\u102B', 'ာ')
            .replaceAll('ှ', '္ဟ')
            .replaceAll('ွ', '္ဝ')
            .replaceAll('ြ', '္ရ')
            .replaceAll('ျ', '္ယ')
            .replaceAll('\u103A', '')
            .replaceAll('ဿ', 'သ္သ')
            .replaceAll('ည', 'ဉ္ဉ')
            .replaceAll('သံဃ', 'သင္ဃ')
            .replaceAll('၊', ',')
            .replaceAll('။', '.');
        break;
      default:
        break;
    }

    final includeVowels = source != PaliScript.roman && source != PaliScript.cyrillic;
    final mapLevels = _buildMap(source.tableIndex, 0, includeVowels: includeVowels);
    var result = _genericConvert(s, mapLevels);

    if (source == PaliScript.roman || source == PaliScript.cyrillic) {
      result = result
          .replaceAllMapped(
            RegExp(r'([ක-ෆ])([^අආඉඊඋඌඑඔ\u0DCA])'),
            (m) => '${m.group(1)}්${m.group(2)}',
          )
          .replaceAllMapped(
            RegExp(r'([ක-ෆ])([^අආඉඊඋඌඑඔ\u0DCA])'),
            (m) => '${m.group(1)}්${m.group(2)}',
          )
          .replaceAllMapped(RegExp(r'([ක-ෆ])$'), (m) => '${m.group(1)}්')
          .replaceAllMapped(
            RegExp(r'([ක-ෆ])([අආඉඊඋඌඑඔ])'),
            (m) => '${m.group(1)}${_sinhVowelSigns[m.group(2)] ?? ''}',
          );
    }
    return result;
  }

  static String _fromSinhala(String sinhText, PaliScript target) {
    if (target == PaliScript.sinhala) return sinhText;
    var s = sinhText;
    if (target == PaliScript.roman || target == PaliScript.cyrillic) {
      final aChar = target == PaliScript.cyrillic ? 'а' : 'a';
      s = s
          .replaceAllMapped(
            RegExp('([ක-ෆ])([^ා-ෟ්$aChar])'),
            (m) => '${m.group(1)}$aChar${m.group(2)}',
          )
          .replaceAllMapped(
            RegExp('([ක-ෆ])([^ා-ෟ්$aChar])'),
            (m) => '${m.group(1)}$aChar${m.group(2)}',
          )
          .replaceAllMapped(RegExp(r'([ක-ෆ])$'), (m) => '${m.group(1)}$aChar');
    }

    final mapLevels = _buildMap(0, target.tableIndex, includeVowels: true);
    var out = _genericConvert(s, mapLevels);
    return _beautify(out, target);
  }

  static List<MapEntry<int, Map<String, String>>> _buildMap(
    int fromIdx,
    int toIdx, {
    required bool includeVowels,
  }) {
    final buckets = <int, Map<String, String>>{};
    final rows = [
      ..._consonants,
      ..._specials,
      if (includeVowels) ..._fixedVowels,
    ];
    for (final row in rows) {
      final key = row[fromIdx];
      if (key.isEmpty) continue;
      buckets.putIfAbsent(key.length, () => <String, String>{})[key] = row[toIdx];
    }
    final sorted = buckets.entries.toList()..sort((a, b) => b.key.compareTo(a.key));
    return sorted;
  }

  static String _genericConvert(
    String input,
    List<MapEntry<int, Map<String, String>>> mapLevels,
  ) {
    final out = StringBuffer();
    var i = 0;
    while (i < input.length) {
      var matched = false;
      for (final entry in mapLevels) {
        final len = entry.key;
        if (i + len <= input.length) {
          final sub = input.substring(i, i + len);
          final replacement = entry.value[sub];
          if (replacement != null) {
            out.write(replacement);
            i += len;
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        out.write(input[i]);
        i += 1;
      }
    }
    return out.toString();
  }

  static String _beautify(String text, PaliScript target) {
    var out = text;
    switch (target) {
      case PaliScript.sinhala:
        out = out.replaceAllMapped(
          RegExp(r'\u0DCA([\u0DBA\u0DBB])'),
          (m) => '\u0DCA\u200D${m.group(1)}',
        );
        break;
      case PaliScript.thai:
        out = out
            .replaceAllMapped(RegExp(r'([ก-ฮ])([เโ])'), (m) => '${m.group(2)}${m.group(1)}')
            .replaceAll('\u0E34\u0E4D', 'ึ')
            .replaceAll('ญ', '')
            .replaceAll('ฐ', '');
        break;
      case PaliScript.lao:
        out = out.replaceAllMapped(
          RegExp(r'([ກ-ຮ])([ເໂ])'),
          (m) => '${m.group(2)}${m.group(1)}',
        );
        break;
      case PaliScript.myanmar:
        out = out
            .replaceAll(RegExp(r'[,;]'), '၊')
            .replaceAll(RegExp(r'[\u0964\u0965]+'), '။')
            .replaceAll('.', '။')
            .replaceAll('ဉ\u1039ဉ', 'ည')
            .replaceAll('သ\u1039သ', 'ဿ')
            .replaceAllMapped(RegExp(r'င္([က-ဠ])'), (m) => 'င်္${m.group(1)}')
            .replaceAll('္ယ', 'ျ')
            .replaceAll('္ရ', 'ြ')
            .replaceAll('္ဝ', 'ွ')
            .replaceAll('္ဟ', 'ှ')
            .replaceAllMapped(RegExp(r'([ခဂငဒပဝ]ေ?)\u102c'), (m) => '${m.group(1)}ါ')
            .replaceAllMapped(
              RegExp(r'(က္ခ|န္ဒ|ပ္ပ|မ္ပ)(ေ?)\u102b'),
              (m) => '${m.group(1)}${m.group(2)}ာ',
            )
            .replaceAllMapped(
              RegExp(r'(ဒ္ဓ|ဒွ)(ေ?)\u102c'),
              (m) => '${m.group(1)}ါ',
            );
        break;
      case PaliScript.taitham:
        out = out
            .replaceAll('\u1A60\u1A41', 'ᩕ')
            .replaceAll('\u1A48\u1A60\u1A48', 'ᩔ')
            .replaceAll('।', '᪨')
            .replaceAll('॥', '᪩');
        break;
      case PaliScript.brahmi:
        out = out.replaceAll('।', '𑁇').replaceAll('॥', '𑁈').replaceAll('–', '𑁋');
        break;
      case PaliScript.tibetan:
        out = out.replaceAll('।', '།').replaceAll('॥', '༎');
        for (var n = 0; n <= 39; n++) {
          out = out.replaceAll(
            String.fromCharCode(3972) + String.fromCharCode(3904 + n),
            String.fromCharCode(3984 + n),
          );
        }
        out = out
            .replaceAll('\u0F61\u0FB1', 'ཡྻ')
            .replaceAll('\u0F5D\u0FAD', 'ཝྺ')
            .replaceAll('\u0F5B\u0FAC', 'ཛ྄ཛྷ')
            .replaceAll('\u0F61\u0FB7', 'ཡ྄ཧ')
            .replaceAll('\u0F5D\u0FB7', 'ཝ྄ཧ');
        break;
      default:
        break;
    }
    return out
        .replaceAll('॰…', '…')
        .replaceAll('॰', '·')
        .replaceAll(RegExp(r'[।॥]'), '.')
        .replaceAllMapped(RegExp(r'\s([\s,;!?.])'), (m) => m.group(1)!);
  }
}
