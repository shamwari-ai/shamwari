import type { ExpoConfig } from 'expo/config';

/**
 * The EAS project id is not a secret, but it does not exist yet: the Expo
 * project `shamwari` must be created once on expo.dev (see mobile/README.md).
 * Until EAS_PROJECT_ID is set the app runs without OTA updates, which is
 * correct for local development.
 */
const projectId = process.env.EAS_PROJECT_ID;

const config: ExpoConfig = {
  name: 'Shamwari',
  slug: 'shamwari',
  owner: 'nyuchi-web-services',
  scheme: 'shamwari',
  version: '0.1.0',
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
  plugins: ['expo-secure-store', 'expo-updates'],
  // Same app version, same native runtime: updates only reach builds that can run them.
  runtimeVersion: { policy: 'appVersion' },
  ...(projectId ? { updates: { url: `https://u.expo.dev/${projectId}` } } : {}),
  extra: {
    ...(projectId ? { eas: { projectId } } : {}),
    // Public by design (EXPO_PUBLIC_*): a base URL, never a key.
    apiBaseUrl: process.env.EXPO_PUBLIC_SHAMWARI_API ?? 'https://api.shamwari.ai',
  },
};

export default config;
