/**
 * Crude language tag for training-set stratification and Ground filtering.
 * Deliberately not a model call — this runs on every request.
 *
 * Replace once groundMisses and the corpus show where it misfires.
 */
const SN = /\b(ndeipi|mutero|ndinoda|zvakanaka|chii|sei|vanhu|mari|ndiri|tinoda|handisi|munhu|basa|mhoro)\b/i;
const ND = /\b(yini|ngingathanda|kuhle|ngicela|umuntu|imali|kanjani|ngiyabonga|sikhona|lokhu|umsebenzi|sawubona)\b/i;
const EN = /\b(the|and|what|how|is|are|please|tax|law|price)\b/i;

export function detectLanguage(text: string): string | null {
  const sn = SN.test(text);
  const nd = ND.test(text);
  const en = EN.test(text);
  if (sn && en) return 'sn-en';
  if (nd && en) return 'nd-en';
  if (sn) return 'sn';
  if (nd) return 'nd';
  if (en) return 'en';
  return null;
}
