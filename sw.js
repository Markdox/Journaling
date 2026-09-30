/* Service worker del Diario: cache offline + promemoria giornaliero */
const CACHE = 'diario-v1';
const META_CACHE = 'journal-meta';
const META_URL = '/__diario_meta.json';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

const MESSAGES = [
  'Un momento per te: come è andata oggi?',
  'Il diario ti aspetta. Bastano pochi minuti.',
  'Prima di chiudere la giornata, scrivi cosa è stato bello.',
  'Tre piccole cose per cui essere grati… ti vengono in mente?'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== META_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      return (await network) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    })
  );
});

/* ---------- promemoria ---------- */
const pad = n => String(n).padStart(2, '0');
const dk = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

async function readMeta() {
  try {
    const c = await caches.open(META_CACHE);
    const r = await c.match(META_URL);
    return r ? await r.json() : {};
  } catch { return {}; }
}
async function writeMeta(patch) {
  try {
    const m = { ...(await readMeta()), ...patch };
    const c = await caches.open(META_CACHE);
    await c.put(META_URL, new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
  } catch {}
}

function notify() {
  return self.registration.showNotification('Il tuo diario', {
    body: MESSAGES[Math.floor(Math.random() * MESSAGES.length)],
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'daily-reminder'
  });
}

async function maybeRemind() {
  const m = await readMeta();
  if (!m.enabled || !m.time) return;
  if (self.Notification && Notification.permission !== 'granted') return;
  const now = new Date();
  const [h, min] = m.time.split(':').map(Number);
  const target = new Date(now); target.setHours(h, min, 0, 0);
  const diff = now - target;
  if (diff < 0 || diff > 6 * 3600 * 1000) return;        // solo entro 6 ore dall'orario scelto
  const today = dk(now);
  if (m.lastNotified === today || m.doneDate === today) return; // già avvisato o già scritto
  await writeMeta({ lastNotified: today });
  await notify();
}

self.addEventListener('periodicsync', e => {
  if (e.tag === 'daily-reminder') e.waitUntil(maybeRemind());
});

self.addEventListener('message', e => {
  if (e.data === 'check') e.waitUntil(maybeRemind());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    })
  );
});
