// Paste the Google Sheet "File → Share → Publish to web → (places tab) → CSV" link here.
// Until then the app reads the bundled places.csv.
const CSV_URL = 'places.csv';

// Browser key from Google Cloud, restricted to the site's URL and to the Maps JavaScript API.
// Empty = Google's "for development purposes only" map.
const GOOGLE_MAPS_KEY = 'AIzaSyCuaFAjkEVs484S_EaapYjgq1AQCFSxenE';

// Pin colours, handed out to categories in order of first appearance in the sheet.
const COLORS = ['#1f2430', '#c8102e', '#1d6fb8', '#e08a00', '#7b3fa0', '#2a8f6d', '#8a5a3c', '#d6478f'];

const ICONS = { 'מאפים וקינוחים': '🧁', 'קפה ותה': '☕', 'אוכל': '🍜', 'קניות': '🛍️', 'שווקים ואזורים': '🎪' };
const icon = cat => ICONS[cat] || '📍';

const $ = id => document.getElementById(id);
const done = new Set(JSON.parse(localStorage.getItem('london-done') || '[]')); // keyed by place name: rows get reordered
const filter = { cat: '', day: '', pri: '' };
let places = [], cats = [], me = null, loaded = false;

let map = null, info = null, pins = [];

// The map needs a connection (Google's terms forbid caching it); the list never waits for it.
function loadMap() {
  if (map || $('gmaps')) return;
  if (!navigator.onLine) return void ($('map').textContent = 'המפה זמינה רק עם אינטרנט');
  const s = document.createElement('script');
  s.id = 'gmaps';
  s.async = true;
  // language=en: labels match the English street signs in London
  s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&language=en&region=GB&loading=async&callback=initMap`;
  s.onerror = () => { s.remove(); $('map').textContent = 'המפה זמינה רק עם אינטרנט'; };
  document.head.append(s);
}

window.initMap = async () => {
  await Promise.all(['core', 'maps', 'marker'].map(lib => google.maps.importLibrary(lib)));
  $('map').textContent = '';
  map = new google.maps.Map($('map'), {
    center: { lat: 51.509, lng: -0.126 }, zoom: 13,
    gestureHandling: 'greedy', // one finger pans: the page itself doesn't scroll
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
  });
  info = new google.maps.InfoWindow();
  map.addListener('zoom_changed', () => pins.forEach(paint));

  // CSS full screen: iPhone Safari has no Fullscreen API, so Google's own button doesn't work there
  const full = el('button', '⛶ מסך מלא', 'map-full-btn');
  full.type = 'button';
  full.setAttribute('aria-pressed', 'false');
  full.onclick = () => {
    const center = map.getCenter();
    const on = document.body.classList.toggle('map-full');
    full.textContent = on ? '✕ סגור מפה' : '⛶ מסך מלא';
    full.setAttribute('aria-pressed', on);
    requestAnimationFrame(() => map.setCenter(center));
  };
  map.controls[google.maps.ControlPosition.TOP_RIGHT].push(full);
  render();
};
window.gm_authFailure = () => { $('status').textContent = 'מפתח Google Maps לא תקין או לא מורשה לכתובת הזו'; };

function toPlaces(text) {
  const [head = [], ...rows] = parseCSV(text);
  // startsWith: the sheet's notes header is "הערות / מה לקנות"; extra columns are ignored
  const col = key => head.findIndex(h => h.trim().startsWith(key));
  const i = {
    name: col('שם'), cat: col('קטגוריה'), area: col('אזור'), pri: col('עדיפות'), day: col('יום'),
    book: col('הזמנה מראש'), dur: col('משך משוער'), notes: col('הערות'), lat: col('Latitude'), lng: col('Longitude'),
  };
  if (i.name < 0) throw new Error('not the places sheet');
  // LRM marks around an en dash between digits: without them RTL shows "10:00–22:00" as "22:00–10:00"
  const get = (r, k) => (r[i[k]] || '').trim().replace(/(\d)–(?=\d)/g, '$1‎–‎');
  return rows.filter(r => get(r, 'name')).map(r => {
    const lat = parseFloat(get(r, 'lat')), lng = parseFloat(get(r, 'lng'));
    return {
      name: get(r, 'name'), cat: get(r, 'cat'), area: get(r, 'area'), pri: get(r, 'pri'), day: get(r, 'day'),
      book: get(r, 'book'), dur: get(r, 'dur'), notes: get(r, 'notes'),
      ll: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null, // no coords: listed, not pinned
    };
  });
}

const uniq = key => [...new Set(places.map(p => p[key]).filter(Boolean))];
const dayNum = d => { const m = d.match(/(\d+)\.(\d+)/); return m ? m[2] * 100 + +m[1] : 0; }; // "ו׳ 11.12" -> 1211
const color = p => COLORS[Math.max(cats.indexOf(p.cat), 0) % COLORS.length];
function metres(a, b) { // haversine
  const rad = d => d * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
const dist = p => (me && p.ll ? metres(me, p.ll) : Infinity);
const fmtDist = m => (m < 1000 ? `${Math.round(m / 10) * 10} מ׳` : `${(m / 1000).toFixed(1)} ק״מ`);
const navUrl = p => 'https://www.google.com/maps/dir/?api=1&destination=' +
  encodeURIComponent(p.ll ? `${p.ll.lat},${p.ll.lng}` : `${p.name} London`);

function el(tag, text, cls) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function buildFilters() {
  cats = uniq('cat');
  const chip = (label, value) => {
    const b = el('button', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', filter.cat === value);
    b.onclick = () => { filter.cat = filter.cat === value ? '' : value; buildFilters(); render(); };
    return b;
  };
  if (!cats.includes(filter.cat)) filter.cat = '';
  $('cats').replaceChildren(chip('הכל', ''), ...cats.map(c => chip(`${icon(c)} ${c}`, c)));

  const fill = (key, all, values) => {
    if (!values.includes(filter[key])) filter[key] = '';
    $(key).replaceChildren(new Option(all, ''), ...values.map(v => new Option(v, v)));
    $(key).value = filter[key];
  };
  fill('day', 'כל הימים', uniq('day').sort((a, b) => dayNum(a) - dayNum(b)));
  fill('pri', 'כל העדיפויות', uniq('pri'));
}

function card(p) {
  const node = $('card').content.firstElementChild.cloneNode(true);
  const isDone = done.has(p.name);
  node.style.setProperty('--c', color(p));
  node.classList.toggle('is-done', isDone);
  node.querySelector('h2').textContent = p.name;
  node.querySelector('.meta').textContent = [p.cat && `${icon(p.cat)} ${p.cat}`, p.area].filter(Boolean).join(' · ');
  node.querySelector('.notes').textContent = p.notes;
  node.querySelector('.nav').href = navUrl(p);

  const tags = node.querySelector('.tags');
  if (me && p.ll) tags.append(el('span', fmtDist(dist(p)), 'tag dist'));
  if (p.pri) tags.append(el('span', p.pri, p.pri === 'חובה' ? 'tag must' : 'tag'));
  if (p.day) tags.append(el('span', p.day, 'tag'));
  if (p.book === 'כן') tags.append(el('span', '🎟 להזמין מראש', 'tag book'));
  if (p.dur) tags.append(el('span', `⏱ ${p.dur}`, 'tag'));

  const box = node.querySelector('input');
  box.checked = isDone;
  box.onchange = () => {
    done[box.checked ? 'add' : 'delete'](p.name);
    localStorage.setItem('london-done', JSON.stringify([...done]));
    render();
  };

  if (p.ll && map) {
    const pop = el('div', '');
    pop.dir = 'auto';
    const link = el('a', 'נווט ↗');
    link.href = navUrl(p); link.target = '_blank'; link.rel = 'noopener';
    pop.append(el('strong', p.name), document.createElement('br'), link);
    // ponytail: classic Marker needs no Cloud map ID; move to AdvancedMarkerElement if Google removes it
    const pin = dot(p.ll, color(p), p.name, icon(p.cat), isDone ? 0.4 : 1);
    const open = () => { info.setContent(pop); info.open({ map, anchor: pin }); };
    pin.addListener('click', () => {
      open();
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      node.classList.add('flash');
      setTimeout(() => node.classList.remove('flash'), 1200);
    });
    node.querySelector('.body').onclick = () => {
      map.panTo(p.ll);
      map.setZoom(Math.max(map.getZoom(), 15));
      open();
    };
  }
  return node;
}

// Pins shrink as you zoom out; far out they're plain category-coloured dots so the map stays readable.
const pinSize = zoom => zoom < 12.5 ? { scale: 4 } : zoom < 13.5 ? { scale: 5 } :
  zoom < 14.5 ? { scale: 8, font: 10 } : zoom < 15.5 ? { scale: 10, font: 12 } : { scale: 13, font: 15 };

function paint(pin) {
  const { ring, emoji } = pin.look;
  const { scale, font } = emoji ? pinSize(map.getZoom()) : { scale: 8 }; // my location keeps its size
  const withIcon = emoji && font;
  pin.setLabel(withIcon ? { text: emoji, fontSize: `${font}px` } : null);
  pin.setIcon({
    path: google.maps.SymbolPath.CIRCLE, scale, fillOpacity: 1,
    strokeWeight: withIcon ? 2 : 1.5,
    fillColor: withIcon ? '#fff' : ring, strokeColor: withIcon ? ring : '#fff',
  });
}

function dot(position, ring, title, emoji, opacity = 1) {
  const pin = new google.maps.Marker({ map, position, title, opacity });
  pin.look = { ring, emoji };
  paint(pin);
  pins.push(pin);
  return pin;
}

function render() {
  const shown = places.filter(p => ['cat', 'day', 'pri'].every(k => !filter[k] || p[k] === filter[k]));
  if (me) shown.sort((a, b) => (dist(a) - dist(b)) || 0); // || 0: Infinity - Infinity is NaN
  pins.forEach(pin => pin.setMap(null));
  pins = [];
  info?.close();
  $('list').replaceChildren(...shown.map(card));
  if (me && map) dot(me, '#1a73e8', 'אני כאן');

  if (!loaded) return;
  $('status').textContent = [
    shown.length > 1 ? `${shown.length} מקומות` : shown.length ? 'מקום אחד' : 'אין מקומות שתואמים לסינון',
    `${places.filter(p => done.has(p.name)).length} בוצעו`,
    me && 'ממוין לפי מרחק',
    !navigator.onLine && 'אופליין – נתונים שמורים',
  ].filter(Boolean).join(' · ');
}

async function load() {
  const show = async res => { places = toPlaces(await res.text()); loaded = true; buildFilters(); render(); };
  // Last saved copy first (instant, and survives a weak signal), then refresh from the network behind it.
  try {
    const cached = window.caches && await caches.match(CSV_URL);
    if (cached) await show(cached);
  } catch {}
  try {
    const res = await fetch(CSV_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    await show(res);
  } catch {
    if (!loaded) $('status').textContent = 'לא הצלחתי לטעון את הנתונים. בדקו חיבור ונסו שוב.';
  }
}

// ponytail: one fix per press, no live tracking and no "unsort" (reload restores sheet order). watchPosition if needed.
$('near').onclick = () => {
  if (!navigator.geolocation) return ($('status').textContent = 'הדפדפן לא תומך במיקום');
  $('near').disabled = true;
  navigator.geolocation.getCurrentPosition(pos => {
    $('near').disabled = false;
    me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    render();
    $('list').scrollTop = 0;
    const nearest = places.filter(p => p.ll).sort((a, b) => dist(a) - dist(b))[0];
    // only move the map when actually in town, otherwise it zooms out to another country
    if (map && nearest && dist(nearest) < 50000) {
      map.fitBounds(new google.maps.LatLngBounds().extend(me).extend(nearest.ll), 60);
      google.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); });
    }
  }, () => {
    $('near').disabled = false;
    $('status').textContent = 'לא הצלחתי לקבל מיקום. בדקו הרשאות מיקום.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
};

$('day').onchange = $('pri').onchange = e => { filter[e.target.id] = e.target.value; render(); };
addEventListener('online', () => { load(); loadMap(); });
addEventListener('offline', render);

if ('serviceWorker' in navigator) {
  // First visit: the page loads before the worker controls it, so fetch once more to get the CSV into its cache.
  // Later: a new worker means a new version was deployed, so reload onto it instead of showing the old one.
  const update = navigator.serviceWorker.controller ? () => location.reload() : load;
  navigator.serviceWorker.addEventListener('controllerchange', update, { once: true });
  navigator.serviceWorker.register('sw.js').catch(() => {}); // app still works online without it
}
load();
loadMap();
