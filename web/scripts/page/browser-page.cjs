// Test navigateur de l'écran principal (page.tsx) sur une copie BUILDÉE de web/
// servie en http://localhost:3931 (proxy → OTP, lecture seule).
//
// Usage : node web/scripts/page/browser-page.cjs [all|fr|extra|ar|map]
//   PP     : dossier contenant node_modules/puppeteer et .cache/chrome-headless-shell
//   FONTS  : fichier fontconfig avec une police arabe (sans police, Chrome headless
//            fige le rendu arabe)
//   MAP_CHUNK : nom du chunk de MapView (scénario « map » : frontière d'erreur ;
//            les deux erreurs JS de ce scénario sont attendues)
// ATTENTION : ne pas rebuilder une copie dont node_modules est un lien symbolique
// avec `output: 'standalone'` — le nettoyage de .next par Next suit le lien
// .next/standalone/node_modules et vide le vrai node_modules.
const SP = process.env.SP || '/tmp/claude-1000/-home-ubuntu/721cadf9-39c4-4ac4-bebb-6e5acb4428a8/scratchpad'
const PP = process.env.PP || `${SP}/audit/pp`
const puppeteer = require(`${PP}/node_modules/puppeteer`)
const fs = require('fs'), path = require('path')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ORIGIN = process.env.ORIGIN || 'http://localhost:3931'
const CHROME = `${PP}/.cache/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell`
const MAP_CHUNK = process.env.MAP_CHUNK || ''
// Horloge de la page : décalée (elle avance) vers AT, pour que les scénarios
// ne dépendent pas de l'heure du lancement (« Commencer » est refusé pour un
// trajet qui part dans plusieurs heures, la nuit n'affiche « demain » que le
// soir). Défaut : le lundi suivant, 20:30 heure d'Alger. AT=now : horloge réelle.
const AT = process.env.AT || (() => {
  const d = new Date(Date.now() + 3600e3)
  const add = ((8 - d.getUTCDay()) % 7) || 7
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add, 19, 30)).toISOString()
})()
const CLOCK_SHIFT = AT === 'now' ? 0 : Date.parse(AT) - Date.now()
const TZ_EMU = process.env.TZ_EMU || 'Africa/Algiers'
let failed = 0
const check = (msg, cond, detail = '') => { console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}${detail ? ` — ${String(detail).slice(0, 220)}` : ''}`); if (!cond) failed++ }
const strip = (x) => String(x ?? '').replace(/[\u2068\u2069]/g, '')
const only = process.argv[2] || 'all'

const LINK = `/?from=36.7724,3.0594,Grande%20Poste&to=36.7176,3.1386,El%20Harrach`

;(async () => {
  const userDataDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nouri-page-'))
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'shell', userDataDir, protocolTimeout: 90000,
    env: { ...process.env, LD_LIBRARY_PATH: `${PP}/libs/usr/lib/x86_64-linux-gnu`, FONTCONFIG_FILE: process.env.FONTS || `${SP}/ux/fonts.conf` },
    args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
  })
  await browser.defaultBrowserContext().overridePermissions(ORIGIN, ['geolocation'])
  const page = await browser.newPage()
  await page.setViewport({ width: 390, height: 844 })
  await page.emulateTimezone(TZ_EMU)
  if (CLOCK_SHIFT) {
    console.log(`     horloge de la page : ${AT} (fuseau émulé ${TZ_EMU})`)
    await page.evaluateOnNewDocument((shift) => {
      const RD = Date
      class FD extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + shift); else super(...a) } static now() { return RD.now() + shift } }
      // eslint-disable-next-line no-global-assign
      Date = FD
    }, CLOCK_SHIFT)
  }
  await page.setGeolocation({ latitude: 36.7724, longitude: 3.0594, accuracy: 10 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|tiles|ERR_|net::/.test(m.text())) errors.push(m.text().slice(0, 300)) })

  // Interception des requêtes de calcul : 'pass', 'delay', 'fail503', 'night'.
  let planMode = 'pass'
  const planLog = []
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (MAP_CHUNK && url.includes(MAP_CHUNK) && planMode === 'breakmap') return void req.abort()
    if (!url.includes('/api/otp/routers/default/plan')) return void req.continue()
    const time = new URL(url).searchParams.get('time')
    planLog.push({ mode: planMode, time, at: Date.now() })
    if (planMode === 'delay') return void setTimeout(() => req.continue().catch(() => {}), 3500)
    if (planMode === 'fail503') return void req.respond({ status: 503, contentType: 'application/json', body: '{"error":"OTP unavailable"}' })
    if (planMode === 'night' && time !== '04:30') {
      return void req.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: { itineraries: [] }, error: { id: 404, msg: 'No trip found', message: 'PATH_NOT_FOUND' } }) })
    }
    req.continue()
  })

  const q = (fn, ...args) => page.evaluate(fn, ...args)
  const state = () => q(() => {
    const panel = document.querySelector('.app-column > [role=region]')
    const list = panel?.children[0]
    const detail = panel?.children[1]
    const tabLayer = document.querySelector('.app-column > div.z-10')
    const tabBar = document.querySelector('.app-column > div.z-20:not([role])')
    const mapWrap = document.querySelector('main > div.absolute.inset-0')
    const live = document.querySelector('main > p[role=status]')
    const active = document.activeElement
    return {
      url: location.pathname + location.search,
      panelInert: panel?.hasAttribute('inert'),
      listInert: list?.hasAttribute('inert'),
      detailInert: detail?.hasAttribute('inert'),
      tabLayerInert: tabLayer?.hasAttribute('inert'),
      tabBarInert: tabBar?.hasAttribute('inert'),
      mapInert: mapWrap?.hasAttribute('inert'),
      live: live?.textContent ?? '',
      heading: panel?.querySelector('h1')?.textContent ?? '',
      sub: panel?.querySelector('h1 + p')?.textContent ?? '',
      rows: [...(list?.querySelectorAll('button[aria-label]') ?? [])].filter((b) => !['Retour', 'Fermer', 'رجوع', 'إغلاق', 'Back', 'Close'].includes(b.getAttribute('aria-label'))).map((b) => ({ aria: b.getAttribute('aria-label'), text: b.innerText })),
      listText: list?.innerText ?? '',
      // Écran Itinéraire (handoff « Itinéraire Alger ») : feuille glissable à
      // trois positions, portée par data-snap ; bord haut lu sur sa transform.
      detailSnap: detail?.dataset.snap ?? '',
      sheetY: (() => { const m = /translate3d\(0px, ([\d.-]+)px/.exec(detail?.querySelector(':scope > .z-20')?.style.transform ?? ''); return m ? Number(m[1]) : null })(),
      activeTag: active?.tagName, activeText: active?.textContent?.slice(0, 80), activeAria: active?.getAttribute('aria-label'),
      submitText: document.querySelector('button[type=submit]')?.textContent ?? '',
      dir: document.documentElement.dir,
      body: document.body.innerText,
    }
  })
  const waitFor = async (pred, ms = 20000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < ms) {
      const s = await state()
      if (pred(s)) return s
      await sleep(250)
    }
    return state()
  }
  const clickText = (text) => q((t) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.replace(/[\u2068\u2069]/g, '').trim().startsWith(t) && x.offsetParent !== null)
    if (b) b.click()
    return Boolean(b)
  }, text)

  // Langue explicite (le navigateur de test est en anglais : l'app suivrait sa langue).
  await page.evaluateOnNewDocument(() => { try { if (!sessionStorage.getItem('__lang')) { localStorage.setItem('locale', 'fr'); sessionStorage.setItem('__lang', '1') } } catch {} })
  if (only === 'all' || only === 'fr') {
    // ── 1. Lien partagé : recherche automatique ──────────────────────────────
    await page.goto(ORIGIN + LINK, { waitUntil: 'networkidle2' })
    let s = await waitFor((x) => x.rows.length > 0 || /Aucun|impossible/.test(x.listText))
    check('lien : l’adresse redevient « / »', s.url === '/', s.url)
    check('lien : recherche lancée, rangées affichées', s.rows.length > 0, s.listText.slice(0, 120))
    check('en-tête : départ → arrivée', strip(s.heading).includes('Grande Poste') && strip(s.heading).includes('El Harrach'), s.heading)
    check('en-tête : « Départ maintenant · HH:MM » (heure demandée)', /^Départ maintenant · \d\d:\d\d/.test(s.sub), s.sub)
    check('rangées : heures « ~ »', s.rows.every((r) => /~\d\d:\d\d → ~\d\d:\d\d/.test(r.text)), s.rows.map((r) => r.text.replace(/\n/g, ' | ')).join(' // '))
    check('rangées : libellé vocal sans « ~ », avec durée et heures', s.rows.every((r) => !/~/.test(r.aria) && /départ (vers )?\d\d:\d\d/.test(r.aria)), s.rows[0]?.aria)
    check('annonce vocale : « N itinéraire(s) trouvé(s) »', /itinéraires? trouvés?/.test(s.live), s.live)
    check('focus sur le titre des résultats', s.activeTag === 'H1', `${s.activeTag} ${s.activeText}`)
    check('formulaire, barre d’onglets et carte (recouverte) inertes', s.tabLayerInert && s.tabBarInert && s.mapInert, JSON.stringify({ t: s.tabLayerInert, b: s.tabBarInert, m: s.mapInert }))
    check('détail inerte tant qu’il est fermé', s.detailInert === true)

    // ── 2. Détail à mi-hauteur : la carte apparaît au-dessus ─────────────────
    await q(() => [...document.querySelectorAll('.app-column > [role=region] > div:first-child button[aria-label]')].find((b) => / vers \d|حوالي|around/.test(b.getAttribute('aria-label')))?.click())
    s = await waitFor((x) => x.detailInert === false && x.activeTag === 'H2', 4000)
    check('détail ouvert, focus sur son titre', s.activeTag === 'H2', `${s.activeTag} ${s.activeText}`)
    check('détail : feuille au milieu sur téléphone (330/844 de la maquette)', s.detailSnap === 'mid' && Math.abs((s.sheetY ?? 0) - 330) <= 2, `${s.detailSnap} ${s.sheetY}`)
    check('carte visible et utilisable au-dessus du détail', s.mapInert === false)
    check('liste inerte sous le détail', s.listInert === true)
    // (Ancien « clickText('') // no-op » retiré : il cliquait le premier bouton
    // du DOM — le « Ma position » de la carte, que l'écran Itinéraire masque
    // désormais au profit de son bouton flottant ; il ouvrait alors le
    // sélecteur de langue de l'accueil inerte, qui empilait un retour.)
    await q(() => document.querySelector('[aria-label="Agrandir le détail"]')?.click())
    await sleep(500)
    s = await state()
    check('poignée : détail agrandi (plein écran), carte de nouveau inerte', s.detailSnap === 'full' && Math.abs((s.sheetY ?? 0) - 52) <= 2 && s.mapInert === true, `${s.detailSnap} ${s.sheetY} ${s.mapInert}`)
    await q(() => document.querySelector('[aria-label="Réduire le détail pour voir la carte"]')?.click())
    await sleep(400)

    // ── 3. Retour système : détail → liste → accueil ─────────────────────────
    await page.goBack().catch(() => {})
    s = await waitFor((x) => x.detailInert === true && x.activeTag === 'BUTTON', 4000)
    check('retour : le détail se ferme, focus rendu à la rangée', s.detailInert && s.activeTag === 'BUTTON' && /départ/.test(s.activeAria ?? ''), JSON.stringify({ d: s.detailInert, tag: s.activeTag, aria: s.activeAria, text: s.activeText }))
    await page.goBack().catch(() => {})
    s = await waitFor((x) => x.panelInert === true, 4000)
    check('retour : les résultats se ferment', s.panelInert === true)
    await sleep(300)
    s = await state()
    check('focus rendu au bouton du formulaire', s.activeTag === 'BUTTON' && /Trouver|itinéraire/.test(s.activeText ?? ''), s.activeText)
    check('formulaire de nouveau utilisable (non inerte)', s.tabLayerInert === false && s.tabBarInert === false)

    // ── 4. Réponse tardive après un retour : l'écran ne se rouvre pas ───────
    planMode = 'delay'
    await page.goto(ORIGIN + LINK, { waitUntil: 'domcontentloaded' })
    s = await waitFor((x) => /Recherche/.test(x.live), 8000)
    check('recherche lente : écran Résultats ouvert (squelette)', s.panelInert === false && /Recherche/.test(s.live), JSON.stringify({ p: s.panelInert, live: s.live }))
    await sleep(600)
    await page.goBack().catch(() => {})
    await sleep(5000)
    s = await state()
    check('réponse arrivée après le retour : résultats NON rouverts', s.panelInert === true)
    check('bouton du formulaire pas bloqué sur « Recherche… »', !/Recherche/.test(s.submitText), s.submitText)
    planMode = 'pass'

    // ── 5. Calculateur en panne : message honnête + Réessayer ────────────────
    planMode = 'fail503'
    await page.goto(ORIGIN + LINK, { waitUntil: 'domcontentloaded' })
    s = await waitFor((x) => /impossible|répond/.test(x.listText), 15000)
    check('panne : « Recherche impossible pour le moment » + raison', /Recherche impossible pour le moment/.test(s.listText) && /ne répond pas/.test(s.listText), s.listText.slice(0, 160))
    check('panne : aucun trajet simulé', s.rows.length === 0 && !/simulé|démo/i.test(s.listText))
    planMode = 'pass'
    await clickText('Réessayer')
    s = await waitFor((x) => x.rows.length > 0, 20000)
    check('Réessayer : la même recherche aboutit', s.rows.length > 0, s.listText.slice(0, 100))

    // ── 6. Nuit : rien à l'heure demandée → premiers départs du matin ───────
    planMode = 'night'
    await page.goto(ORIGIN + LINK, { waitUntil: 'domcontentloaded' })
    s = await waitFor((x) => x.rows.length > 0 || /Aucun/.test(x.listText), 25000)
    const nightCalls = planLog.filter((p) => p.mode === 'night').map((p) => p.time)
    console.log('     requêtes de nuit :', nightCalls.join(', '))
    if (nightCalls.includes('04:30')) {
      check('nuit : bandeau « Plus de trajet possible… Premiers départs… »', /Plus de trajet possible/.test(s.listText) && /Premiers départs/.test(s.listText), s.listText.slice(0, 160))
      check('nuit : jour sur chaque rangée', s.rows.every((r) => /\b\d{1,2} [a-zé]+\.? · ~/.test(r.text)), s.rows.map((r) => r.text.split('\n')[1]).join(' // '))
    } else {
      check('nuit : heure hors plage de relance (de jour) → message factuel', /Aucun trajet/.test(s.listText), s.listText.slice(0, 120))
    }
    planMode = 'pass'

    // ── 7. Navigation : Commencer, Quitter, Reprendre ────────────────────────
    await page.goto(ORIGIN + LINK, { waitUntil: 'domcontentloaded' })
    s = await waitFor((x) => x.rows.length > 0, 20000)
    await q(() => [...document.querySelectorAll('.app-column > [role=region] > div:first-child button[aria-label]')].find((b) => / vers \d|حوالي|around/.test(b.getAttribute('aria-label')))?.click())
    await waitFor((x) => x.detailInert === false, 4000)
    await clickText('Commencer')
    s = await waitFor((x) => /Quitter la navigation/.test(x.body), 6000)
    check('navigation : bandeau affiché', /Quitter la navigation/.test(s.body), s.body.slice(0, 120))
    check('navigation : carte visible, onglets et résultats inertes', s.mapInert === false && s.tabBarInert && s.panelInert, JSON.stringify({ m: s.mapInert, b: s.tabBarInert, p: s.panelInert }))
    const hasOld = await q(() => /arrêts restants/.test(document.body.innerText) && !document.querySelector('[role=status]'))
    check('navigation : plus l’ancien bandeau de page.tsx', !hasOld)
    await clickText('Quitter la navigation')
    s = await waitFor((x) => /Reprendre la navigation/.test(x.body), 4000)
    check('sortie : retour au détail + « Reprendre la navigation vers … »', /Reprendre la navigation vers/.test(s.body) && s.panelInert === false, s.body.slice(0, 160))
    // La rangée est dans la liste (sous le détail) : on referme le détail.
    await page.goBack().catch(() => {})
    await sleep(500)
    await clickText('Reprendre la navigation')
    s = await waitFor((x) => /Quitter la navigation/.test(x.body), 4000)
    check('reprise : la navigation repart', /Quitter la navigation/.test(s.body))
    // Rechargement en pleine navigation : la session revient (useNavigationSession).
    await page.reload({ waitUntil: 'domcontentloaded' })
    s = await waitFor((x) => /Quitter la navigation|Terminer/.test(x.body), 8000)
    check('rechargement : navigation reprise', /Quitter la navigation|Terminer/.test(s.body))
    await page.goBack().catch(() => {})
    s = await waitFor((x) => !/Quitter la navigation/.test(x.body), 4000)
    check('retour système en navigation : la navigation se ferme (accueil)', !/Quitter la navigation/.test(s.body))
    await q(() => { try { localStorage.removeItem('nouri.nav.session.v1') } catch {} })

    // ── 8. Saisie conservée au changement d'onglet et de langue ─────────────
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle2' })
    const toInput = await page.$('input[id$="-to"]')
    await toInput.click({ clickCount: 3 })
    await toInput.type('Bab Ezzouar xyz')
    await sleep(300)
    await clickText('Lignes')
    await sleep(500)
    await q(() => [...document.querySelectorAll('nav button, [role=tablist] button, .app-column > div.z-20 button')].find((b) => /Itinéraire|Accueil/.test(b.textContent))?.click())
    await sleep(500)
    let v = await q(() => document.querySelector('input[id$="-to"]')?.value)
    check('onglet Lignes puis retour : destination saisie conservée', v === 'Bab Ezzouar xyz', v)

    // ── 9. Raccourci ?tab=lines ──────────────────────────────────────────────
    await page.goto(ORIGIN + '/?tab=lines', { waitUntil: 'networkidle2' })
    s = await state()
    const linesVisible = await q(() => {
      const panels = document.querySelectorAll('.app-column > div.z-10 .min-h-0.flex-1 > div')
      return panels[1] ? getComputedStyle(panels[1]).display !== 'none' : false
    })
    check('raccourci ?tab=lines : onglet Lignes ouvert, adresse « / »', linesVisible && s.url === '/', s.url)

    // ── 10. Grand écran : colonne de 420 px, carte à côté ────────────────────
    await page.setViewport({ width: 1100, height: 760 })
    await page.goto(ORIGIN + LINK, { waitUntil: 'domcontentloaded' })
    s = await waitFor((x) => x.rows.length > 0, 20000)
    const col = await q(() => document.querySelector('.app-column').getBoundingClientRect().width)
    check('grand écran : colonne 420 px', Math.round(col) === 420, col)
    check('grand écran : carte visible à côté des résultats', s.mapInert === false)
    check('grand écran : résultats affichés (plus de md:hidden)', s.rows.length > 0)
    await page.setViewport({ width: 390, height: 844 })
  }

  if (only === 'all' || only === 'extra') {
    // ── 13. Lien avec « % » dans le nom : plus d'écran d'erreur ──────────────
    await page.goto(ORIGIN + '/?from=36.7724,3.0594,Caf%C3%A9%20100%25&to=36.7176,3.1386,El%20Harrach', { waitUntil: 'domcontentloaded' })
    let s = await waitFor((x) => x.rows.length > 0 || /Aucun|impossible/.test(x.listText), 20000)
    check('lien avec « % » : pas d’erreur, recherche lancée', strip(s.heading).includes('Café 100%') && !/Application error|problème est survenu/.test(s.body), s.heading)
    await page.goBack().catch(() => {})
    await sleep(500)

    // ── 14. Hors ligne : bandeau sur l'accueil, sur la carte, message de recherche ──
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle2' })
    await page.setOfflineMode(true)
    await sleep(500)
    s = await state()
    check('hors ligne : bandeau sur l’accueil', /Hors ligne : lignes et arrêts/.test(s.body))
    await clickText('Carte')
    await sleep(1200)
    s = await state()
    check('hors ligne : bandeau aussi sur l’onglet Carte', /Hors ligne : lignes et arrêts/.test(s.body), s.body.slice(0, 200))
    await page.setOfflineMode(false)
    await sleep(300)

    // ── 15. Appui long sur la carte → « Y aller » remplit la destination ─────
    await page.goto(ORIGIN + '/?tab=map', { waitUntil: 'networkidle2' })
    await sleep(3500)
    await page.mouse.click(200, 420, { button: 'right' })
    const hasGo = await (async () => { for (let i = 0; i < 30; i++) { if (await q(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Y aller' && !b.disabled))) return true; await sleep(300) } return false })()
    check('appui long : fiche du point avec « Y aller »', hasGo)
    if (hasGo) {
      await clickText('Y aller')
      await sleep(800)
      const v = await q(() => document.querySelector('input[id$="-to"]')?.value)
      const homeVisible = await q(() => getComputedStyle(document.querySelector('.app-column > div.z-10 .min-h-0.flex-1 > div')).display !== 'none')
      check('« Y aller » : retour au formulaire, destination remplie', homeVisible && Boolean(v), v)
    }
  }

  if (only === 'all' || only === 'ar') {
    // ── 11. Arabe : RTL, en-tête, libellés ───────────────────────────────────
    await page.goto(ORIGIN + '/', { waitUntil: 'domcontentloaded' })
    await q(() => { try { localStorage.setItem('locale', 'ar'); sessionStorage.setItem('__lang', '1') } catch {} })
    await page.goto(ORIGIN + LINK, { waitUntil: 'domcontentloaded' })
    const s = await waitFor((x) => x.rows.length > 0, 25000)
    check('arabe : dir=rtl', s.dir === 'rtl', s.dir)
    check('arabe : en-tête « الانطلاق الآن · HH:MM »', /^الانطلاق الآن · \d\d:\d\d/.test(s.sub), s.sub)
    check('arabe : libellé vocal arabe, virgule arabe, sans « ~ »', s.rows.every((r) => /الانطلاق/.test(r.aria) && /،/.test(r.aria) && !/~/.test(r.aria)), s.rows[0]?.aria)
    check('arabe : annonce accordée', /مسار/.test(s.live), s.live)
    await q(() => { try { localStorage.removeItem('locale') } catch {} })
  }

  if ((only === 'all' || only === 'map') && MAP_CHUNK) {
    // ── 12. Frontière d'erreur : module de carte introuvable ─────────────────
    // Contexte neuf (ni cache HTTP ni service worker : après les scénarios
    // précédents, le chunk serait déjà en cache). Ses deux erreurs JS sont
    // attendues et ne comptent pas dans « aucune erreur JavaScript ».
    const ctx = await browser.createBrowserContext()
    const p2 = await ctx.newPage()
    await p2.setViewport({ width: 390, height: 844 })
    await p2.setRequestInterception(true)
    p2.on('request', (req) => (req.url().includes(MAP_CHUNK) ? req.abort() : req.continue()))
    await p2.evaluateOnNewDocument(() => { try { localStorage.setItem('locale', 'fr') } catch {} })
    await p2.goto(ORIGIN + '/?tab=map', { waitUntil: 'domcontentloaded' })
    let body = ''
    for (let i = 0; i < 30 && !/La carte n’a pas pu s’afficher/.test(body); i++) { await sleep(300); body = await p2.evaluate(() => document.body.innerText) }
    check('carte en échec : message, le reste de l’app reste utilisable', /La carte n’a pas pu s’afficher/.test(body) && /Lignes/.test(body), body.slice(0, 200))
    await ctx.close()
  }

  check('aucune erreur JavaScript', errors.length === 0, errors.join(' | '))
  await browser.close()
  console.log(failed ? `\n${failed} échec(s)` : '\nTout est conforme')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error(e); process.exit(2) })
