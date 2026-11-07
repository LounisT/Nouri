const PP = '/home/ubuntu/tools/browser'
const puppeteer = require(PP + '/node_modules/puppeteer')
const CHROME = PP + '/.cache/chrome-headless-shell/linux-131.0.6778.204/chrome-headless-shell-linux64/chrome-headless-shell'
const ORIGIN = 'https://nouri.lounis.dev'
// Horloge simulée : dimanche 2026-11-08, 08:30 heure d'Alger (UTC+1), pour un plan en pleine journée.
const FAKE_UTC = Date.UTC(2026, 10, 8, 7, 30, 0)
const from = '36.752909,3.066526,' + encodeURIComponent('Hamma')
const to = '36.722002,3.137163,' + encodeURIComponent('El Harrach Centre')
const SCREENS = {
  accueil: '/',
  itineraire: `/?from=${from}&to=${to}`,
  lignes: '/?tab=lines',
  carte: '/?tab=map',
}
const langs = (process.argv[2] || 'fr,ar,en').split(',')
const only = process.argv[3] ? process.argv[3].split(',') : Object.keys(SCREENS)
;(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'shell', args: ['--no-sandbox'] })
  for (const lang of langs) for (const name of only) {
    const ctx = b.defaultBrowserContext(); await ctx.overridePermissions(ORIGIN, ['geolocation'])
    const p = await b.newPage()
    await p.setGeolocation({ latitude: 36.7721, longitude: 3.0581, accuracy: 25 })
    await p.setViewport({ width: Number(process.env.VW || 360), height: Number(process.env.VH || 720), deviceScaleFactor: Number(process.env.DSF || 3), isMobile: !process.env.NOMOBILE, hasTouch: true })
    await p.setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36')
    await p.evaluateOnNewDocument((l, fake, noshim) => {
      window.__noshim = noshim
      try { localStorage.setItem('locale', l) } catch {}
      const RealDate = Date, off = fake - RealDate.now()
      class FakeDate extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off) }
        static now() { return RealDate.now() + off }
      }
      // eslint-disable-next-line no-global-assign
      if (!window.__noshim) Date = FakeDate
    }, lang, FAKE_UTC, !!process.env.NOSHIM)
    p.on('response', (r) => { if (r.url().includes('openfreemap') && r.status() >= 400) console.log('  HTTP', r.status(), r.url().slice(-60)) })
    p.on('requestfailed', (r) => { if (r.url().includes('openfreemap')) console.log('  FAILED', r.failure()?.errorText, r.url().slice(-60)) })
    await p.goto(ORIGIN + SCREENS[name], { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {})
    await new Promise((r) => setTimeout(r, name === 'carte' ? 9000 : name === 'itineraire' ? 7000 : 3500))
    if (name === 'itineraire') {
      await p.touchscreen.tap(180, 100)
      await new Promise((r) => setTimeout(r, 6000))
      await p.evaluate(() => window.dispatchEvent(new Event('resize')))
      await new Promise((r) => setTimeout(r, 8000))
    }
    await p.screenshot({ path: `shots/${name}-${lang}.png` })
    console.log('ok', name, lang)
    await p.close()
  }
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
