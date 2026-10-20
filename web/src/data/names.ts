/**
 * Common first names, offered as suggestions while typing a customer name.
 * Names the restaurant has already used are suggested first; this list fills the gaps.
 * The owner can extend it later from Settings (Phase 1).
 */
export const COMMON_NAMES = [
  'Anashe', 'Anesu', 'Blessing', 'Brian', 'Chiedza', 'Chipo', 'Chido', 'Farai', 'Fadzai', 'Gift',
  'Kudakwashe', 'Kudzai', 'Kundai', 'Memory', 'Mufaro', 'Munashe', 'Munyaradzi', 'Mutsa', 'Ngoni', 'Nokutenda',
  'Nyasha', 'Panashe', 'Precious', 'Privilege', 'Rufaro', 'Rudo', 'Rumbidzai', 'Ropafadzo', 'Ruvimbo', 'Shamiso',
  'Simba', 'Tafadzwa', 'Tafara', 'Takudzwa', 'Tanaka', 'Tapiwa', 'Tariro', 'Tatenda', 'Tawanda', 'Tendai',
  'Tinashe', 'Tinotenda', 'Tonderai', 'Tsitsi', 'Vimbai', 'Wadzanai', 'Yeukai', 'Zvikomborero',
];

/** Names starting with what was typed, used names first, without duplicates. */
export function nameSuggestions(typed: string, usedNames: string[], limit = 5): string[] {
  const q = typed.trim().toLowerCase();
  if (q.length < 1) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const firstNames = usedNames.map((n) => n.split(' ')[0]);
  for (const n of [...firstNames, ...COMMON_NAMES]) {
    const k = n.toLowerCase();
    if (k.startsWith(q) && k !== q && !seen.has(k)) {
      seen.add(k);
      out.push(n);
      if (out.length >= limit) break;
    }
  }
  return out;
}
