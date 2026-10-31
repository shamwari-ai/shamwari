/**
 * UI strings. The repo has no i18n framework: gateway/src/channels/channel.ts
 * keeps its messages as one typed object, and this does the same, per language.
 *
 * English is the source of truth and the type. Shona and Ndebele are DRAFTS:
 * written to be understood, not yet reviewed by a native speaker, and the UI
 * says so on screen whenever either is selected (`needsNativeReview`). Never
 * remove that flag for a language until a named reviewer has signed it off.
 */
import type { Language } from './types';

export const en = {
  appName: 'Shamwari Chat',
  skipToQuestion: 'Skip to the question box',
  tagline: 'Ask a question. Get the answer with the section it came from.',
  placeholder: 'Ask about law or tax',
  send: 'Send',
  newChat: 'New chat',
  deleteHistory: 'Delete history',
  deleteConfirm: 'Delete every chat saved on this device? This cannot be undone.',
  deleted: 'History deleted from this device.',
  language: 'Language',
  thinking: 'Shamwari is looking for the answer…',
  slow: 'Still working. The network is slow, so this can take a while.',
  you: 'You',
  shamwari: 'Shamwari',
  sources: 'Sources',
  ground: 'Ground',
  groundHint: 'Taken from a cited source, not guessed.',
  effective: 'In effect from',
  openSource: 'Open source',
  noSources: 'This answer has no source. Treat it with care.',
  closestSource: 'Closest source found. Shamwari could not write a full answer just now.',
  footer: 'Answered by Shamwari Cloud (a routed model). This is not legal advice.',
  storedHere: 'Your chat history is saved on this device only. Shamwari keeps a record of each question it answers, to run the service.',
  earlierChats: 'Earlier chats',
  tryAsking: 'Try asking',
  example1: 'What does the Constitution say about equality?',
  example2: 'What are my rights if I am arrested?',
  example3: 'Who must pay income tax in Zimbabwe?',
  settings: 'Settings',
  storageFailed: 'This device could not save your chat. It will be lost when you close this tab.',
  askRegion: 'Ask a question',
  install: 'Install app',
  scopeLabel: 'Asking about',
  scope: {
    platform: 'General knowledge',
    community: 'Community knowledge',
    personal: 'My own information',
  },
  scopePersonalTitle: 'Questions about you need Shamwari Mind',
  scopePersonalBody:
    'Your own information stays on your phone and is never sent to a cloud service. Shamwari Mind, the part that runs on your device and can answer about you, is not available yet. Until then you can ask general questions.',
  scopePersonalAction: 'Ask a general question instead',
  offlineQueued: 'No connection. Your question is saved and will be sent when you are back online.',
  offlineBanner: 'You are offline. You can still write questions; they will be sent later.',
  queued: 'Waiting to send',
  sendNow: 'Send now',
  discard: 'Discard',
  authTitle: 'Sign in to ask',
  authMukoko: 'Sign in with Mukoko',
  authMukokoSoon: 'Mukoko sign-in is coming. For now, use a developer key.',
  authDevTitle: 'Developer key (testing only)',
  authDevHelp:
    'Paste a Shamwari API key. It is kept on this device only and is sent only to the Shamwari API. Do not use this on a shared phone.',
  authDevSave: 'Use this key',
  authDevClear: 'Remove key',
  authKeyBad: 'That does not look like a Shamwari key. It starts with sk_shamwari_.',
  reviewNote: 'This language is a draft and still needs review by a native speaker.',
  errors: {
    unauthorized: 'Your key was not accepted. Check it, or sign in again.',
    payment_required: 'Your plan has run out. Add credit to keep asking.',
    forbidden_scope: 'This key is not allowed to ask that kind of question.',
    rate_limited: 'You have reached your limit for now. Try again later.',
    unavailable: 'Shamwari is having trouble right now. Your question was not lost; try again in a moment.',
    busy: 'Shamwari is still answering this question. Please wait a moment.',
    offline: 'The answer did not arrive. Check your connection and try again.',
    bad_request: 'Shamwari could not read that question. Try rewording it.',
    unknown: 'Something went wrong. Please try again.',
  },
  retry: 'Try again',
  upgrade: 'Add credit',
  retryIn: 'Try again in',
  seconds: 'seconds',
} as const;

