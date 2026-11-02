/**
 * UI strings for the app, in English, Shona and Ndebele.
 *
 * Most wording is copied from the web chat (`site/src/chat/strings.ts`) so the
 * two surfaces say the same thing; the keys below that the web chat does not
 * have (appName .. save) are new drafts. Shona and Ndebele are DRAFTS: written
 * to be understood, not yet reviewed by a native speaker, and the app says so
 * on screen whenever either is selected (`needsNativeReview`). Never clear that
 * flag until a named reviewer has signed the language off.
 */
import type { Language } from '../lib/types';

export const en = {
  placeholder: "Ask about law or tax",
  send: "Send",
  language: "Language",
  settings: "Settings",
  sources: "Sources",
  effective: "In effect from",
  openSource: "Open source",
  noSources: "This answer has no source. Treat it with care.",
  closestSource: "Closest source found. Shamwari could not write a full answer just now.",
  footer: "Answered by Shamwari Cloud (a routed model). This is not legal advice.",
  scopePersonalTitle: "Questions about you need Shamwari Mind",
  scopePersonalBody: "Your own information stays on your phone and is never sent to a cloud service. Shamwari Mind, the part that runs on your device and can answer about you, is not available yet. Until then you can ask general questions.",
  offlineQueued: "No connection. Your question is saved and will be sent when you are back online.",
  queued: "Waiting to send",
  authDevHelp: "Paste a Shamwari API key. It is kept on this device only and is sent only to the Shamwari API. Do not use this on a shared phone.",
  authDevSave: "Use this key",
  authDevClear: "Remove key",
  reviewNote: "This language is a draft and still needs review by a native speaker.",
  tryAsking: "Try asking",
  example1: "What does the Constitution say about equality?",
  example2: "What are my rights if I am arrested?",
  example3: "Who must pay income tax in Zimbabwe?",
  tagline: "Ask a question. Get the answer with the section it came from.",
  thinking: "Shamwari is looking for the answer…",
  slow: "Still working. The network is slow, so this can take a while.",
  retry: "Try again",
  errors: {
    unauthorized: "Your key was not accepted. Check it, or sign in again.",
    payment_required: "Your plan has run out. Add credit to keep asking.",
    forbidden_scope: "This key is not allowed to ask that kind of question.",
    rate_limited: "You have reached your limit for now. Try again later.",
    unavailable: "Shamwari is having trouble right now. Your question was not lost; try again in a moment.",
    busy: "Shamwari is still answering this question. Please wait a moment.",
    offline: "The answer did not arrive. Check your connection and try again.",
    bad_request: "Shamwari could not read that question. Try rewording it.",
    unknown: "Something went wrong. Please try again.",
  },
  appName: "Shamwari",
  waiting: "waiting",
  tooLong: "That question is too long to send. Please shorten it a little.",
  queueFull: "Too many questions waiting. Go online to send them first.",
  shortened: "Shortened to fit.",
  keySaved: "A key is saved. Leave this empty to keep it.",
  noKeyYet: "No key saved yet.",
  keyPlaceholder: "Shamwari key",
  signInSoon: "Sign-in is coming. Until then, paste your Shamwari key. It stays in your phone's secure store.",
  readFailed: "Could not read your saved key or questions. Add your key in Settings to continue.",
  saveKeyFailed: "Could not save your key on this phone.",
  saveQueueFailed: "Your phone could not save your waiting questions. Keep the app open until they are sent.",
  save: "Save",
} as const;

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Strings = Widen<typeof en>;

