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
  noSources: "This answer has no source. Treat it with care.",
  closestSource: "Closest source found. Shamwari could not write a full answer just now.",
  footer: "Answered by Shamwari Cloud (a routed model). This is not legal advice.",
  scopePersonalTitle: "Questions about you need Shamwari Mind",
  scopePersonalBody: "Your own information stays on your phone and is never sent to a cloud service. Shamwari Mind, the part that runs on your device and can answer about you, is not available yet. Until then you can ask general questions.",
  authDevClear: "Remove key",
  reviewNote: "This language is a draft and still needs review by a native speaker.",
  tagline: "Ask a question. Get the answer with the section it came from.",
  cloudNotice: "Questions you type here are answered in the cloud. Personal questions need Shamwari Mind on your own device, which is not available yet, so please keep private details out of what you ask.",
  savedRetry: "Your question is saved and will be sent again automatically.",
  authMukoko: "Sign in with Mukoko",
  signOut: "Sign out",
  authDevTitle: "Developer key (testing only)",
  signedOutCleared: "Signed out. Your chats were removed from this device.",
  signedIn: "You are signed in.",
  signInFailed: "Sign-in did not finish. Please try again.",
  wipeFailed: "Signed out, but this phone could not clear everything. Restart the app before handing the phone to anyone else.",
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
  waiting: "waiting",
  tooLong: "That question is too long to send. Please shorten it a little.",
  queueFull: "Too many questions waiting. Go online to send them first.",
  shortened: "Shortened to fit.",
  keySaved: "A key is saved. Leave this empty to keep it.",
  noKeyYet: "No key saved yet.",
  keyPlaceholder: "Shamwari key",
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
  noSources: "Mhinduro iyi haina chinobva. Chenjerera.",
  closestSource: "Chinyorwa chiri padyo chaicho. Shamwari haina kukwanisa kunyora mhinduro yakazara parizvino.",
  footer: "Yakapindurwa neShamwari Cloud (modhi inotumirwa). Iyi haisi nhungamiro yemutemo.",
  scopePersonalTitle: "Mibvunzo inobata imi pachenyu inoda Shamwari Mind",
  scopePersonalBody: "Ruzivo rwenyu pachenyu runogara pafoni yenyu uye harutumirwi kune cloud. Shamwari Mind, inoshanda pafoni yenyu uye inogona kupindura nezvenyu, haisati yavepo. Panguva ino munogona kubvunza mibvunzo yakajairika.",
  authDevClear: "Bvisa key",
  reviewNote: "Mutauro uyu ndewekuyedza uye unoda kuongororwa nemutauri wepamusoro.",
  tagline: "Bvunza mubvunzo. Tora mhinduro pamwe chete nechikamu chainobva.",
  cloudNotice: "Mibvunzo yamunonyora pano inopindurwa pa cloud. Mibvunzo inobata imi pachenyu inoda Shamwari Mind pafoni yenyu, iyo isati yavepo, saka musanyore zvakavanzika mumibvunzo yenyu.",
  savedRetry: "Mubvunzo wenyu wachengetwa uye uchatumirwa zvakare pachawo.",
  authMukoko: "Pinda neMukoko",
  signOut: "Buda",
  authDevTitle: "Developer key (yekuyedza chete)",
  signedOutCleared: "Mabuda. Hurukuro dzenyu dzabviswa pafoni iyi.",
  signedIn: "Mapinda.",
  signInFailed: "Hatina kukwanisa kupedza kupinda. Edzai zvakare.",
  wipeFailed: "Mabuda, asi foni iyi haina kukwanisa kubvisa zvose. Vhurai app zvakare musati mapa munhu mumwe foni.",
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
  waiting: "inomirira",
  tooLong: "Mubvunzo uyu murefu zvakanyanya kutumirwa. Ipfupisei zvishoma.",
  queueFull: "Mibvunzo yakawandisa inomirira. Tanga mutumira iyo network yadzoka.",
  shortened: "Yapfupiswa kuti ikwane.",
  keySaved: "Key yachengetwa. Siyai pasina chinhu kuti irambe iripo.",
  noKeyYet: "Hapana key yakachengetwa.",
  keyPlaceholder: "Shamwari key",
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
  noSources: "Le mpendulo ayilamthombo. Qaphela.",
  closestSource: "Umthombo ongaphezu kokunye. UShamwari akakwazanga ukubhala impendulo egcwele khathesi.",
  footer: "Iphendulwe nguShamwari Cloud (imodeli ethunyelwayo). Lokhu akusikho ukweluleka ngomthetho.",
  scopePersonalTitle: "Imibuzo ngawe uqobo idinga uShamwari Mind",
  scopePersonalBody: "Ulwazi lwakho uqobo luhlala kufoni yakho kanti alutshunyelwa kwi-cloud. UShamwari Mind, osebenza kufoni yakho futhi ongaphendula ngawe, akakabi khona. Okwamanje ungabuza imibuzo ejwayelekileyo.",
  authDevClear: "Susa i-key",
  reviewNote: "Lolu limi lungolokuhlola futhi ludinga ukubukezwa ngumuntu okhuluma ulimi.",
  tagline: "Buza umbuzo. Thola impendulo kanye lesigaba esivela kuso.",
  cloudNotice: "Imibuzo oyibhala lapha iphendulwa kwi-cloud. Imibuzo ngawe uqobo idinga uShamwari Mind kufoni yakho, engakabi khona, ngakho ungabhali ulwazi oluyimfihlo emibuzweni yakho.",
  savedRetry: "Umbuzo wakho ugciniwe njalo uzathunyelwa futhi ngokwawo.",
  authMukoko: "Ngena ngeMukoko",
  signOut: "Phuma",
  authDevTitle: "Developer key (ukuhlola kuphela)",
  signedOutCleared: "Usuphumile. Ingxoxo zakho zisusiwe kulefoni.",
  signedIn: "Usungenile.",
  signInFailed: "Asikwazanga ukuqeda ukungena. Zama futhi.",
  wipeFailed: "Usuphumile, kodwa le foni ayikwazanga ukususa konke. Qalisa i-app futhi ungakayinikeli omunye umuntu.",
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
  waiting: "ilindile",
  tooLong: "Lo mbuzo mude kakhulu ukuthunyelwa. Wufinyeze kancane.",
  queueFull: "Imibuzo eminengi ilindile. Thumela ngemva kokuthi i-network ibuyile.",
  shortened: "Kufinyezwe ukuze kulingane.",
  keySaved: "I-key igciniwe. Yeka kungelalutho ukuze ihlale.",
  noKeyYet: "Akukho key egciniweyo.",
  keyPlaceholder: "Shamwari key",
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
