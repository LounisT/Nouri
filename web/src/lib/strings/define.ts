// Chaînes traduites par domaine, fusionnées dans translations (i18n.ts).
// Chaque fichier de ce dossier appartient à un domaine ; préfixer les clés
// (nav_, itin_, map_, cat_, data_, ux_) pour éviter toute collision.
// Le typage impose les mêmes clés en fr / ar / en.
export function defineStrings<const K extends string>(s: {
  fr: Record<K, string>
  ar: Record<K, string>
  en: Record<K, string>
}) {
  return s
}
