// Régénère les captures du manifeste (public/screenshots/*.png, 1080x2340 =
// 360x780 @ DPR 3) depuis un serveur qui sert la version finale (données + front).
// À relancer après chaque régénération des données ou du front, sinon la fiche
// d'installation Android affiche des chiffres que l'app contredit (constat R44).
// Usage : PP=<dossier puppeteer> ORIGIN=https://localhost:8443 node web/scripts/page/manifest-screenshots.cjs
//   OUT : dossier de sortie (défaut : web/public/screenshots)
//   AT  : heure figée (défaut : un mercredi 10:00 heure d'Alger, état « Ouvert » de journée)
// Échoue (code 1) si M1 n'affiche pas « 19 stations » ou en cas d'erreur console / CSP.
const PP = process.env.PP || '/home/ubuntu/tools/browser'
const puppeteer = require(`${PP}/node_modules/puppeteer`)
const CHROME = `${PP}/.cache/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell`
const ORIGIN = process.env.ORIGIN || 'https://localhost:8443'
const OUT = process.env.OUT || require('path').join(__dirname, '../../public/screenshots')
// Heure figée (jour ouvrable, 10:00 heure d'Alger) pour que l'état ouvert/fermé soit celui d'une journée.
const AT = process.env.AT || '2026-11-04T10:00:00+01:00'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

;(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--ignore-certificate-errors', '--no-sandbox'] })
  const errors = []
  try {
    const ctx = browser.defaultBrowserContext()
    await ctx.overridePermissions(ORIGIN, ['geolocation'])
    const page = await browser.newPage()
    await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
    await page.emulateTimezone('Africa/Algiers')
    await page.setGeolocation({ latitude: 36.7724, longitude: 3.0594, accuracy: 10 })
    page.on('pageerror', (e) => errors.push('pageerror ' + String(e).slice(0, 200)))
    page.on('console', (m) => { if (m.type() === 'error' || /Refused to/.test(m.text())) errors.push(m.text().slice(0, 200)) })
    await page.evaluateOnNewDocument((at) => {
      const shift = Date.parse(at) - Date.now()
      const RD = Date
      class FD extends RD { constructor(...a) { if (a.length === 0) super(RD.now() + shift); else super(...a) } static now() { return RD.now() + shift } }
      // eslint-disable-next-line no-global-assign
      Date = FD
      try { localStorage.setItem('locale', 'fr') } catch {}
    }, AT)

    // Accueil
    await page.goto(ORIGIN + '/', { waitUntil: 'networkidle2' })
    await sleep(1500)
    await page.screenshot({ path: `${OUT}/accueil.png` })
    const home = await page.evaluate(() => document.body.innerText)
    console.log('--- accueil ---\n' + home.slice(0, 600))

    // Lignes
    await page.goto(ORIGIN + '/?tab=lines', { waitUntil: 'networkidle2' })
    await sleep(1500)
    await page.screenshot({ path: `${OUT}/lignes.png` })
    const lines = await page.evaluate(() => document.body.innerText)
    console.log('--- lignes ---\n' + lines.slice(0, 900))
    const m1 = /M1[\s\S]{0,200}?19 stations/.test(lines)
    console.log(m1 ? 'OK   M1 : 19 stations' : 'FAIL M1 : 19 stations absent')
    console.log(errors.length ? 'FAIL erreurs : ' + errors.join(' | ') : 'OK   aucune erreur console / CSP')
    if (!m1 || errors.length) process.exitCode = 1
  } finally {
    await browser.close()
  }
})().catch((e) => { console.error(e); process.exit(2) })
