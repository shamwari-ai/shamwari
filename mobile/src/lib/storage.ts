import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { parseQueue, type QueuedAsk } from './queue';

const QUEUE = 'shamwari.queue.v1';
const KEY = 'shamwari.key';
const LANG = 'shamwari.lang';

export const loadQueue = async (): Promise<QueuedAsk[]> => parseQueue(await AsyncStorage.getItem(QUEUE));
export const saveQueue = (q: QueuedAsk[]) => AsyncStorage.setItem(QUEUE, JSON.stringify(q));
/** The key lives in the OS keystore, never in the bundle and never in AsyncStorage. */
export const loadLang = () => AsyncStorage.getItem(LANG);
export const saveLang = (l: string) => AsyncStorage.setItem(LANG, l);
export const loadKey = () => SecureStore.getItemAsync(KEY);
export const saveKey = (k: string) => (k ? SecureStore.setItemAsync(KEY, k) : SecureStore.deleteItemAsync(KEY));
