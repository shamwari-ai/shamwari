/** Mzizi tokens (registry, read 2026-11-01): sodalite = Shamwari, the AI surface. Backgrounds from the shared base/surface scale. */
export const light = {
  base: '#F3F3F1', surface: '#EEEEEC', container: '#E5E4E1',
  brand: '#283593', onBrand: '#FFFFFF', text: '#141A5C', muted: '#4A4A48',
  sodaliteContainer: '#E8EAF6', onSodaliteContainer: '#141A5C', warn: '#5D4037',
} as const;
export const dark = {
  base: '#0E0D0C', surface: '#131211', container: '#1E1D1A',
  brand: '#3D5AFE', onBrand: '#FFFFFF', text: '#C6CFFF', muted: '#B8B8B4',
  sodaliteContainer: '#0D1442', onSodaliteContainer: '#C5CAE9', warn: '#FFD740',
} as const;
export type Theme = typeof light | typeof dark;
