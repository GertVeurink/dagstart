/* Servicewerker voor Op Rij — zorgt dat de app werkt zonder bereik.
 *
 * Anders dan bij Nog Te Zien halen we hier eerst het netwerk en pas daarna de
 * cache. Reden: deze app wordt nog geregeld aangepast, en met cache-eerst blijf
 * je op de telefoon een oude versie zien zonder te snappen waarom. Netwerk-eerst
 * kost een seconde bij het openen en is verder onzichtbaar.
 *
 * De briefing (briefing.json) en de ingesproken mp3 worden hier wél bewaard,
 * en dat is met opzet: zo kun je in de trein zonder bereik de briefing van die
 * ochtend nog lezen en beluisteren. De app haalt hem altijd eerst vers op.
 *
 * Je eigen gegevens zitten hier niet in. Die staan in de opslag van de browser zelf
 * (localStorage) en verlaten de telefoon nooit — ook de cache hieronder bevat
 * alleen de app zelf: de pagina, het icoon en de manifest.
 */
/* De briefing, het archief en de opname komen sinds 4 oktober 2026 van GitHub
 * in plaats van van Netlify (zie DATA_BASIS in index.html). Die staan dus op een
 * ánder adres dan de app, en daar moest deze werker op aangepast worden: hij
 * liet alles van elders ongemoeid doorlopen naar het netwerk, waardoor de
 * briefing zonder bereik niet meer te lezen zou zijn. Juist in de trein.
 */
const DATA_HOST = 'raw.githubusercontent.com';
const VERSIE = 'oprij-65cc68f2';
const BESTANDEN = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icoon-180.png',
  './icoon-192.png',
  './icoon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSIE);
    await cache.addAll(BESTANDEN);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(
      namen.filter((n) => n.startsWith('oprij-') && n !== VERSIE)
           .map((n) => caches.delete(n))
    );
    /* Opnames van meer dan een week terug hoeven niet in de cache te blijven
       staan; dat scheelt een paar megabyte op de telefoon. */
    const cache = await caches.open(VERSIE);
    const grens = new Date(Date.now() - 7 * 864e5)
      .toISOString().slice(0, 10).replace(/-/g, '');
    for (const req of await cache.keys()) {
      const m = req.url.match(/audio\/(\d{8})\.mp3/);
      if (m && m[1] < grens) await cache.delete(req);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  const eigen = url.origin === self.location.origin;
  if (!eigen && url.hostname !== DATA_HOST) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSIE);
    try {
      const res = await fetch(req);
      /* Van ons eigen adres is het antwoord 'basic', van de gegevenshost
         'cors'. Beide mogen in de cache; een 'opaque' antwoord (een mislukte
         CORS-poging) niet, want dat is een leeg omhulsel. */
      if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
        cache.put(req, res.clone());
      }
      return res;
    } catch (err) {
      const uitCache = await cache.match(req, { ignoreSearch: true });
      if (uitCache) return uitCache;
      if (req.mode === 'navigate') {
        const index = await cache.match('./index.html');
        if (index) return index;
      }
      throw err;
    }
  })());
});


/* ---------------------------------------------------------------------------
   Meldingen
   ---------------------------------------------------------------------------
   Het pushbericht van de Mac is leeg — met opzet. Zo hoeft er niets versleuteld
   te worden en ziet Apple alleen "wek deze app"; wát er aan de hand is haalt de
   servicewerker hier zelf op. De inhoud blijft dus tussen de Mac en dit toestel.

   iOS staat dit alleen toe als de app op het beginscherm staat. En er móet een
   melding verschijnen: laat je dat achterwege, dan trekt de browser de
   toestemming na een paar keer weer in. Daarom ook een melding als het ophalen
   mislukt — dan maar een vage. */
/* Niet via raw.githubusercontent.com, en dat is geen willekeur.
   Raw houdt een bestand vijf minuten vast, en een pushbericht komt binnen een
   paar seconden aan — dus dat valt altijd binnen dat venster en de telefoon
   leest het vórige bestand. Op 20 oktober 2026 was dat meteen raak: de app las
   18:31 (leeg) terwijl er om 18:38 een melding klaarstond.
   De Contents-API van GitHub staat op max-age 60 en is dus wél vers. Hij geeft
   de inhoud in base64 en is zonder sleutel beperkt tot zestig verzoeken per uur
   per adres — ruim genoeg, want hier komt alleen een pushbericht langs. */
const BREAKING_API = 'https://api.github.com/repos/GertVeurink/dagstart-data/contents/breaking.json?ref=main';
const BREAKING_RAW = 'https://raw.githubusercontent.com/GertVeurink/dagstart-data/main/breaking.json';

async function haalBreaking() {
  try {
    const a = await fetch(BREAKING_API, { cache: 'no-store' });
    if (!a.ok) throw new Error(a.status);
    const omhulsel = await a.json();
    const bytes = Uint8Array.from(atob(omhulsel.content.replace(/\s/g, '')),
                                  (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch (err) {
    /* Raakt de limiet van zestig per uur vol, dan maar de oude route. */
    const a = await fetch(BREAKING_RAW, { cache: 'no-store' });
    return a.json();
  }
}

self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let titel = 'Dagstart';
    let tekst = 'Er is iets binnengekomen.';
    let link = './';
    try {
      /* De tekst zit in het bericht zelf. Dat moest wel: een pushbericht zonder
         inhoud neemt Apple wél aan, maar levert hij niet af aan de app — dan
         toont iOS zelf een kale melding met alleen de appnaam en komt deze code
         er nooit aan te pas. Dat kostte op 20 oktober 2026 een avond zoeken. */
      const d = e.data ? e.data.json() : null;
      if (d && d.titel) {
        titel = d.titel;
        tekst = d.tekst || '';
        link = d.link || './';
      } else {
        /* Mocht er ooit tóch een leeg bericht aankomen: dan nog één poging. */
        const b = await haalBreaking();
        const items = (b && b.nieuw) || [];
        if (items.length) {
          titel = items[0].titel;
          tekst = items[0].bron + (items[0].tijd ? ' \u00b7 ' + items[0].tijd : '');
          link = items[0].link || './';
        }
      }
    } catch (err) {
      tekst = 'Ophalen mislukt \u00b7 ' + VERSIE;
    }
    await self.registration.showNotification(titel, {
      body: tekst,
      icon: './icoon-192.png',
      badge: './icoon-192.png',
      data: { link: link },
      /* Eén tag: een tweede melding vervangt de eerste in plaats van ernaast te
         komen. Gert wil er weinig, niet een stapel.
         Maar vervángen doet iOS stilletjes — geen geluid, geen banner. Op
         22 oktober 2026 verdween een proefmelding zo achter een melding van de
         dag ervóór die nog in het berichtencentrum stond, en leek de push stuk
         terwijl Apple hem keurig had aangenomen. renotify zet het geluid en de
         banner er weer bij, zonder dat het er twee worden. */
      tag: 'dagstart-breaking',
      renotify: true,
    });
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'versie?' && e.source) e.source.postMessage({ versie: VERSIE });
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    /* Naar het bericht zelf, niet naar de app. Daar is de melding voor: je tikt
       erop omdat je wilt weten wát er staat. Staat er geen adres bij, dan maar
       de app -- en is die al open, dan die naar voren. */
    const adres = (e.notification.data && e.notification.data.link) || './';
    if (adres !== './') return self.clients.openWindow(adres);
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) {
      if (c.url.includes(self.registration.scope)) return c.focus();
    }
    return self.clients.openWindow('./');
  })());
});
