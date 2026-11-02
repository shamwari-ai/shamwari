import { StatusBar } from 'expo-status-bar';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  AppState, FlatList, KeyboardAvoidingView, Linking, Platform, Pressable, SafeAreaView,
  StyleSheet, Text, TextInput, View, useColorScheme,
} from 'react-native';
import { authConfig, createNativeSession } from './src/auth/native';
import { ChatController, type Item } from './src/chat/controller';
import { LANGUAGES, isLanguage, pickLanguage } from './src/i18n/strings';
import { createClient } from './src/lib/client';
import { msgText } from './src/lib/messages';
import { loadKey, loadLang, loadQueue, saveKey, saveLang, saveQueue } from './src/lib/storage';
import { dark, light } from './src/lib/theme';
import type { Language } from './src/lib/types';

const apiBase = (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? 'https://api.shamwari.ai';

export default function App() {
  const t = useColorScheme() === 'dark' ? dark : light;
  const s = useMemo(() => styles(t), [t]);
  const [keyDraft, setKeyDraft] = useState('');
  const [draft, setDraft] = useState('');
  const [lang, setLang] = useState<Language>(() => pickLanguage(getLocales().map((l) => l.languageTag)));
  const { strings: str, needsNativeReview } = LANGUAGES[lang];

  // Every decision (the queue, retry, holding questions, sign-out) lives in ChatController, which
  // test/controller.test.ts drives without a phone. This file draws what it says.
  const ctl = useMemo(() => {
    const session = createNativeSession(authConfig(Constants.expoConfig?.extra));
    let controller!: ChatController;
    const client = createClient({
      baseUrl: apiBase,
      // The signed-in session first, the pasted developer key as the fallback (Expo Go, testing).
      // getAccessToken THROWS when WorkOS is unreachable: the client treats that as offline, not signed out.
      getKey: async () => (await session.getAccessToken()) ?? controller.devKey(),
      onUnauthorized: () => session.renewAfterRejection(),
    });
    controller = new ChatController({
      ask: (req, opts) => client.ask(req, opts),
      session,
      store: { loadKey, saveKey, loadQueue, saveQueue },
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      newId: () => Crypto.randomUUID(),
      now: () => Date.now(),
    });
    return controller;
  }, []);
  const { items, status, signedIn, hasKey, showSettings } = useSyncExternalStore(ctl.subscribe, ctl.getState);

  useEffect(() => {
    void ctl.start();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') ctl.foreground(); });
    return () => { sub.remove(); ctl.dispose(); };
  }, [ctl]);

  // The language is a preference: a failed read must never stop the key and queue from loading.
  useEffect(() => {
    loadLang().catch(() => null).then((l) => { if (isLanguage(l)) setLang(l); });
  }, []);

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
        <Pressable onPress={() => ctl.setShowSettings(!showSettings)} accessibilityRole="button" accessibilityLabel={str.settings}><Text style={s.link}>{str.settings}</Text></Pressable>
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
          {signedIn ? (
            <>
              <Text style={s.text}>{str.signedIn}</Text>
              <Pressable onPress={() => void ctl.signOut()} accessibilityRole="button" accessibilityLabel={str.signOut}>
                <Text style={s.link}>{str.signOut}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={s.btn} onPress={() => void ctl.signIn()} accessibilityRole="button">
              <Text style={s.btnText}>{str.authMukoko}</Text>
            </Pressable>
          )}
          <Text style={s.text}>{str.authDevTitle}</Text>
          <Text style={s.meta}>{hasKey ? str.keySaved : str.noKeyYet}</Text>
          <TextInput style={s.input} value={keyDraft} onChangeText={setKeyDraft} placeholder={str.keyPlaceholder} placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          <Pressable style={s.btn} onPress={() => { ctl.saveDevKey(keyDraft); setKeyDraft(''); }} accessibilityRole="button">
            <Text style={s.btnText}>{str.save}</Text>
          </Pressable>
          {hasKey ? (
            <Pressable onPress={() => ctl.removeDevKey()} accessibilityRole="button" accessibilityLabel={str.authDevClear}>
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
          <TextInput style={[s.input, { flex: 1 }]} value={draft} onChangeText={setDraft} placeholder={str.placeholder} placeholderTextColor={t.muted} multiline editable={hasKey || signedIn} />
          <Pressable style={s.btn} onPress={() => { if (ctl.send(draft)) setDraft(''); }} disabled={!hasKey && !signedIn} accessibilityRole="button" accessibilityLabel={str.send}><Text style={s.btnText}>{str.send}</Text></Pressable>
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