/** DRAFT. Needs native review before it is presented as verified. */
export const sn: Strings = {
  placeholder: "Bvunza nezvemutemo kana mutero",
  send: "Tumira",
  language: "Mutauro",
  settings: "Zvirongwa",
  sources: "Zvinobva",
  effective: "Zvinoshanda kubva",
  openSource: "Vhura chinobva",
  noSources: "Mhinduro iyi haina chinobva. Chenjerera.",
  closestSource: "Chinyorwa chiri padyo chaicho. Shamwari haina kukwanisa kunyora mhinduro yakazara parizvino.",
  footer: "Yakapindurwa neShamwari Cloud (modhi inotumirwa). Iyi haisi nhungamiro yemutemo.",
  scopePersonalTitle: "Mibvunzo inobata imi pachenyu inoda Shamwari Mind",
  scopePersonalBody: "Ruzivo rwenyu pachenyu runogara pafoni yenyu uye harutumirwi kune cloud. Shamwari Mind, inoshanda pafoni yenyu uye inogona kupindura nezvenyu, haisati yavepo. Panguva ino munogona kubvunza mibvunzo yakawandisa.",
  offlineQueued: "Hapana network. Mubvunzo wenyu wachengetwa uye uchatumirwa kana network yadzoka.",
  queued: "Iri kumirira kutumirwa",
  authDevHelp: "Namatidzai Shamwari API key. Inochengetwa pafoni iyi chete uye inotumirwa kuShamwari API chete. Musashandise pafoni inoshandiswa nevamwe.",
  authDevSave: "Shandisa key iyi",
  authDevClear: "Bvisa key",
  reviewNote: "Mutauro uyu ndewekuyedza uye unoda kuongororwa nemutauri wepamusoro.",
  tryAsking: "Edzai kubvunza",
  example1: "Bumbiro remitemo rinotii chii pamusoro pekuenzana?",
  example2: "Kodzero dzangu dziri dzipi kana ndabatwa?",
  example3: "Ndiani anofanira kubhadhara mutero wemari inopinza muZimbabwe?",
  tagline: "Bvunza mubvunzo. Tora mhinduro pamwe chete nechikamu chainobva.",
  thinking: "Shamwari iri kutsvaga mhinduro…",
  slow: "Ichiri kushanda. Network inononoka, saka zvinogona kutora nguva.",
  retry: "Edza zvakare",
  errors: {
    unauthorized: "Key yenyu haina kugamuchirwa. Tarisai, kana mupinde zvakare.",
    payment_required: "Chirongwa chenyu chapera. Wedzerai mari kuti mupfuurire kubvunza.",
    forbidden_scope: "Key iyi haibvumirwi kubvunza mubvunzo wakadaro.",
    rate_limited: "Mapedza muganhu wenyu parizvino. Edzai zvakare gare gare.",
    unavailable: "Shamwari ine dambudziko parizvino. Mubvunzo wenyu hauna kurasika; edzai zvakare kanguva.",
    busy: "Shamwari ichiri kupindura mubvunzo uyu. Mirai kanguva.",
    offline: "Mhinduro haina kusvika. Tarisai network yenyu mudzokorore.",
    bad_request: "Shamwari haina kukwanisa kuverenga mubvunzo uyu. Edzai kuutaura nenzira yakasiyana.",
    unknown: "Pane chakaipa. Edzai zvakare.",
  },
  appName: "Shamwari",
  waiting: "inomirira",
  tooLong: "Mubvunzo uyu murefu zvakanyanya kutumirwa. Ipfupisei zvishoma.",
  queueFull: "Mibvunzo yakawandisa inomirira. Tanga mutumira iyo network yadzoka.",
  shortened: "Yapfupiswa kuti ikwane.",
  keySaved: "Key yachengetwa. Siyai pasina chinhu kuti irambe iripo.",
  noKeyYet: "Hapana key yakachengetwa.",
  keyPlaceholder: "Shamwari key",
  signInSoon: "Kupinda kuri kuuya. Panguva ino, namatidzai Shamwari key yenyu. Inochengetwa mubhokisi rakachengeteka refoni yenyu.",
  readFailed: "Hatina kukwanisa kuverenga key kana mibvunzo yakachengetwa. Wedzerai key yenyu muZvirongwa kuti mupfuurire.",
  saveKeyFailed: "Foni iyi haina kukwanisa kuchengeta key yenyu.",
  saveQueueFailed: "Foni yenyu haina kukwanisa kuchengeta mibvunzo inomirira. Rambai app yakavhurika kusvika yatumirwa.",
  save: "Chengeta",
};

