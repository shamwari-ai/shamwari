import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView,
  StyleSheet, Text, TextInput, View, useColorScheme,
} from 'react-native';
import { BUDGET, byteLength, clampBytes } from './src/lib/budget';
import { createClient } from './src/lib/client';
import { LANGUAGES, isLanguage, pickLanguage } from './src/i18n/strings';
import { msgText, needsPerson, retryable, type MsgKey } from './src/lib/messages';
import { dequeue, enqueue, type QueuedAsk } from './src/lib/queue';
import { loadKey, loadLang, loadQueue, saveKey, saveLang, saveQueue } from './src/lib/storage';
import { dark, light } from './src/lib/theme';
import type { Answer, Language } from './src/lib/types';

type Item =
  | { kind: 'q'; id: string; text: string; pending: boolean }
  | { kind: 'a'; id: string; answer: Answer }
  | { kind: 'note'; id: string; msg: MsgKey };

const apiBase = (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'https://api.shamwari.ai';

export default function App() {
  const t = useColorScheme() === 'dark' ? dark : light;
  const s = useMemo(() => styles(t), [t]);
  const [key, setKey] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [queue, setQueue] = useState<QueuedAsk[]>([]);
  const [draft, setDraft] = useState('');
  const keyRef = useRef<string | null>(null);
  // The queue's source of truth: flush() runs across awaits and must never write back a stale snapshot.
  const queueRef = useRef<QueuedAsk[]>([]);
  const [status, setStatus] = useState<MsgKey | null>(null);
  const [lang, setLang] = useState<Language>(() => pickLanguage(getLocales().map((l) => l.languageTag)));
  const { strings: str, needsNativeReview } = LANGUAGES[lang];
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const busy = useRef(false);
  const client = useMemo(() => createClient({ baseUrl: apiBase, getKey: () => keyRef.current }), []);

  const push = (i: Item) => setItems((p) => [...p, i]);
  const persist = (q: QueuedAsk[]) => {
    queueRef.current = q; setQueue(q);
    saveQueue(q).catch(() => setStatus('saveQueueFailed'));
  };

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      // Re-read the ref each round so a question typed mid-flush is sent too, and is never overwritten.
      for (;;) {
        const ask = queueRef.current[0];
        if (!ask) break;
        // Same id every retry: the gateway replays instead of metering twice.
        const r = await client.ask({ messages: [{ role: 'user', content: ask.question }], scope: 'platform' }, { idempotencyKey: ask.id });
        if (r.ok) {
          const text = clampBytes(r.value.text, BUDGET.maxAnswerBytes);
          attempts.current = 0; setStatus(null);
          persist(dequeue(queueRef.current, ask.id));
          setItems((p) => [...p.map((i) => (i.kind === 'q' && i.id === ask.id ? { ...i, pending: false } : i)),
            { kind: 'a', id: ask.id + ':a', answer: { ...r.value, text: text.text, truncated: r.value.truncated || text.clipped } }]);
        } else if (retryable(r.error.kind)) {
          // Keep everything queued, in order, say why, and try again on a backoff
          // (or the server's Retry-After) instead of waiting for the app to be reopened.
          setStatus(r.error.kind);
          const wait = Math.max((r.error.retryAfterSec ?? 0) * 1000, Math.min(300_000, 10_000 * 2 ** attempts.current++));
          if (retryTimer.current) clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => { retryTimer.current = null; void flush(); }, wait);
          break;
        } else if (needsPerson(r.error.kind)) {
          // A bad key or a used-up plan is not the question's fault: keep every saved
          // question, say what to do, and resume when the person has done it.
          setStatus(r.error.kind);
          if (r.error.kind === 'unauthorized') setShowSettings(true);
          break;
        } else {
          persist(dequeue(queueRef.current, ask.id));
          setItems((p) => [...p, { kind: 'note', id: ask.id + ':e', msg: r.error.kind }]);
        }
      }
    } finally {
      busy.current = false;
    }
  }, [client]);

  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  useEffect(() => {
    void (async () => {
      try {
        // The language is a preference: if reading it fails, the key and queue must still load.
        const [k, q, savedLang] = await Promise.all([loadKey(), loadQueue(), loadLang().catch(() => null)]);
        if (isLanguage(savedLang)) setLang(savedLang);
        keyRef.current = k; setKey(k); persist(q);
        setItems(q.map((a) => ({ kind: 'q', id: a.id, text: a.question, pending: true })));
        if (!k) setShowSettings(true);
        else if (q.length) void flush();
      } catch {
        // Secure storage can fail (locked keystore, restore from backup). Start empty and let the person re-enter the key.
        setStatus('readFailed');
        setShowSettings(true);
      }
    })();
    // Back in the foreground is the nearest thing to "network returned" without a native module.
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void flush(); });
    return () => sub.remove();
  }, [flush]);

  const send = () => {
    const q = draft.trim();
    if (!q) return;
    // Never cut a question short silently: a cut Shona sentence is a different question.
    if (byteLength(q) > BUDGET.maxQuestionBytes) { setStatus('tooLong'); return; }
    setStatus(null);
    const ask: QueuedAsk = { id: Crypto.randomUUID(), question: q, createdAt: Date.now() };
    // Scope is always 'platform' here: the app has no on-device Mind yet, and a
    // personal-scope ask must never be queued (queue.ts refuses it).
    const r = enqueue(queueRef.current, ask, 'platform');
    if (!r.ok) { push({ kind: 'note', id: ask.id, msg: r.reason === 'queue_full' ? 'queueFull' : 'tooLong' }); return; }
    push({ kind: 'q', id: ask.id, text: q, pending: true });
    setDraft(''); persist(r.queue); void flush();
  };

  const render = ({ item }: { item: Item }) => {
    if (item.kind === 'q') return <View style={[s.bubble, s.mine]}><Text style={s.mineText}>{item.text}{item.pending ? `  ·  ${str.waiting}` : ''}</Text></View>;
    if (item.kind === 'note') return <View style={s.note}><Text style={s.noteText} accessibilityRole="alert">{msgText(str, item.msg)}</Text></View>;
    const a = item.answer;
    return (
      <View style={[s.bubble, s.theirs]}>
        <Text style={s.text}>{a.text}</Text>
        {a.inferencePath === 'extractive' || a.degraded ? <Text style={s.meta}>{str.closestSource}</Text> : null}
        {a.truncated ? <Text style={s.meta}>{str.shortened}</Text> : null}
        {a.citations.map((c, i) => (
          <Pressable key={i} disabled={!c.url} onPress={() => c.url && void Linking.openURL(c.url)} accessibilityRole={c.url ? 'link' : 'text'} style={s.cite}>
            <Text style={s.citeTitle}>[{i + 1}] {[c.title, c.heading].filter(Boolean).join(' - ')}</Text>
            <Text style={s.meta}>{[c.authority, c.effective_from].filter(Boolean).join(' · ')}</Text>
          </Pressable>
        ))}
        {!a.grounded && !a.citations.length ? <Text style={s.meta}>{str.noSources}</Text> : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.root}>
      <StatusBar style="auto" />
      <View style={s.bar}>
        <Text style={s.title}>Shamwari</Text>
        <Pressable onPress={() => setShowSettings((v) => !v)} accessibilityRole="button" accessibilityLabel={str.settings}><Text style={s.link}>{str.settings}</Text></Pressable>
      </View>
      {showSettings ? (
        <View style={s.panel}>
          <Text style={s.text}>{str.language}</Text>
          <View style={s.langRow}>
            {(Object.keys(LANGUAGES) as Language[]).map((l) => (
              <Pressable key={l} style={[s.langBtn, l === lang && s.langOn]} accessibilityRole="button" accessibilityState={{ selected: l === lang }}
                onPress={() => { setLang(l); void saveLang(l).catch(() => undefined); }}>
                <Text style={l === lang ? s.btnText : s.link}>{LANGUAGES[l].label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={s.text}>{str.signInSoon}</Text>
          <Text style={s.meta}>{key ? str.keySaved : str.noKeyYet}</Text>
          <TextInput style={s.input} value={keyDraft} onChangeText={setKeyDraft} placeholder={str.keyPlaceholder} placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Pressable style={s.btn} onPress={() => { const k = keyDraft.trim(); setKeyDraft(''); setShowSettings(false); if (!k) return; keyRef.current = k; setKey(k); setStatus(null); void saveKey(k).catch(() => setStatus('saveKeyFailed')); void flush(); }} accessibilityRole="button">
            <Text style={s.btnText}>{str.save}</Text>
          </Pressable>
          {key ? (
            <Pressable onPress={() => { keyRef.current = null; setKey(null); void saveKey('').catch(() => undefined); }} accessibilityRole="button" accessibilityLabel={str.authDevClear}>
              <Text style={s.link}>{str.authDevClear}</Text>
            </Pressable>
          ) : null}
          <Text style={s.meta}>{str.cloudNotice}</Text>
          <Text style={s.meta}>{str.footer}</Text>
        </View>
      ) : null}
      {needsNativeReview ? <View style={s.note}><Text style={s.meta}>{str.reviewNote}</Text></View> : null}
      {status ? <View style={s.note}><Text style={s.noteText} accessibilityRole="alert">{msgText(str, status)}</Text></View> : null}
      <FlatList style={s.list} contentContainerStyle={{ padding: 12, gap: 8 }} data={items} keyExtractor={(i) => i.id} renderItem={render}
        ListEmptyComponent={<Text style={s.meta}>{str.tagline}</Text>} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.composer}>
          <TextInput style={[s.input, { flex: 1 }]} value={draft} onChangeText={setDraft} placeholder={str.placeholder} placeholderTextColor={t.muted} multiline editable={!!key} />
          <Pressable style={s.btn} onPress={send} disabled={!key} accessibilityRole="button" accessibilityLabel={str.send}><Text style={s.btnText}>{str.send}</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = (t: typeof light | typeof dark) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.base }, list: { flex: 1 },
  bar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 },
  title: { color: t.text, fontSize: 18, fontWeight: '600' }, link: { color: t.brand, fontSize: 16, paddingVertical: 8 },
  panel: { margin: 12, padding: 12, gap: 8, borderRadius: 12, backgroundColor: t.surface },
  bubble: { padding: 12, borderRadius: 12, maxWidth: '92%', gap: 6 },
  mine: { alignSelf: 'flex-end', backgroundColor: t.brand }, mineText: { color: t.onBrand, fontSize: 16 },
  theirs: { alignSelf: 'flex-start', backgroundColor: t.sodaliteContainer },
  text: { color: t.onSodaliteContainer, fontSize: 16, lineHeight: 22 },
  meta: { color: t.muted, fontSize: 13 }, cite: { paddingVertical: 6, minHeight: 44, justifyContent: 'center' },
  citeTitle: { color: t.brand, fontSize: 14 },
  note: { padding: 12, borderRadius: 12, backgroundColor: t.container }, noteText: { color: t.warn, fontSize: 15 },
  composer: { flexDirection: 'row', gap: 8, padding: 12, alignItems: 'flex-end' },
  input: { backgroundColor: t.surface, color: t.text, borderRadius: 12, padding: 12, fontSize: 16, minHeight: 44 },
  btn: { backgroundColor: t.brand, borderRadius: 12, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  langRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  langBtn: { borderRadius: 12, paddingHorizontal: 12, minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: t.container },
  langOn: { backgroundColor: t.brand, borderColor: t.brand },
  btnText: { color: t.onBrand, fontSize: 16, fontWeight: '600' },
});