type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type Strings = Widen<typeof en>;

/** DRAFT. Needs native review before it is presented as verified. */
export const sn: Strings = {
  appName: 'Shamwari Chat',
  skipToQuestion: 'Enda kubhokisi remibvunzo',
  tagline: 'Bvunza mubvunzo. Tora mhinduro pamwe chete nechikamu chainobva.',
  placeholder: 'Bvunza nezvemutemo kana mutero',
  send: 'Tumira',
  newChat: 'Hurukuro itsva',
  deleteHistory: 'Bvisa nhoroondo',
  deleteConfirm: 'Bvisa hurukuro dzose dzakachengetwa pafoni iyi here? Hazvidzoreki.',
  deleted: 'Nhoroondo yabviswa pafoni iyi.',
  language: 'Mutauro',
  thinking: 'Shamwari iri kutsvaga mhinduro…',
  slow: 'Ichiri kushanda. Network inononoka, saka zvinogona kutora nguva.',
  you: 'Imi',
  shamwari: 'Shamwari',
  sources: 'Zvinobva',
  ground: 'Ground',
  groundHint: 'Zvakatorwa pachinyorwa chinonzi chakabva, hazvina kufungidzirwa.',
  effective: 'Zvinoshanda kubva',
  openSource: 'Vhura chinobva',
  noSources: 'Mhinduro iyi haina chinobva. Chenjerera.',
  closestSource: 'Chinyorwa chiri padyo chaicho. Shamwari haina kukwanisa kunyora mhinduro yakazara parizvino.',
  footer: 'Yakapindurwa neShamwari Cloud (modhi inotumirwa). Iyi haisi nhungamiro yemutemo.',
  storedHere: 'Nhoroondo yehurukuro dzenyu inochengetwa pafoni iyi chete. Shamwari inochengeta chinyorwa chemubvunzo wega wega waipindura, kuti iite basa rayo.',
  earlierChats: 'Hurukuro dzakare',
  tryAsking: 'Edzai kubvunza',
  example1: 'Bumbiro remitemo rinotii chii pamusoro pekuenzana?',
  example2: 'Kodzero dzangu dziri dzipi kana ndabatwa?',
  example3: 'Ndiani anofanira kubhadhara mutero wemari inopinza muZimbabwe?',
  settings: 'Zvirongwa',
  storageFailed: 'Foni iyi haina kukwanisa kuchengeta hurukuro yenyu. Icharasika kana mavhara tab iyi.',
  askRegion: 'Bvunza mubvunzo',
  install: 'Isa app',
  scopeLabel: 'Mubvunzo wekuti',
  scope: {
    platform: 'Ruzivo rwakawandisa',
    community: 'Ruzivo rwenharaunda',
    personal: 'Ruzivo rwangu pachangu',
  },
  scopePersonalTitle: 'Mibvunzo inobata imi pachenyu inoda Shamwari Mind',
  scopePersonalBody:
    'Ruzivo rwenyu pachenyu runogara pafoni yenyu uye harutumirwi kune cloud. Shamwari Mind, inoshanda pafoni yenyu uye inogona kupindura nezvenyu, haisati yavepo. Panguva ino munogona kubvunza mibvunzo yakawandisa.',
  scopePersonalAction: 'Bvunza mubvunzo wakawandisa panzvimbo',
  offlineQueued: 'Hapana network. Mubvunzo wenyu wachengetwa uye uchatumirwa kana network yadzoka.',
  offlineBanner: 'Hamuna network. Munogona kunyorabe mibvunzo; ichatumirwa gare gare.',
  queued: 'Iri kumirira kutumirwa',
  sendNow: 'Tumira zvino',
  discard: 'Bvisa',
  authTitle: 'Pinda kuti ubvunze',
  authMukoko: 'Pinda neMukoko',
  authMukokoSoon: 'Kupinda neMukoko kuri kuuya. Panguva ino shandisai developer key.',
  authDevTitle: 'Developer key (yekuyedza chete)',
  authDevHelp:
    'Namatidzai Shamwari API key. Inochengetwa pafoni iyi chete uye inotumirwa kuShamwari API chete. Musashandise pafoni inoshandiswa nevamwe.',
  authDevSave: 'Shandisa key iyi',
  authDevClear: 'Bvisa key',
  authKeyBad: 'Iyi haitaridzike seShamwari key. Inotanga ne sk_shamwari_.',
  reviewNote: 'Mutauro uyu ndewekuyedza uye unoda kuongororwa nemutauri wepamusoro.',
  errors: {
    unauthorized: 'Key yenyu haina kugamuchirwa. Tarisai, kana mupinde zvakare.',
    payment_required: 'Chirongwa chenyu chapera. Wedzerai mari kuti mupfuurire kubvunza.',
    forbidden_scope: 'Key iyi haibvumirwi kubvunza mubvunzo wakadaro.',
    rate_limited: 'Mapedza muganhu wenyu parizvino. Edzai zvakare gare gare.',
    unavailable: 'Shamwari ine dambudziko parizvino. Mubvunzo wenyu hauna kurasika; edzai zvakare kanguva.',
    busy: 'Shamwari ichiri kupindura mubvunzo uyu. Mirai kanguva.',
    offline: 'Mhinduro haina kusvika. Tarisai network yenyu mudzokorore.',
    bad_request: 'Shamwari haina kukwanisa kuverenga mubvunzo uyu. Edzai kuutaura nenzira yakasiyana.',
    unknown: 'Pane chakaipa. Edzai zvakare.',
  },
  retry: 'Edza zvakare',
  upgrade: 'Wedzera mari',
  retryIn: 'Edza zvakare mushure me',
  seconds: 'masekonzi',
};