/** DRAFT. Needs native review before it is presented as verified. */
export const nd: Strings = {
  placeholder: "Buza ngomthetho loba intela",
  send: "Thumela",
  language: "Ulimi",
  settings: "Izilungiso",
  sources: "Imithombo",
  effective: "Kusebenza kusukela",
  openSource: "Vula umthombo",
  noSources: "Le mpendulo ayilamthombo. Qaphela.",
  closestSource: "Umthombo ongaphezu kokunye. UShamwari akakwazanga ukubhala impendulo egcwele khathesi.",
  footer: "Iphendulwe nguShamwari Cloud (imodeli ethunyelwayo). Lokhu akusikho ukweluleka ngomthetho.",
  scopePersonalTitle: "Imibuzo ngawe uqobo idinga uShamwari Mind",
  scopePersonalBody: "Ulwazi lwakho uqobo luhlala kufoni yakho kanti alutshunyelwa kwi-cloud. UShamwari Mind, osebenza kufoni yakho futhi ongaphendula ngawe, akakabi khona. Okwamanje ungabuza imibuzo ejwayelekileyo.",
  offlineQueued: "Alikho i-network. Umbuzo wakho ugciniwe njalo uzathunyelwa nxa i-network ibuya.",
  queued: "Kulindele ukuthunyelwa",
  authDevHelp: "Namathelisa Shamwari API key. Igcinwa kulefoni kuphela njalo ithunyelwa kuShamwari API kuphela. Ungasebenzisi efonini yabanye bayasebenzisa.",
  authDevSave: "Sebenzisa le key",
  authDevClear: "Susa i-key",
  reviewNote: "Lolu limi lungolokuhlola futhi ludinga ukubukezwa ngumuntu okhuluma ulimi.",
  tryAsking: "Zama ukubuza",
  example1: "ISimiso sithini ngokulinganisana?",
  example2: "Amalungelo ami ayini nxa ngiboshiwe?",
  example3: "Ngubani okumele akhokhe intela yemali engenayo eZimbabwe?",
  tagline: "Buza umbuzo. Thola impendulo kanye lesigaba esivela kuso.",
  thinking: "UShamwari uyadinga impendulo…",
  slow: "Kusasebenza. I-network ihamba kancane, ngakho kungathatha isikhathi.",
  retry: "Zama futhi",
  errors: {
    unauthorized: "I-key yakho ayamukelwanga. Hlola, loba ungene futhi.",
    payment_required: "Uhlelo lwakho seluphelile. Engeza imali ukuze uqhubeke ubuza.",
    forbidden_scope: "Le key ayivunyelwe ukubuza umbuzo onje.",
    rate_limited: "Ufinyelele umkhawulo wakho okwamanje. Zama futhi kamuva.",
    unavailable: "UShamwari unenkinga khathesi. Umbuzo wakho awulahlekanga; zama futhi emumva kwesikhatshana.",
    busy: "UShamwari usaphendula lo mbuzo. Linda isikhatshana.",
    offline: "Impendulo ayifikanga. Hlola i-network yakho uzame futhi.",
    bad_request: "UShamwari akakwazanga ukufunda lo mbuzo. Zama ukuwubuza ngenye indlela.",
    unknown: "Kukhona okungasebenzanga kuhle. Zama futhi.",
  },
  appName: "Shamwari",
  waiting: "ilindile",
  tooLong: "Lo mbuzo mude kakhulu ukuthunyelwa. Wufinyeze kancane.",
  queueFull: "Imibuzo eminengi ilindile. Thumela ngemva kokuthi i-network ibuyile.",
  shortened: "Kufinyezwe ukuze kulingane.",
  keySaved: "I-key igciniwe. Yeka kungelalutho ukuze ihlale.",
  noKeyYet: "Akukho key egciniweyo.",
  keyPlaceholder: "Shamwari key",
  signInSoon: "Ukungena kuyeza. Okwamanje, namathelisa Shamwari key yakho. Igcinwa endaweni evikelekileyo yefoni yakho.",
  readFailed: "Asikwazanga ukufunda i-key loba imibuzo egciniweyo. Engeza i-key yakho kuZilungiso ukuze uqhubeke.",
  saveKeyFailed: "Le foni ayikwazanga ukugcina i-key yakho.",
  saveQueueFailed: "Ifoni yakho ayikwazanga ukugcina imibuzo elindile. Gcina i-app ivuliwe kuze kuthunyelwe.",
  save: "Gcina",
};

export const LANGUAGES: Record<Language, { label: string; strings: Strings; needsNativeReview: boolean }> = {
  en: { label: 'English', strings: en, needsNativeReview: false },
  sn: { label: 'ChiShona', strings: sn, needsNativeReview: true },
  nd: { label: 'isiNdebele', strings: nd, needsNativeReview: true },
};

export const isLanguage = (v: unknown): v is Language => v === 'en' || v === 'sn' || v === 'nd';

/** First supported language in the phone's preference list, else English. */
export function pickLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLanguage(base)) return base;
    if (base === 'nr' || base === 'nbl') return 'nd';
  }
  return 'en';
}
