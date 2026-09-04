// Pali Script Converter & Velthuis Typing Support
const CVT = (function(){return(()=>{"use strict";var e={384:(e,r,n)=>{var a,t,o,l,c;function u(e,r){for(var n=0;n<r.length;n++){var a=r[n];a.enumerable=a.enumerable||!1,a.configurable=!0,"value"in a&&(a.writable=!0),Object.defineProperty(e,a.key,a)}}function i(e,r){var n;if("undefined"==typeof Symbol||null==e[Symbol.iterator]){if(Array.isArray(e)||(n=function(e,r){if(e){if("string"==typeof e)return g(e,r);var n=Object.prototype.toString.call(e).slice(8,-1);return"Object"===n&&e.constructor&&(n=e.constructor.name),"Map"===n||"Set"===n?Array.from(e):"Arguments"===n||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n)?g(e,r):void 0}}(e))||r&&e&&"number"==typeof e.length){n&&(e=n);var a=0;return function(){return a>=e.length?{done:!0}:{done:!1,value:e[a++]}}}throw new TypeError("Invalid attempt to iterate non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}return(n=e[Symbol.iterator]()).next.bind(n)}function g(e,r){(null==r||r>e.length)&&(r=e.length);for(var n=0,a=new Array(r);n<r;n++)a[n]=e[n];return a}n.d(r,{default:()=>k});var p=Object.freeze({SI:"Sinh",HI:"Deva",RO:"Latn",THAI:"Thai",LAOS:"Laoo",MY:"Mymr",KM:"Khmr",BENG:"Beng",GURM:"Guru",THAM:"Lana",GUJA:"Gujr",TELU:"Telu",KANN:"Knda",MALA:"Mlym",BRAH:"Brah",TIBT:"Tibt",CYRL:"Cyrl"}),f=new Map([[p.SI,["Sinhala","සිංහල",[[3456,3583]],{f:"sl_flag.png",locale:"si",localeName:"සිංහල"}]],[p.HI,["Devanagari","नागरी",[[2304,2431]],{f:"in_flag.png",locale:"hi",localeName:"हिन्दी"}]],[p.RO,["Roman","Roman",[[0,383],[7680,7935]],{f:"uk_flag.png",locale:"en",localeName:"English"}]],[p.THAI,["Thai","ไทย",[[3584,3711],63247,63232],{f:"th_flag.png",locale:"th",localeName:"ไทย"}]],[p.LAOS,["Laos","ລາວ",[[3712,3839]],{f:"laos_flag.png",locale:"lo",localeName:"ລາວ"}]],[p.MY,["Myanmar","ဗမာစာ",[[4096,4223]],{f:"my_flag.png",locale:"my",localeName:"ဗမာစာ"}]],[p.KM,["Khmer","ភាសាខ្មែរ",[[6016,6143]],{f:"kh_flag.png",locale:"km",localeName:"ភាសាខ្មែរ"}]],[p.BENG,["Bengali","বাংলা",[[2432,2559]],{f:"bangla_flag.png",locale:"bn",localeName:"বাংলা",g:"indian"}]],[p.GURM,["Gurmukhi","ਗੁਰਮੁਖੀ",[[2560,2687]],{locale:"pa",localeName:"ਪੰਜਾਬੀ",g:"indian"}]],[p.GUJA,["Gujarati","ગુજરાતી",[[2688,2815]],{locale:"gu",localeName:"ગુજરાતી",g:"indian"}]],[p.TELU,["Telugu","తెలుగు",[[3072,3199]],{locale:"te",localeName:"తెలుగు",g:"indian"}]],[p.KANN,["Kannada","ಕನ್ನಡ",[[3200,3327]],{locale:"kn",localeName:"ಕನ್ನಡ",g:"indian"}]],[p.MALA,["Malayalam","മലയാളം",[[3328,3455]],{locale:"ml",localeName:"മലയാളം",g:"indian"}]],[p.THAM,["Tai Tham","Tai Tham LN",[[6688,6831]],{locale:"th",localeName:"ไทย (Lanna)",c:"beta-script",g:"other"}]],[p.BRAH,["Brahmi","Brāhmī",[[55300,55300],[56320,56447]],{locale:"hi",localeName:"हिन्दी (Brah)",g:"other"}]],[p.TIBT,["Tibetan","བོད་སྐད།",[[3840,4095]],{f:"tibet_flag.png",c:"larger",locale:"bo",localeName:"བོད་སྐད།",g:"other"}]],[p.CYRL,["Cyrillic","кириллица",[[1024,1279],[768,879]],{f:"russia_flag.png",locale:"ru",localeName:"ру́сский",g:"other"}]]]);function h(e){for(var r,n=i(f);!(r=n()).done;)for(var a,t=r.value,o=i(t[1][2]);!(a=o()).done;){var l=a.value;if(Array.isArray(l)&&e>=l[0]&&e<=l[1])return t[0];if(Number.isInteger(l)&&e===l)return t[0]}return-1}var v=((a={})[p.SI]=0,a[p.HI]=1,a[p.RO]=2,a[p.THAI]=3,a[p.LAOS]=4,a[p.MY]=5,a[p.KM]=6,a[p.BENG]=7,a[p.GURM]=8,a[p.THAM]=9,a[p.GUJA]=10,a[p.TELU]=11,a[p.KANN]=12,a[p.MALA]=13,a[p.BRAH]=14,a[p.TIBT]=15,a[p.CYRL]=16,a),s=[["අ","अ","a","อ","ອ","အ","អ","অ","ਅ","ᩋ","અ","అ","ಅ","അ","𑀅","ཨ","а"],["ආ","आ","ā","อา","ອາ","အာ","អា","আ","ਆ","ᩌ","આ","ఆ","ಆ","ആ","𑀆","ཨཱ","а̄"],["ඉ","इ","i","อิ","ອິ","ဣ","ឥ","ই","ਇ","ᩍ","ઇ","ఇ","ಇ","ഇ","𑀇","ཨི","и"],["ඊ","ई","ī","อี","ອີ","ဤ","ឦ","ঈ","ਈ","ᩎ","ઈ","ఈ","ಈ","ഈ","𑀈","ཨཱི","ӣ"],["උ","उ","u","อุ","ອຸ","ဥ","ឧ","উ","ਉ","ᩏ","ઉ","ఉ","ಉ","ഉ","𑀉","ཨུ","у"],["ඌ","ऊ","ū","อู","ອູ","ဦ","ឩ","ঊ","ਊ","ᩐ","ઊ","ఊ","ಊ","ഊ","𑀊","ཨཱུ","ӯ"],["එ","ए","e","อเ","ອເ","ဧ","ឯ","এ","ਏ","ᩑ","એ","ఏ","ಏ","ഏ","𑀏","ཨེ","е"],["ඔ","ओ","o","อโ","ອໂ","ဩ","ឱ","ও","ਓ","ᩒ","ઓ","ఓ","ಓ","ഓ","𑀑","ཨོ","о"],["ං","ं","ṃ","ํ","ໍ","ံ","ំ","ং","ਂ","ᩴ","ં","ం","ಂ","ം","𑀁","ཾ","м̣"],["ඃ","ः","ḥ","ะ","ະ","း","ះ","ঃ","ਃ","ᩡ","ઃ","ః","ಃ","ഃ","𑀂","ཿ","х̣"],["්","्","","ฺ","຺","္","្","্","੍","᩠","્","్","್","്","𑁆","྄",""],["0","०","0","๐","໐","၀","០","০","੦","᪐","૦","౦","೦","൦","𑁦","༠","0"],["1","१","1","๑","໑","၁","១","১","੧","᪑","૧","౧","೧","൧","𑁧","༡","1"],["2","२","2","๒","໒","၂","២","২","੨","᪒","૨","౨","೨","൨","𑁨","༢","2"],["3","३","3","๓","໓","၃","៣","৩","੩","᪓","૩","౩","೩","൩","𑁩","༣","3"],["4","४","4","๔","໔","၄","៤","৪","੪","᪔","૪","౪","೪","൪","𑁪","༤","4"],["5","५","5","๕","໕","၅","៥","৫","੫","᪕","૫","౫","೫","൫","𑁫","༥","5"],["6","६","6","๖","໖","၆","៦","৬","੬","᪖","૬","౬","೬","൬","𑁬","༦","6"],["7","७","7","๗","໗","၇","៧","৭","੭","᪗","૭","౭","೭","൭","𑁭","༧","7"],["8","८","8","๘","໘","၈","៨","৮","੮","᪘","૮","౮","೮","൮","𑁮","༨","8"],["9","९","9","๙","໙","၉","៩","৯","੯","᪙","૯","౯","೯","൯","𑁯","༩","9"]],m=[["ක","क","k","ก","ກ","က","ក","ক","ਕ","ᨠ","ક","క","ಕ","ക","𑀓","ཀ","к"],["ඛ","ख","kh","ข","ຂ","ခ","ខ","খ","ਖ","ᨡ","ખ","ఖ","ಖ","ഖ","𑀔","ཁ","кх"],["ග","ग","g","ค","ຄ","ဂ","គ","গ","ਗ","ᨣ","ગ","గ","ಗ","ഗ","𑀕","ག","г"],["ඝ","घ","gh","ฆ","ຆ","ဃ","ឃ","ঘ","ਘ","ᨥ","ઘ","ఘ","ಘ","ഘ","𑀖","གྷ","гх"],["ඞ","ङ","ṅ","ง","ງ","င","ង","ঙ","ਙ","ᨦ","ઙ","ఙ","ಙ","ങ","𑀗","ང","н̇"],["ච","च","c","จ","ຈ","စ","ច","চ","ਚ","ᨧ","ચ","చ","ಚ","ച","𑀘","ཙ","ч"],["ඡ","छ","ch","ฉ","ຉ","ဆ","ឆ","ছ","ਛ","ᨨ","છ","ఛ","ಛ","ഛ","𑀙","ཚ","чх"],["ජ","ज","j","ช","ຊ","ဇ","ជ","জ","ਜ","ᨩ","જ","జ","ಜ","ജ","𑀚","ཛ","дж"],["ඣ","झ","jh","ฌ","ຌ","ဈ","ឈ","ঝ","ਝ","ᨫ","ઝ","ఝ","ಝ","ഝ","𑀛","ཛྷ","джх"],["ඤ","ञ","ñ","ญ","ຎ","ဉ","ញ","ঞ","ਞ","ᨬ","ઞ","ఞ","ಞ","ഞ","𑀜","ཉ","н̃"],["ට","ट","ṭ","ฏ","ຏ","ဋ","ដ","ট","ਟ","ᨭ","ટ","ట","ಟ","ട","𑀝","ཊ","т̣"],["ඨ","ठ","ṭh","ฐ","ຐ","ဌ","ឋ","ঠ","ਠ","ᨮ","ઠ","ఠ","ಠ","ഠ","𑀞","ཋ","т̣х"],["ඩ","ड","ḍ","ฑ","ຑ","ဍ","ឌ","ড","ਡ","ᨯ","ડ","డ","ಡ","ഡ","𑀟","ཌ","д̣"],["ඪ","ढ","ḍh","ฒ","ຒ","ဎ","ឍ","ঢ","ਢ","ᨰ","ઢ","ఢ","ಢ","ഢ","𑀠","ཌྷ","д̣х"],["ණ","ण","ṇ","ณ","ຓ","ဏ","ណ","ণ","ਣ","ᨱ","ણ","ణ","ಣ","ണ","𑀡","ཎ","н̣"],["ත","त","t","ต","ຕ","တ","ត","ত","ਤ","ᨲ","ત","త","ತ","ത","𑀢","ཏ","т"],["ථ","थ","th","ถ","ຖ","ထ","ថ","থ","ਥ","ᨳ","થ","థ","ಥ","ഥ","𑀣","ཐ","тх"],["ද","द","d","ท","ທ","ဒ","ទ","দ","ਦ","ᨴ","દ","ద","ದ","ദ","𑀤","ད","д"],["ධ","ध","dh","ธ","ຘ","ဓ","ធ","ধ","ਧ","ᨵ","ધ","ధ","ಧ","ധ","𑀥","དྷ","дх"],["න","न","n","น","ນ","န","ន","ন","ਨ","ᨶ","ન","న","ನ","ന","𑀦","ན","н"],["ප","प","p","ป","ປ","ပ","ប","প","ਪ","ᨸ","પ","ప","ಪ","പ","𑀧","པ","п"],["ඵ","फ","ph","ผ","ຜ","ဖ","ផ","ফ","ਫ","ᨹ","ફ","ఫ","ಫ","ഫ","𑀨","ཕ","пх"],["බ","ब","b","พ","ພ","ဗ","ព","ব","ਬ","ᨻ","બ","బ","ಬ","ബ","𑀩","བ","б"],["භ","भ","bh","ภ","ຠ","ဘ","ភ","ভ","ਭ","ᨽ","ભ","భ","ಭ","ഭ","𑀪","བྷ","бх"],["ම","म","m","ม","ມ","မ","ម","ম","ਮ","ᨾ","મ","మ","ಮ","മ","𑀫","མ","м"],["ය","य","y","ย","ຍ","ယ","យ","য","ਯ","ᨿ","ય","య","ಯ","യ","𑀬","ཡ","й"],["ර","र","r","ร","ຣ","ရ","រ","র","ਰ","ᩁ","ર","ర","ರ","ര","𑀭","ར","р"],["ල","ल","l","ล","ລ","လ","ល","ল","ਲ","ᩃ","લ","ల","ಲ","ല","𑀮","ལ","л"],["ළ","ळ","ḷ","ฬ","ຬ","ဠ","ឡ","ল়","ਲ਼","ᩊ","ળ","ళ","ಳ","ള","𑀴","ལ༹","л̣"],["ව","व","v","ว","ວ","ဝ","វ","ৰ","ਵ","ᩅ","વ","వ","ವ","വ","𑀯","ཝ","в"],["ස","स","s","ส","ສ","သ","ស","স","ਸ","ᩈ","સ","స","ಸ","സ","𑀲","ས","с"],["හ","ह","h","ห","ຫ","ဟ","ហ","হ","ਹ","ᩉ","હ","హ","ಹ","ഹ","𑀳","ཧ","х"]],A=[["ා","ा","ā","า","າ","ာ","ា","া","ਾ","ᩣ","ા","ా","ಾ","ാ","𑀸","ཱ","а̄"],["ි","ि","i","ิ","ິ","ိ","ិ","ি","ਿ","ᩥ","િ","ి","ಿ","ി","𑀺","ི","и"],["ී","ी","ī","ี","ີ","ီ","ី","ী","ੀ","ᩦ","ી","ీ","ೀ","ീ","𑀻","ཱི","ӣ"],["ු","ु","u","ุ","ຸ","ု","ុ","ু","ੁ","ᩩ","ુ","ు","ು","ു","𑀼","ུ","у"],["ූ","ू","ū","ู","ູ","ူ","ូ","ূ","ੂ","ᩪ","ૂ","ూ","ೂ","ൂ","𑀽","ཱུ","ӯ"],["ෙ","े","e","เ","ເ","ေ","េ","ে","ੇ","ᩮ","ે","ే","ೇ","േ","𑁂","ེ","е"],["ො","ो","o","โ","ໂ","ော","ោ","ো","ੋ","ᩮᩣ","ો","ో","ೋ","ോ","𑁄","ོ","о"]];function d(e,r,n){void 0===n&&(n="");var a=e;return"cen"===n?a=a.replace(/॥/g,""):n.startsWith("ga")&&(a=(a=a.replace(/।/g,";")).replace(/॥/g,".")),(a=(a=(a=a.replace(/॰…/g,"…")).replace(/॰/g,"·")).replace(/[।॥]/g,".")).replace(/\s([\s,!;\?\.])/g,"$1")}function y(e,r,n){if(void 0===n&&(n=""),r===p.THAI)return e.replace(/([ก-ฮ])([เโ])/g,"$2$1");if(r===p.LAOS)return e.replace(/([ກ-ຮ])([ເໂ])/g,"$2$1");throw new Error("Unsupported script "+r+" for swap_e_o method.")}function S(e,r){if(r===p.THAI)return e.replace(/([เโ])([ก-ฮ])/g,"$2$1");if(r===p.LAOS)return e.replace(/([ເໂ])([ກ-ຮ])/g,"$2$1");throw new Error("Unsupported script "+r+" for un_swap_e_o method.")}function T(e){return e.replace(/\u200C|\u200D/g,"")}var b=[],I=((t={})[p.SI]=[function(e,r,n){return void 0===n&&(n=""),e.replace(/\u0DCA([\u0DBA\u0DBB])/g,"\u0DCA\u200D$1")},d],t[p.RO]=[d],t[p.THAI]=[y,function(e,r){return e.replace(/\u0E34\u0E4D/g,"ึ").replace(/ญ/g,"").replace(/ฐ/g,"")},d],t[p.LAOS]=[y,d],t[p.MY]=[function(e,r,n){void 0===n&&(n="");return e.replace(/[,;]/g,"၊").replace(/[\u0964\u0965]+/g,"။")/*pnry modified*/.replace(/\./g, '။').replace(/ဉ\u1039ဉ/g,"ည").replace(/သ\u1039သ/g,"ဿ").replace(/င္([က-ဠ])/g,"င်္$1").replace(/္ယ/g,"ျ").replace(/္ရ/g,"ြ").replace(/္ဝ/g,"ွ").replace(/္ဟ/g,"ှ").replace(/([ခဂငဒပဝ]ေ?)\u102c/g,"$1ါ").replace(/(က္ခ|န္ဒ|ပ္ပ|မ္ပ)(ေ?)\u102b/g,"$1$2ာ").replace(/(ဒ္ဓ|ဒွ)(ေ?)\u102c/g,"$1ါ")},d],t[p.KM]=[d],t[p.THAM]=[function(e){return e.replace(/\u1A60\u1A41/g,"ᩕ").replace(/\u1A48\u1A60\u1A48/g,"ᩔ").replace(/।/g,"᪨").replace(/॥/g,"᪩")}],t[p.GUJA]=[d],t[p.TELU]=[d],t[p.MALA]=[d],t[p.BRAH]=[function(e){return e.replace(/।/g,"𑁇").replace(/॥/g,"𑁈").replace(/–/g,"𑁋")},d],t[p.TIBT]=[function(e){var r=e;r=(r=r.replace(/।/g,"།")).replace(/॥/g,"༎");for(var n=0;n<=39;n+=1)r=r.replace(new RegExp(String.fromCharCode(3972,3904+n),"g"),String.fromCharCode(3984+n));return(r=(r=(r=(r=r.replace(/\u0F61\u0FB1/g,"ཡྻ")).replace(/\u0F5D\u0FAD/g,"ཝྺ")).replace(/\u0F5B\u0FAC/g,"ཛ྄ཛྷ")).replace(/\u0F61\u0FB7/g,"ཡ྄ཧ")).replace(/\u0F5D\u0FB7/g,"ཝ྄ཧ")}],t[p.CYRL]=[d],t),L=[],N=((o={})[p.SI]=[T,function(e){return e.replace(/ඒ/g,"එ").replace(/ඕ/g,"ඔ").replace(/ේ/g,"ෙ").replace(/ෝ/g,"ො")}],o[p.HI]=[T],o[p.RO]=[function(e){return e.toLowerCase()}],o[p.THAI]=[function(e,r){return e.replace(/ฎ/g,"ฏ").replace(/\u0E36/g,"ิํ").replace(/\uF70F/g,"ญ").replace(/\uF700/g,"ฐ")},S],o[p.LAOS]=[S],o[p.KM]=[function(e,r){return e.replace(/\u17B9/g,"ិំ").replace(/\u17D1/g,"្")}],o[p.MY]=[function(e){return e.replace(/\u102B/g,"ာ").replace(/ှ/g,"္ဟ").replace(/ွ/g,"္ဝ").replace(/ြ/g,"္ရ").replace(/ျ/g,"္ယ").replace(/\u103A/g,"").replace(/ဿ/g,"သ္သ").replace(/ည/g,"ဉ္ဉ").replace(/သံဃ/g,"သင္ဃ").replace(/၊/g,",").replace(/။/g,".")}],o[p.TIBT]=[function(e){return e}],o);function M(e,r,n){void 0===n&&(n=!0);var a=m.concat(s,n?A:[]),t=[[],[],[]];return a.forEach((function(n){n[e]&&t[n[e].length-1].push([n[e],n[r]])})),t.filter((function(e){return e.length})).map((function(e){return[e[0][0].length,new Map(e)]})).reverse()}function $(e,r){for(var n=[],a=0;a<e.length;){for(var t,o=!1,l=i(r);!(t=l()).done;){var c=t.value,u=c[0],g=c[1],p=e.substr(a,u);if(g.has(p)){n.push(g.get(p)),o=!0,a+=u;break}}o||(n.push(e.charAt(a)),a+=1)}return n.join("")}function B(e,r){var n=r===p.CYRL?"а":"a";return e.replace(new RegExp("([ක-ෆ])([^ා-ෟ්"+n+"])","g"),"$1"+n+"$2").replace(new RegExp("([ක-ෆ])([^ා-ෟ්"+n+"])","g"),"$1"+n+"$2").replace(/([ක-ෆ])$/g,"$1"+n)}var C={අ:"",ආ:"ා",ඉ:"ි",ඊ:"ී",උ:"ු",ඌ:"ූ",එ:"ෙ",ඔ:"ො"};function R(e,r){var n=e;return(n=(n=(n=n.replace(/([ක-ෆ])([^අආඉඊඋඌඑඔ\u0DCA])/g,"$1්$2")).replace(/([ක-ෆ])([^අආඉඊඋඌඑඔ\u0DCA])/g,"$1්$2")).replace(/([ක-ෆ])$/g,"$1්")).replace(/([ක-ෆ])([අආඉඊඋඌඑඔ])/g,(function(e,r,n){return r+C[n]}))}function E(e,r){return $(e,M(v[p.SI],v[r]))}function O(e,r){return $(e,M(v[r],v[p.SI],!1))}var w=[E],F=((l={})[p.SI]=[],l[p.RO]=[B,E],l[p.CYRL]=[B,E],l),H=[function(e,r){return $(e,M(v[r],v[p.SI]))}],x=((c={})[p.SI]=[],c[p.RO]=[O,function(e){return e.replace(/ṁ/g,"ං")},R],c[p.CYRL]=[O,R],c),j=function(){function e(){!function(e,r){if(!(e instanceof r))throw new TypeError("Cannot call a class as a function")}(this,e)}var r,n;return r=e,n=[{key:"basicConvertFromSinh",value:function(e,r){var n=e;return(F[r]||w).forEach((function(e){n=e(n,r)})),n}},{key:"basicConvertToSinh",value:function(e,r){var n=e;return(x[r]||H).forEach((function(e){n=e(n,r)})),n}},{key:"beautify",value:function(e,r,n){void 0===n&&(n="");var a=e;return(I[r]||b).forEach((function(e){a=e(a,r,n)})),a}},{key:"convertFromSinh",value:function(e,r){var n=e;return n=this.basicConvertFromSinh(n,r),this.beautify(n,r)}},{key:"convertToSinh",value:function(e,r){var n=e;return(N[r]||L).forEach((function(e){n=e(n,r)})),this.basicConvertToSinh(n,r)}},{key:"convertAnyToSinh",value:function(e){var r=e;r=T(r)+" ";for(var n=-1,a="",t="",o=0;o<r.length;o+=1){var l=h(r.charCodeAt(o));l!==n||o===r.length-1?(t+=this.convertToSinh(a,n),n=l,a=r.charAt(o)):a+=r.charAt(o)}return t}}],null&&u(r.prototype,null),n&&u(r,n),e}();const k={Script:p,TextProcessor:j,getScriptForCode:h,PaliScriptInfo:f,ScriptIndex:v,convert:function(e,r,n){var a=j.convertToSinh(e,r);return j.convertFromSinh(a,n)},convertAny:function(e,r){var n=j.convertAnyToSinh(e);return j.convertFromSinh(n,r)},getLocaleForScript:function(e){var r;return null==(r=f.get(e))?void 0:r[3].locale},getLocaleNameForScript:function(e){var r;return null==(r=f.get(e))?void 0:r[3].localeName},getSupportedLocales:function(){var e=Object.getOwnPropertyNames(p).map((function(e){var r;return null==(r=f.get(p[e]))?void 0:r[3]}));return new Set(e.map((function(e){return e.locale})))}}}},r={};function n(a){if(r[a])return r[a].exports;var t=r[a]={exports:{}};return e[a](t,t.exports,n),t.exports}return n.d=(e,r)=>{for(var a in r)n.o(r,a)&&!n.o(e,a)&&Object.defineProperty(e,a,{enumerable:!0,get:r[a]})},n.o=(e,r)=>Object.prototype.hasOwnProperty.call(e,r),n(384)})().default})();


export function typeVelthuis(uType) {
  if (!uType) return "";
  /* 2017, updated 20 Dec 2020 */
  return uType
    .replace(/aa/g, "ā")
    .replace(/ii/g, "ī")
    .replace(/uu/g, "ū")
    .replace(/m\.\./g, "ṁ")
    .replace(/\.m/g, "ṃ")
    .replace(/\.n/g, "ṇ")
    .replace(/\.d/g, "ḍ")
    .replace(/ll\./g, "ḹ")
    .replace(/\.l/g, "ḷ")
    .replace(/\.h/g, "ḥ")
    .replace(/\.r/g, "ṛ")
    .replace(/rr\./g, "ṝ")
    .replace(/\.s/g, "ṣ")
    .replace(/"s/g, "ś")
    .replace(/s\.\./g, "ś")
    .replace(/\.t/g, "ṭ")
    .replace(/~n/g, "ñ")
    .replace(/,,n/g, "ñ")
    .replace(/"n/g, "ṅ")
    .replace(/n\.\./g, "ṅ")

    .replace(/AA/g, "Ā")
    .replace(/II/g, "Ī")
    .replace(/UU/g, "Ū")
    .replace(/M\.\./g, "Ṁ")
    .replace(/\.M/g, "Ṃ")
    .replace(/\.N/g, "Ṇ")
    .replace(/\.D/g, "Ḍ")
    .replace(/LL\./g, "Ḹ")
    .replace(/\.L/g, "Ḷ")
    .replace(/\.H/g, "Ḥ")
    .replace(/\.R/g, "Ṛ")
    .replace(/RR\./g, "Ṝ")
    .replace(/\.S/g, "Ṣ")
    .replace(/"S/g, "Ś")
    .replace(/S\.\./g, "Ś")
    .replace(/\.T/g, "Ṭ")
    .replace(/~N/g, "Ñ")
    .replace(/,,N/g, "Ñ")
    .replace(/"N/g, "Ṅ")
    .replace(/N\.\./g, "Ṅ");
}

/**
 * Capitalizes the first Unicode letter of a Pali text/title, skipping leading digits and punctuation.
 * e.g. "añña" -> "Añña", "1. paṇāmagāthā" -> "1. Paṇāmagāthā", "ṭīkā" -> "Ṭīkā"
 */
export function capitalizePali(text) {
  if (!text || typeof text !== 'string') return text || '';
  return text.replace(/^([\s\d\.\-\(\)\[\]\/#:]*)([\p{L}])/u, (_, prefix, firstChar) => {
    return prefix + firstChar.toUpperCase();
  });
}

/**
 * Convert any of the 17 supported scripts or Velthuis input to standard Roman Pāḷi
 */
export function convertAnyToRoman(text) {
  if (!text || typeof text !== 'string') return '';
  let converted = typeVelthuis(text);
  try {
    const isNonLatin = /[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(converted);
    if (isNonLatin) {
      const roman = CVT.convertAny(converted, CVT.Script.RO);
      if (roman && roman.trim()) {
        converted = roman;
      }
    }
  } catch (e) {}
  return converted.replace(/ṁ/g, 'ṃ').replace(/Ṁ/g, 'ṃ');
}

/**
 * Normalizes Pali text by stripping diacritics and converting non-Latin scripts to standard ASCII lowercase.
 * Enables fuzzy / diacritic-insensitive matching.
 * e.g. "Paṭhamakoṭigāmasuttaṃ" -> "pathamakotigamasuttam"
 */
export function normalizePaliForSearch(text) {
  if (!text || typeof text !== 'string') return '';
  
  let s = convertAnyToRoman(text).toLowerCase();

  s = s
    .replace(/[āàáâãä]/g, 'a')
    .replace(/[īìíîï]/g, 'i')
    .replace(/[ūùúûü]/g, 'u')
    .replace(/[ēèéêë]/g, 'e')
    .replace(/[ōòóôö]/g, 'o')
    .replace(/[ṃṁ]/g, 'm')
    .replace(/[ṅñṇ]/g, 'n')
    .replace(/[ṭ]/g, 't')
    .replace(/[ḍ]/g, 'd')
    .replace(/[ḷḹ]/g, 'l')
    .replace(/[ṣś]/g, 's')
    .replace(/[ṛṝ]/g, 'r')
    .replace(/[ḥ]/g, 'h');

  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return s.trim();
}



// Map script aliases to CVT Script enum keys
export const SCRIPT_MAP = {
  roman: "RO",
  ro: "RO",
  latn: "RO",
  latin: "RO",
  devanagari: "HI",
  deva: "HI",
  hi: "HI",
  hindi: "HI",
  myanmar: "MY",
  my: "MY",
  mymr: "MY",
  burmese: "MY",
  sinhala: "SI",
  sinh: "SI",
  si: "SI",
  thai: "THAI",
  th: "THAI",
  laos: "LAOS",
  lao: "LAOS",
  khmer: "KM",
  km: "KM",
  khmr: "KM",
  bengali: "BENG",
  beng: "BENG",
  bn: "BENG",
  gurmukhi: "GURM",
  gurm: "GURM",
  pa: "GURM",
  gujarati: "GUJA",
  guja: "GUJA",
  gu: "GUJA",
  telugu: "TELU",
  telu: "TELU",
  te: "TELU",
  kannada: "KANN",
  kann: "KANN",
  knda: "KANN",
  kn: "KANN",
  malayalam: "MALA",
  mala: "MALA",
  mlym: "MALA",
  ml: "MALA",
  taitham: "THAM",
  tham: "THAM",
  lana: "THAM",
  brahmi: "BRAH",
  brah: "BRAH",
  tibetan: "TIBT",
  tibt: "TIBT",
  bo: "TIBT",
  cyrillic: "CYRL",
  cyrl: "CYRL",
  ru: "CYRL",
};

export const PALI_SCRIPTS_LIST = [
  { id: "roman", label: "Roman Latin", native: "Pāḷi (Roman)", desc: "Standard Roman Latin script with complete diacritics" },
  { id: "devanagari", label: "Devanagari", native: "देवनागरी", desc: "Classical Indian script for Sanskrit & Pali" },
  { id: "myanmar", label: "Myanmar", native: "မြန်မာ", desc: "Chaṭṭha Saṅgāyana Burmese script" },
  { id: "sinhala", label: "Sinhala", native: "සිංහල", desc: "Sri Lankan Buddhist script" },
  { id: "thai", label: "Thai", native: "ไทย", desc: "Siam Royal script" },
  { id: "laos", label: "Lao", native: "ລາວ", desc: "Lao script" },
  { id: "khmer", label: "Khmer", native: "ភាសាខ្មែរ", desc: "Cambodian script" },
  { id: "bengali", label: "Bengali", native: "বাংলা", desc: "Bengali script" },
  { id: "gurmukhi", label: "Gurmukhi", native: "ਗੁਰਮੁਖੀ", desc: "Punjabi script" },
  { id: "gujarati", label: "Gujarati", native: "ગુજરાતી", desc: "Gujarati script" },
  { id: "telugu", label: "Telugu", native: "తెలుగు", desc: "Telugu script" },
  { id: "kannada", label: "Kannada", native: "ಕನ್ನಡ", desc: "Kannada script" },
  { id: "malayalam", label: "Malayalam", native: "മലയാളം", desc: "Malayalam script" },
  { id: "taitham", label: "Tai Tham", native: "ᨲ᩠ᩅᩫᨾᩮᩥᩬᨦ", desc: "Lanna script" },
  { id: "tibetan", label: "Tibetan", native: "བོད་སྐད།", desc: "Tibetan script" },
  { id: "cyrillic", label: "Cyrillic", native: "кириллица", desc: "Cyrillic script" },
  { id: "brahmi", label: "Brahmi", native: "𑀩𑁆𑀭𑀸𑀳𑁆𑀫𑀻", desc: "Ancient Ashokan Brahmi script" },
];

// URL script prefixes → canonical paliScript ids (see PALI_SCRIPTS_LIST above).
// 'ro' (roman) is the default and intentionally omitted.
export const SCRIPT_URL_PREFIXES = {
  si: 'sinhala',
  hi: 'devanagari',
  thai: 'thai',
  laos: 'laos',
  my: 'myanmar',
  km: 'khmer',
  beng: 'bengali',
  gurm: 'gurmukhi',
  tham: 'taitham',
  guja: 'gujarati',
  telu: 'telugu',
  kann: 'kannada',
  mala: 'malayalam',
  brah: 'brahmi',
  tibt: 'tibetan',
  cyrl: 'cyrillic',
};

/**
 * Splits an optional script prefix off a book code.
 * e.g. "si.abh03m10.mul"  -> { scriptId: "sinhala",   prefix: "si",   bookCode: "abh03m10.mul" }
 *      "abh03m10.mul"     -> { scriptId: null,          prefix: null,  bookCode: "abh03m10.mul" }
 * Prefixes are matched case-insensitively; only the 16 non-default script codes
 * (SCRIPT_URL_PREFIXES) are recognized, so real book codes are never affected.
 */
export function splitScriptCode(bookCode) {
  if (!bookCode || typeof bookCode !== 'string') {
    return { scriptId: null, prefix: null, bookCode };
  }
  const match = bookCode.match(/^([a-z]+)\.(.*)$/i);
  if (match) {
    const prefix = match[1].toLowerCase();
    const scriptId = SCRIPT_URL_PREFIXES[prefix];
    if (scriptId) {
      return { scriptId, prefix, bookCode: match[2] };
    }
  }
  return { scriptId: null, prefix: null, bookCode };
}

export function convertPaliScript(text, toScript) {
  if (!text || !toScript) return text;
  const targetKey = SCRIPT_MAP[toScript.toString().toLowerCase()];
  if (!targetKey || targetKey === "RO") return text;
  
  const targetEnum = CVT.Script[targetKey];
  if (!targetEnum) return text;

  try {
    const sinh = CVT.TextProcessor.convertAnyToSinh(text);
    return CVT.TextProcessor.convertFromSinh(sinh, targetEnum);
  } catch (err) {
    console.warn("Transliteration error:", err);
    return text;
  }
}

const htmlTransliterationCache = new Map();
const MAX_HTML_CACHE = 80;

export function transliterateHtml(html, targetScript = "roman") {
  if (!html || !targetScript) return html;
  const targetKey = SCRIPT_MAP[targetScript.toString().toLowerCase()];
  if (!targetKey || targetKey === "RO") return html;

  const cacheKey = `${targetKey}_${html.length}_${html.slice(0, 50)}`;
  const cached = htmlTransliterationCache.get(cacheKey);
  if (cached) return cached;

  // Transliterate only text nodes outside of HTML tags & entities,
  // while preserving <span class="pb" ...>[...]</span> page number indicators completely untouched
  const result = html.replace(
    /(<span\b[^>]*\bclass="[^"]*\bpb\b[^"]*"[^>]*>[\s\S]*?<\/span>|<[^>]*>|&[a-z0-9#]+;)|([^<>&]+)/gi,
    (match, nonTransliterated, textNode) => {
      if (nonTransliterated) return nonTransliterated;
      return convertPaliScript(textNode, targetScript);
    }
  );

  if (htmlTransliterationCache.size >= MAX_HTML_CACHE) {
    const firstKey = htmlTransliterationCache.keys().next().value;
    htmlTransliterationCache.delete(firstKey);
  }
  htmlTransliterationCache.set(cacheKey, result);
  return result;
}

export function highlightHtmlText(
  html,
  query,
  targetScript = "roman",
  targetParaIndex = null,
  targetParaNum = null
) {
  if (!html || !query) return html;
  const rawQ = String(query).trim();
  if (rawQ.length < 2) return html;

  const romanQ = convertAnyToRoman(rawQ).trim();
  const baseTerms = [romanQ, rawQ, ...romanQ.split(/\s+/), ...rawQ.split(/\s+/)].filter(
    (t) => t && t.trim().length >= 2
  );
  const uniqueTerms = Array.from(new Set(baseTerms));

  if (uniqueTerms.length === 0) return html;

  const diacriticMap = {
    'a': '[aāAĀ]', 'ā': '[aāAĀ]',
    'i': '[iīIĪ]', 'ī': '[iīIĪ]',
    'u': '[uūUŪ]', 'ū': '[uūUŪ]',
    'e': '[eE]',
    'o': '[oO]',
    'm': '[mṁṃMṀṂ]', 'ṁ': '[mṁṃMṀṂ]', 'ṃ': '[mṁṃMṀṂ]',
    'n': '[nṅñṇNṄÑṆ]', 'ṅ': '[nṅñṇNṄÑṆ]', 'ñ': '[nṅñṇNṄÑṆ]', 'ṇ': '[nṅñṇNṄÑṆ]',
    't': '[tṭTṬ]', 'ṭ': '[tṭTṬ]',
    'd': '[dḍDḌ]', 'ḍ': '[dḍDḌ]',
    'l': '[lḷLḶ]', 'ḷ': '[lḷLḶ]',
    's': '[sṣśSṢŚ]', 'ṣ': '[sṣśSṢŚ]', 'ś': '[sṣśSṢŚ]',
    'r': '[rṛṝRṚṜ]', 'ṛ': '[rṛṝRṚṜ]', 'ṝ': '[rṛṝRṚṜ]',
    'h': '[hH]', 'k': '[kK]', 'g': '[gG]', 'c': '[cC]', 'j': '[jJ]',
    'p': '[pP]', 'b': '[bB]', 'y': '[yY]', 'v': '[vV]'
  };

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const buildPaliRegex = (term) => {
    if (/[^\u0000-\u024F\u1E00-\u1EFF\s\d\p{P}]/u.test(term)) {
      return escapeRegex(term);
    }
    let regexStr = '';
    for (let i = 0; i < term.length; i++) {
      const char = term[i].toLowerCase();
      if (diacriticMap[char]) {
        regexStr += diacriticMap[char];
      } else {
        regexStr += escapeRegex(term[i]);
      }
    }
    return regexStr;
  };

  const patterns = [];
  for (const term of uniqueTerms) {
    if (!term || term.length < 2) continue;
    if (targetScript && targetScript !== 'roman') {
      const converted = convertPaliScript(term, targetScript);
      if (converted && converted.trim()) {
        patterns.push(escapeRegex(converted.trim()));
      }
      patterns.push(escapeRegex(term));
    } else {
      patterns.push(buildPaliRegex(term));
    }
  }

  if (patterns.length === 0) return html;

  // Sort patterns descending by length
  patterns.sort((a, b) => b.length - a.length);

  const combinedRegex = new RegExp(`(${patterns.join('|')})`, 'gi');

  const highlightTextInside = (innerHtml) => {
    return innerHtml.replace(
      /(<span\b[^>]*\bclass="[^"]*\bpb\b[^"]*"[^>]*>[\s\S]*?<\/span>|<[^>]*>|&[a-z0-9#]+;)|([^<>&]+)/gi,
      (match, nonText, textNode) => {
        if (nonText) return nonText;
        return textNode.replace(combinedRegex, '<mark class="search-hit">$1</mark>');
      }
    );
  };

  // If specific paragraph target is specified (paraIndex or paraNum), highlight ONLY inside that matching paragraph
  const hasParaTarget =
    (targetParaIndex !== undefined && targetParaIndex !== null && targetParaIndex !== '') ||
    (targetParaNum !== undefined && targetParaNum !== null && targetParaNum !== '');

  if (hasParaTarget) {
    const cleanTargetPara = targetParaNum
      ? String(targetParaNum).replace(/^(?:para-?|p)/i, '').trim()
      : null;
    const targetPIndexStr =
      targetParaIndex !== null && targetParaIndex !== undefined
        ? String(targetParaIndex).trim()
        : null;
    const targetInt = cleanTargetPara ? parseInt(cleanTargetPara, 10) : NaN;

    return html.replace(
      /(<p\b[^>]*>)([\s\S]*?)(<\/p>)/gi,
      (fullMatch, openTag, innerContent, closeTag) => {
        let isMatch = false;

        // 1. Check data-pindex or id with pindex
        if (targetPIndexStr) {
          const pindexMatch =
            openTag.match(/data-pindex="([^"]+)"/i) || openTag.match(/id="pindex-([^"]+)"/i);
          if (pindexMatch && pindexMatch[1] === targetPIndexStr) {
            isMatch = true;
          }
        }

        // 2. Check data-para or id with para
        if (!isMatch && cleanTargetPara) {
          const paraMatch =
            openTag.match(/data-para="([^"]+)"/i) || openTag.match(/id="para-?([^"]+)"/i);
          if (paraMatch && paraMatch[1] === cleanTargetPara) {
            isMatch = true;
          }

          // Check ranged para attributes: data-para-first and data-para-last
          if (!isMatch && !isNaN(targetInt)) {
            const firstMatch = openTag.match(/data-para-first="(\d+)"/i);
            const lastMatch = openTag.match(/data-para-last="(\d+)"/i);
            if (firstMatch && lastMatch) {
              const first = parseInt(firstMatch[1], 10);
              const last = parseInt(lastMatch[1], 10);
              if (targetInt >= first && targetInt <= last) {
                isMatch = true;
              }
            }
          }
        }

        if (isMatch) {
          return openTag + highlightTextInside(innerContent) + closeTag;
        }
        return fullMatch;
      }
    );
  }

  // Fallback: If no specific paragraph targeted, highlight text throughout
  return highlightTextInside(html);
}

/**
 * Normalizes and cleans raw copied/pasted Pāḷi text queries for dictionary lookup.
 * Automatically strips quotes (‘‘, ’’, “”, etc.), attached quote particles (e.g. ’’ti, ’ti, ”ti, ’’pi, ’va, etc.),
 * punctuation marks, and non-letter symbols while preserving multi-word tokens and Pāḷi diacritics.
 * 
 * Example: "‘‘Evaṃ, bhante’’ti" -> "Evaṃ bhante ti"
 */
export function cleanDictionaryQuery(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return '';

  // Preserve internal metadata & template payloads (e.g. ##tipitakapalidpdfeedback, ##tipitakapaliversion)
  if (rawInput.trim().startsWith('##')) {
    return rawInput.trim();
  }

  let text = rawInput;

  // 1. Normalize niggahita / anusvara: replace all ṁ / Ṁ with ṃ behind the scenes
  text = text.replace(/ṁ/g, 'ṃ').replace(/Ṁ/g, 'ṃ');

  // 2. Normalize zero-width and unusual unicode spaces
  text = text.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ');

  // 3. Separate attached quotes from trailing enclitics / quote markers (e.g. ’’ti, ’ti, ”ti, ’’pi, ’va, etc.)
  // Handles Roman, Myanmar, Sinhala, and Devanagari attached particles
  text = text.replace(/([’'”"»›]+)(ti|pi|va|eva|iti|api|nti|တိ|ති|ति)\b/gi, ' $2');

  // 3. Replace all quotation marks (curly, straight, double-single, guillemets, CJK quotes, etc.) with spaces
  text = text.replace(/[‘’“”"''`«»‹›„“”「」『』]/g, ' ');

  // 4. Replace punctuation & symbols (commas, periods, semicolons, colons, dashes, brackets, ellipsis, etc.)
  // Note: Handles standard ASCII, Indic (၊, ။), and CJK punctuation (，。！？；：（）【】《》、·)
  text = text.replace(/[.,;:!?…—–\-_/\\()\[\]{}|<>+=*&^%$#@~§`၊။，。！？；：（）【】《》、·]/g, ' ');

  // 5. Clean leading root symbols e.g. √
  text = text.replace(/^[√\s\d.-]+/, ' ');

  // 6. Collapse multiple consecutive whitespaces into a single space and trim
  return text.replace(/\s+/g, ' ').trim();
}

export { CVT };

