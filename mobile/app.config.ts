import type { ExpoConfig } from 'expo/config';

/**
 * The EAS project `@nyuchi-web-services/shamwari`. A project id is an identifier, not a secret (it is
 * printed in every app config and in every update URL), so it is committed. EAS_PROJECT_ID overrides it,
 * for a fork or a staging project, and an empty value turns over-the-air updates off.
 */
const DEFAULT_PROJECT_ID = '3edfc139-4592-48ad-84a3-aacd0f0a9e72';
const projectId = process.env.EAS_PROJECT_ID ?? DEFAULT_PROJECT_ID;

const config: ExpoConfig = {
  name: 'Shamwari',
  slug: 'shamwari',
  owner: 'nyuchi-web-services',
  // The redirect scheme is the app's own id, not a generic word: any other app on the phone can claim a generic scheme.
  scheme: 'ai.shamwari.app',
  version: '0.3.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: { supportsTablet: false, bundleIdentifier: 'ai.shamwari.app' },
  android: {
    package: 'ai.shamwari.app',
    adaptiveIcon: {
      backgroundColor: '#283593',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  plugins: ['expo-secure-store', 'expo-localization', 'expo-web-browser', 'expo-updates'],
  // Same app version, same native runtime: updates only reach builds that can run them.
  runtimeVersion: { policy: 'appVersion' },
  ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
  extra: {
    ...(projectId ? { eas: { projectId } } : {}),
    // Public by design (EXPO_PUBLIC_*): a base URL, never a key.
    apiBaseUrl: process.env.EXPO_PUBLIC_SHAMWARI_API ?? 'https://api.shamwari.ai',
    // Public, not secrets: the Shamwari Chat AuthKit app's client id (the gateway accepts only this client's tokens).
    workosClientId: process.env.EXPO_PUBLIC_WORKOS_CLIENT_ID ?? 'client_01M68PCT0T5ECHKDYH45ECT0GV',
  },
};

export default config;
