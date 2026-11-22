// Paste the Google Sheet "File → Share → Publish to web → (places tab) → CSV" link here.
// Until then the app reads the bundled places.csv.
const CSV_URL = 'places.csv';

// Pin colours, handed out to categories in order of first appearance in the sheet.
const COLORS = ['#1f2430', '#c8102e', '#1d6fb8', '#e08a00', '#7b3fa0', '#2a8f6d', '#8a5a3c', '#d6478f'];

const $ = id => document.getElementById(id);
const done = new Set(JSON.parse(localStorage.getItem('london-done') || '[]')); // keyed by place name: rows get reordered
const filter = { cat: '', day: '', pri: '' };
let places = [], cats = [], me = null, loaded = false;

const map = L.map('map').setView([51.509, -0.126], 13);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  crossOrigin: true, // CORS tiles are cacheable by the service worker without opaque-response quota padding
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const pins = L.layerGroup().addTo(map);

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
      ll: Number.isFinite(lat) && Number.isFinite(lng) ? L.latLng(lat, lng) : null, // no coords: listed, not pinned
    };
  });
}

const uniq = key => [...new Set(places.map(p => p[key]).filter(Boolean))];
const dayNum = d => { const m = d.match(/(\d+)\.(\d+)/); return m ? m[2] * 100 + +m[1] : 0; }; // "ו׳ 11.12" -> 1211
const color = p => COLORS[Math.max(cats.indexOf(p.cat), 0) % COLORS.length];
const dist = p => (me && p.ll ? me.distanceTo(p.ll) : Infinity);
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
  const chip = (label, value, dot) => {
    const b = el('button', label);
    b.type = 'button';
    if (dot) b.style.setProperty('--c', dot);
    b.setAttribute('aria-pressed', filter.cat === value);
    b.onclick = () => { filter.cat = filter.cat === value ? '' : value; buildFilters(); render(); };
    return b;
  };
  if (!cats.includes(filter.cat)) filter.cat = '';
  $('cats').replaceChildren(chip('הכל', ''), ...cats.map((c, n) => chip(c, c, COLORS[n % COLORS.length])));

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
  node.querySelector('.meta').textContent = [p.cat, p.area].filter(Boolean).join(' · ');
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

  if (p.ll) {
    const pop = el('div', '');
    pop.dir = 'auto';
    const link = el('a', 'נווט ↗');
    link.href = navUrl(p); link.target = '_blank'; link.rel = 'noopener';
    pop.append(el('strong', p.name), document.createElement('br'), link);
    const pin = L.circleMarker(p.ll, {
      radius: 10, weight: 2, color: '#fff', fillColor: color(p), fillOpacity: isDone ? 0.3 : 1,
    }).bindPopup(pop).addTo(pins);
    pin.on('click', () => {
      node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      node.classList.add('flash');
      setTimeout(() => node.classList.remove('flash'), 1200);
    });
    node.querySelector('.body').onclick = () => { map.setView(p.ll, Math.max(map.getZoom(), 15)); pin.openPopup(); };
  }
  return node;
}

function render() {
  const shown = places.filter(p => ['cat', 'day', 'pri'].every(k => !filter[k] || p[k] === filter[k]));
  if (me) shown.sort((a, b) => (dist(a) - dist(b)) || 0); // || 0: Infinity - Infinity is NaN
  pins.clearLayers();
  $('list').replaceChildren(...shown.map(card));
  if (me) L.circleMarker(me, { radius: 7, weight: 3, color: '#fff', fillColor: '#1a73e8', fillOpacity: 1 })
    .bindPopup('אני כאן').addTo(pins);

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
    me = L.latLng(pos.coords.latitude, pos.coords.longitude);
    render();
    $('list').scrollTop = 0;
    const nearest = places.filter(p => p.ll).sort((a, b) => dist(a) - dist(b))[0];
    // only move the map when actually in town, otherwise it zooms out to another country
    if (nearest && dist(nearest) < 50000) map.fitBounds(L.latLngBounds([me, nearest.ll]).pad(0.4), { maxZoom: 16 });
  }, () => {
    $('near').disabled = false;
    $('status').textContent = 'לא הצלחתי לקבל מיקום. בדקו הרשאות מיקום.';
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
};

$('day').onchange = $('pri').onchange = e => { filter[e.target.id] = e.target.value; render(); };
addEventListener('online', load);
addEventListener('offline', render);

if ('serviceWorker' in navigator) {
  // First visit: the page loads before the worker controls it, so fetch once more to get the CSV into its cache.
  if (!navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener('controllerchange', load, { once: true });
  navigator.serviceWorker.register('sw.js').catch(() => {}); // app still works online without it
}
load();
