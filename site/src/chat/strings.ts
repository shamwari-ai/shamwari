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
  placeholder: 'Ask a question',
  send: 'Send',
  newChat: 'New chat',
  collapseChats: 'Collapse the chat list',
  searchChats: 'Search chats',
  noMatches: 'No chats match.',
  recents: 'Recents',
  groupToday: 'Today',
  groupYesterday: 'Yesterday',
  groupWeek: 'Previous 7 days',
  groupOlder: 'Older',
  copyAnswer: 'Copy answer',
  copied: 'Copied',
  shareAnswer: 'Share answer',
  languageUnavailable: 'That language could not be loaded. Try again when you are online.',
  deleteWait: 'This chat is still sending. Delete it when it has its answer.',
  addTo: 'Add',
  uploadFile: 'Upload a file',
  recordVoice: 'Record a voice note',
  stopRecording: 'Stop recording',
  recordingNow: 'Recording…',
  attachKept: 'Kept on this device. Not sent.',
  removeAttachment: 'Remove',
  fileTooBig: 'That file is over 10 MB. Choose a smaller one.',
  tooManyFiles: 'You can add up to 4 files to a question.',
  micDenied: 'The microphone is not available. Allow it in the browser to record.',
  voiceNote: 'Voice note',
  playVoice: 'Play',
  saveCopy: 'Save a copy',
  attachmentGone: 'That file is no longer on this device.',
  attachments: 'Attachments',
  deleteHistory: 'Delete history',
  deleteConfirm: 'Delete every chat saved on this device? This cannot be undone.',
  deleted: 'History deleted from this device.',
  language: 'Language',
  thinking: 'Shamwari is looking for the answer…',
  stop: 'Stop',
  stopped: 'Stopped. Your question is kept on this device and was not answered.',
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
  storedHere: 'Your chat history is saved on this device only. Shamwari keeps a service record of each request (when, how big, what it cost), not the text of your question or its answer. Chats are not used to train Shamwari Mind.',
  privacyDetail: 'So that a retry is never charged twice, an answer is held for up to 10 minutes and then deleted.',
  earlierChats: 'Earlier chats',
  chats: 'Chats',
  pinned: 'Pinned',
  projects: 'Projects',
  artifacts: 'Artifacts',
  sections: 'Sections',
  navChat: 'Chat',
  navFactory: 'Factory',
  navPlugins: 'Plugins',
  comingSoon: 'Coming soon',
  chatsEmpty: 'Your earlier chats appear here.',
  artifactsEmpty: 'Answers you save appear here.',
  pluginsTab: 'Plugins',
  skillsTab: 'Skills',
  mcpTab: 'MCP',
  pluginsEmpty: 'No plugins yet. Plugins will add tools to Shamwari; none are available today.',
  skillsEmpty: 'No skills yet. They will appear here when there are some.',
  mcpEmpty: 'No MCP servers are connected. Shamwari connects to none today.',
  thirdPartyNote: 'A plugin or an MCP server would be run by someone else, and anything sent to one would leave Shamwari. None is connected, so nothing is sent.',
  noPinned: 'Pin a chat or a project to keep it here.',
  newProject: 'New project',
  projectName: 'Project name',
  createProject: 'Create project',
  pin: 'Pin this chat',
  unpin: 'Unpin this chat',
  pinProject: 'Pin project',
  unpinProject: 'Unpin project',
  project: 'Project',
  noProject: 'No project',
  saveAnswer: 'Save answer',
  answerSaved: 'Saved to Artifacts',
  removeArtifact: 'Remove',
  deleteChat: 'Delete chat',
  deleteChatConfirm: 'Delete this chat from this device?',
  deleteProject: 'Delete project',
  deleteProjectConfirm: 'Delete this project? Its chats are kept.',
  openChat: 'Open the chat',
  close: 'Close',
  chatOptions: 'Chat options',
  version: 'Version',
  openChats: 'Open chats',
  closeChats: 'Close chats',
  yourChats: 'Your chats',
  tryAsking: 'Try asking',
  greeting: 'Hello, friend',
  example1: 'What does the Constitution say about equality?',
  example2: 'What are my rights if I am arrested?',
  example3: 'What does the Constitution say about education?',
  settings: 'Settings',
  about: 'About',
  settingsData: 'Data on this device',
  useApi: 'Use the API',
  opensNewTab: '(opens in a new tab)',
  disclaimerLink: 'Disclaimer and privacy',
  disclaimerTitle: 'Disclaimer and privacy',
  backToChat: 'Back to the chat',
  signedOutCleared: 'Signed out. Your chats were removed from this device.',
  signOutTitle: 'Sign out on this device?',
  signOutKept: 'Your messages stay on this device unless you choose below to delete them.',
  signOutAlsoDelete: 'Also delete messages from this device',
  signOutNotEncrypted: 'Messages on this device are not encrypted. Anyone who can open this browser\'s data could read them.',
  signOutCancel: 'Cancel',
  signedOutKeptNote: 'Signed out. Your messages stay on this device.',
  signInFailed: 'We could not sign you in. Please try again.',
  signOut: 'Sign out',
  storageFailed: 'This device could not save your chat. It will be lost when you close this tab.',
  signInRetry: 'We could not finish signing you out of the last session. Check your connection and try again.',
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
  offlineMode: 'Offline mode',
  offlineModeOn: 'On',
  offlineModeOff: 'Off',
  offlineModeNote: 'Offline mode is on. Nothing is sent: what you write is kept on this device only.',
  offlineLocal: 'Saved on this device only. Not sent.',
  queued: 'Waiting to send',
  sendNow: 'Send now',
  discard: 'Discard',
  authTitle: 'Sign in to ask',
  authMukoko: 'Sign in with Mukoko',
  authMukokoSoon: 'Mukoko sign-in is coming soon.',
  signinOffline: 'You are offline. Sign in when you are back online.',
  authDevClear: 'Remove key',
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

/** The words of each language, once loaded. English is always there; Shona and Ndebele are fetched when first chosen. */
const loaded: Partial<Record<Language, Strings>> = { en };

/**
 * Load a language's words (a separate script file for Shona and for Ndebele, precached by the service worker so it also works offline).
 * Call this and wait for it before showing a language; until it has run, `LANGUAGES[lang].strings` is English.
 */
export async function loadStrings(lang: Language): Promise<Strings> {
  const have = loaded[lang];
  if (have) return have;
  const got = lang === 'sn' ? (await import('./strings-sn')).sn : (await import('./strings-nd')).nd;
  loaded[lang] = got;
  return got;
}

export const LANGUAGES: Record<Language, { label: string; readonly strings: Strings; needsNativeReview: boolean }> = {
  en: { label: 'English', get strings() { return en; }, needsNativeReview: false },
  sn: { label: 'ChiShona', get strings() { return loaded.sn ?? en; }, needsNativeReview: true },
  nd: { label: 'isiNdebele', get strings() { return loaded.nd ?? en; }, needsNativeReview: true },
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
