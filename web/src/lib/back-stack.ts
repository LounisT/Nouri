// Pile des écrans « poussés » (résultats, détail, navigation) synchronisée
// avec l'historique du navigateur. Sans elle, le bouton retour d'Android et le
// geste retour d'iOS fermaient l'app au lieu de revenir à l'écran précédent.
//
// Chaque écran ouvert ajoute UNE entrée d'historique ; le retour système
// dépile l'écran du dessus. Un écran fermé depuis l'interface (bouton ←)
// consomme son entrée pour que le retour suivant ne tombe pas dans le vide.
// Les écarts sont appliqués en fin de tâche : plusieurs écrans qui s'ouvrent
// ou se ferment dans le même rendu ne donnent qu'un seul `history.go`.

type Layer = { id: number; onBack: () => void }

const stack: Layer[] = []
// Entrées que NOUS avons poussées et qui sont encore dans l'historique.
let historyDepth = 0
let ignoreNextPop = false
let flushScheduled = false
let listening = false
let nextId = 1

function onPopState() {
  if (ignoreNextPop) {
    ignoreNextPop = false
    return
  }
  if (historyDepth === 0) return
  historyDepth--
  const top = stack.pop()
  top?.onBack()
}

function flush() {
  flushScheduled = false
  const diff = stack.length - historyDepth
  if (diff > 0) {
    for (let i = 0; i < diff; i++) {
      historyDepth++
      window.history.pushState({ nouriLayer: historyDepth }, '')
    }
  } else if (diff < 0) {
    historyDepth += diff
    ignoreNextPop = true
    window.history.go(diff)
  }
}

function scheduleFlush() {
  if (flushScheduled) return
  flushScheduled = true
  setTimeout(flush, 0)
}

export function pushLayer(onBack: () => void): number {
  if (!listening) {
    window.addEventListener('popstate', onPopState)
    listening = true
  }
  const id = nextId++
  stack.push({ id, onBack })
  scheduleFlush()
  return id
}

export function removeLayer(id: number) {
  const index = stack.findIndex((layer) => layer.id === id)
  // Déjà dépilé par le retour système : son entrée est consommée.
  if (index === -1) return
  stack.splice(index, 1)
  scheduleFlush()
}

export function updateLayer(id: number, onBack: () => void) {
  const layer = stack.find((l) => l.id === id)
  if (layer) layer.onBack = onBack
}