/** DRAFT. Needs native review before it is presented as verified. */
export const nd: Strings = {
  appName: 'Shamwari Chat',
  skipToQuestion: 'Qhubekela ebhokisini lemibuzo',
  tagline: 'Buza umbuzo. Thola impendulo kanye lesigaba esivela kuso.',
  placeholder: 'Buza ngomthetho loba intela',
  send: 'Thumela',
  newChat: 'Ingxoxo entsha',
  deleteHistory: 'Susa umlando',
  deleteConfirm: 'Susa zonke ingxoxo ezigcinwe kulefoni yini? Akukho ukubuyisela.',
  deleted: 'Umlando ususiwe kulefoni.',
  language: 'Ulimi',
  thinking: 'UShamwari uyadinga impendulo…',
  slow: 'Kusasebenza. I-network ihamba kancane, ngakho kungathatha isikhathi.',
  you: 'Wena',
  shamwari: 'Shamwari',
  sources: 'Imithombo',
  ground: 'Ground',
  groundHint: 'Kuthathwe emthonjeni obizwa ngegama, hakuqanjiwe.',
  effective: 'Kusebenza kusukela',
  openSource: 'Vula umthombo',
  noSources: 'Le mpendulo ayilamthombo. Qaphela.',
  closestSource: 'Umthombo ongaphezu kokunye. UShamwari akakwazanga ukubhala impendulo egcwele khathesi.',
  footer: 'Iphendulwe nguShamwari Cloud (imodeli ethunyelwayo). Lokhu akusikho ukweluleka ngomthetho.',
  storedHere: 'Umlando wengxoxo zakho ugcinwa kulefoni kuphela. UShamwari ugcina irekhodi lombuzo ngamunye aphendula wona, ukuze asebenzise inkonzo.',
  earlierChats: 'Ingxoxo zakuqala',
  tryAsking: 'Zama ukubuza',
  example1: 'ISimiso sithini ngokulinganisana?',
  example2: 'Amalungelo ami ayini nxa ngiboshiwe?',
  example3: 'Ngubani okumele akhokhe intela yemali engenayo eZimbabwe?',
  settings: 'Izilungiso',
  storageFailed: 'Le foni ayikwazanga ukugcina ingxoxo yakho. Izolahleka nxa uvala le tab.',
  askRegion: 'Buza umbuzo',
  install: 'Faka i-app',
  scopeLabel: 'Umbuzo ngokuthi',
  scope: {
    platform: 'Ulwazi olujwayelekileyo',
    community: 'Ulwazi lomphakathi',
    personal: 'Ulwazi lwami uqobo',
  },
  scopePersonalTitle: 'Imibuzo ngawe uqobo idinga uShamwari Mind',
  scopePersonalBody:
    'Ulwazi lwakho uqobo luhlala kufoni yakho kanti alutshunyelwa kwi-cloud. UShamwari Mind, osebenza kufoni yakho futhi ongaphendula ngawe, akakabi khona. Okwamanje ungabuza imibuzo ejwayelekileyo.',
  scopePersonalAction: 'Buza umbuzo ojwayelekileyo esikhundleni',
  offlineQueued: 'Alikho i-network. Umbuzo wakho ugciniwe njalo uzathunyelwa nxa i-network ibuya.',
  offlineBanner: 'Awulayo i-network. Ungabhala imibuzo; izathunyelwa kamuva.',
  queued: 'Kulindele ukuthunyelwa',
  sendNow: 'Thumela khathesi',
  discard: 'Susa',
  authTitle: 'Ngena ukuze ubuze',
  authMukoko: 'Ngena ngeMukoko',
  authMukokoSoon: 'Ukungena ngeMukoko kuyeza. Okwamanje sebenzisa developer key.',
  authDevTitle: 'Developer key (ukuhlola kuphela)',
  authDevHelp:
    'Namathelisa Shamwari API key. Igcinwa kulefoni kuphela njalo ithunyelwa kuShamwari API kuphela. Ungasebenzisi efonini yabanye bayasebenzisa.',
  authDevSave: 'Sebenzisa le key',
  authDevClear: 'Susa i-key',
  authKeyBad: 'Lokhu akuvumelani leShamwari key. Iqala nge sk_shamwari_.',
  reviewNote: 'Lolu limi lungolokuhlola futhi ludinga ukubukezwa ngumuntu okhuluma ulimi.',
  errors: {
    unauthorized: 'I-key yakho ayamukelwanga. Hlola, loba ungene futhi.',
    payment_required: 'Uhlelo lwakho seluphelile. Engeza imali ukuze uqhubeke ubuza.',
    forbidden_scope: 'Le key ayivunyelwe ukubuza umbuzo onje.',
    rate_limited: 'Ufinyelele umkhawulo wakho okwamanje. Zama futhi kamuva.',
    unavailable: 'UShamwari unenkinga khathesi. Umbuzo wakho awulahlekanga; zama futhi emumva kwesikhatshana.',
    busy: 'UShamwari usaphendula lo mbuzo. Linda isikhatshana.',
    offline: 'Impendulo ayifikanga. Hlola i-network yakho uzame futhi.',
    bad_request: 'UShamwari akakwazanga ukufunda lo mbuzo. Zama ukuwubuza ngenye indlela.',
    unknown: 'Kukhona okungasebenzanga kuhle. Zama futhi.',
  },
  retry: 'Zama futhi',
  upgrade: 'Engeza imali',
  retryIn: 'Zama futhi emva kwe',
  seconds: 'amasekhondi',
};

export const LANGUAGES: Record<Language, { label: string; strings: Strings; needsNativeReview: boolean }> = {
  en: { label: 'English', strings: en, needsNativeReview: false },
  sn: { label: 'ChiShona', strings: sn, needsNativeReview: true },
  nd: { label: 'isiNdebele', strings: nd, needsNativeReview: true },
};

export const isLanguage = (v: unknown): v is Language => v === 'en' || v === 'sn' || v === 'nd';

/** First supported language in the browser's list, else English. */
export function pickLanguage(preferred: readonly string[]): Language {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLanguage(base)) return base;
    if (base === 'nr' || base === 'nbl') return 'nd';
  }
  return 'en';
}
