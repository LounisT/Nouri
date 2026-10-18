// Retour haptique léger, façon UIImpactFeedbackGenerator / HapticFeedback
// Android. `navigator.vibrate` n'existe que sur Android (Chrome, Firefox) :
// ailleurs l'appel est simplement ignoré.
type HapticKind = 'selection' | 'impact' | 'success'

const PATTERNS: Record<HapticKind, number | number[]> = {
  selection: 8,
  impact: 15,
  success: [12, 60, 18],
}

export function haptic(kind: HapticKind = 'selection') {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return
  // Respecter « réduire les animations » : l'usager qui coupe le mouvement
  // ne veut pas non plus que le téléphone tressaute à chaque appui.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  try {
    navigator.vibrate(PATTERNS[kind])
  } catch {
    // Certains navigateurs lèvent hors geste utilisateur : sans importance.
  }
}
