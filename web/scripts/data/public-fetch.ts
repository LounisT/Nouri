// fetch('/data/…') servi depuis web/public pour les contrôles en Node (pas de
// serveur Next) : même contenu que ce que reçoit le navigateur.
import { readFileSync } from 'fs'
import { join } from 'path'

export function installPublicFetch(): void {
  const root = join(__dirname, '..', '..', 'public')
  ;(globalThis as { fetch?: unknown }).fetch = async (url: string) => {
    try {
      const body = readFileSync(join(root, url.replace(/^\//, '')), 'utf-8')
      return { ok: true, status: 200, json: async () => JSON.parse(body) }
    } catch {
      return { ok: false, status: 404, json: async () => null }
    }
  }
}
