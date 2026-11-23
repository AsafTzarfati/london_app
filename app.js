// Paste the Google Sheet "File → Share → Publish to web → (places tab) → CSV" link here.
// Until then the app reads the bundled places.csv.
const CSV_URL = 'places.csv';

// Browser key from Google Cloud, restricted to the site's URL and to the Maps JavaScript API.
// Empty = Google's "for development purposes only" map.
const GOOGLE_MAPS_KEY = 'AIzaSyCuaFAjkEVs484S_EaapYjgq1AQCFSxenE';

// Pin colours from the market and the city: baked crust, roasted coffee, pillar box, Thames, beetroot.
const PIN_COLORS = { 'מאפים וקינוחים': '#c98a12', 'קפה ותה': '#6f4a2f', 'אוכל': '#b3202a', 'קניות': '#2c5a70', 'שווקים ואזורים': '#6a3557' };

const ICONS = { 'מאפים וקינוחים': '🧁', 'קפה ותה': '☕', 'אוכל': '🍜', 'קניות': '🛍️', 'שווקים ואזורים': '🎪' };
const icon = cat => ICONS[cat] || '📍';

const $ = id => document.getElementById(id);
const done = new Set(JSON.parse(localStorage.getItem('london-done') || '[]')); // keyed by place name: rows get reordered
const filter = { cat: '', day: '', pri: '' };
let places = [], cats = [], me = null, loaded = false;
let notice = '', undo = null; // status-line message; the place just marked done

let map = null, info = null, pins = [];
let locating = false, signPlace = null, focusName = null, reframe = false;

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
    cameraControl: false, // its corner belongs to the location button; pinch zooms
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
  showOnMap();
};

function focusOnMap(place) {
  focusName = place?.name || null;
  scrollTo({ top: 0, behavior: 'smooth' }); // the map sits above the list
  showOnMap();
}

function showOnMap() {
  if (!map) return;
  requestAnimationFrame(() => {
    const place = focusName && places.find(p => p.name === focusName);
    focusName = null;
    if (place?.ll) {
      map.setCenter(place.ll);
      map.setZoom(Math.max(map.getZoom(), 15));
      place.openPin?.();
    } else if (reframe && me) {
      reframe = false;
      const next = nextPlace();
      if (!next) { map.panTo(me); if (!inLondon()) map.setZoom(14); return; }
      map.fitBounds(new google.maps.LatLngBounds().extend(me).extend(next.ll), 60);
      google.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); });
    }
  });
}
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
const color = p => PIN_COLORS[p.cat] || '#123f31';
const dist = p => (me && p.ll ? metres(me, p.ll) : Infinity);
const inLondon = () => !!me && places.some(p => p.ll && metres(me, p.ll) < 50000);
const nextPlace = () => (inLondon() ? visible().find(p => p.ll && !done.has(p.name)) : undefined);
const saveDone = () => localStorage.setItem('london-done', JSON.stringify([...done]));
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
    b.onclick = () => { filter.cat = filter.cat === value ? '' : value; undo = null; buildFilters(); render(); };
    return b;
  };
  if (!cats.includes(filter.cat)) filter.cat = '';
  $('cats').replaceChildren(chip('הכל', ''), ...cats.map(c => chip(`${icon(c)} ${c}`, c)));

  const fill = (key, all, values) => {
    $(key).hidden = !hasChoice(places, key);
    if ($(key).hidden || !values.includes(filter[key])) filter[key] = ''; // a hidden filter must not keep filtering
    $(key).replaceChildren(new Option(all, ''), ...values.map(v => new Option(v, v)));
    $(key).value = filter[key];
  };
  fill('day', 'כל הימים', uniq('day').sort((a, b) => dayNum(a) - dayNum(b)));
  fill('pri', 'כל העדיפויות', uniq('pri'));
  document.querySelector('.selects').hidden = $('day').hidden && $('pri').hidden;
}

function card(p) {
  const node = $('card').content.firstElementChild.cloneNode(true);
  const isDone = done.has(p.name);
  node.classList.toggle('is-done', isDone);
  node.querySelector('h3').textContent = p.name;
  node.querySelector('.meta').textContent = [p.cat && `${icon(p.cat)} ${p.cat}`, p.area].filter(Boolean).join(' · ');
  node.querySelector('.notes').textContent = p.notes;
  const nav = node.querySelector('.nav');
  nav.href = navUrl(p);
  nav.setAttribute('aria-label', `נווט אל ${p.name}`);

  if (me && p.ll) {
    const [value, unit] = walkParts(dist(p));
    const num = node.querySelector('.num');
    num.hidden = false;
    num.classList.toggle('wide', String(value).length > 3);
    num.append(String(value), el('small', unit));
  }

  const tags = node.querySelector('.tags');
  if (p.pri) tags.append(el('span', p.pri, p.pri === 'חובה' ? 'tag must' : 'tag'));
  if (p.day) tags.append(el('span', p.day, 'tag'));
  if (p.book === 'כן') tags.append(el('span', '🎟 להזמין מראש', 'tag book'));
  if (p.dur) tags.append(el('span', `⏱ ${p.dur}`, 'tag'));

  const box = node.querySelector('input');
  box.checked = isDone;
  box.setAttribute('aria-label', `בוצע: ${p.name}`);
  box.onchange = () => {
    done[box.checked ? 'add' : 'delete'](p.name);
    saveDone();
    undo = box.checked ? p.name : null; // near-me sorting moves the card away, so offer the way back
    render();
  };

  if (p.ll) node.querySelector('.body').onclick = () => focusOnMap(p);
  if (p.ll && map) {
    const pop = el('div', '');
    pop.dir = 'auto';
    const link = el('a', 'נווט ↗');
    link.href = navUrl(p); link.target = '_blank'; link.rel = 'noopener';
    pop.append(el('strong', p.name), document.createElement('br'), link);
    // ponytail: classic Marker needs no Cloud map ID; move to AdvancedMarkerElement if Google removes it
    const pin = dot(p.ll, color(p), p.name, icon(p.cat), isDone ? 0.4 : 1);
    p.openPin = () => { info.setContent(pop); info.open({ map, anchor: pin }); };
    pin.addListener('click', p.openPin);
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

function visible() {
  const shown = places.filter(p => ['cat', 'day', 'pri'].every(k => !filter[k] || p[k] === filter[k]));
  return me ? rankNear(shown, p => done.has(p.name), dist) : shown;
}

function showStatus() {
  if (!loaded && !notice) return;
  const count = visible().length;
  $('status').replaceChildren([
    notice,
    loaded && (count > 1 ? `${count} מקומות` : count ? 'מקום אחד' : 'אין מקומות שתואמים לסינון'),
    loaded && `${places.filter(p => done.has(p.name)).length} בוצעו`,
    loaded && !navigator.onLine && 'אופליין – נתונים שמורים',
  ].filter(Boolean).join(' · '));
  if (!undo) return;
  const back = el('button', 'בטל סימון', 'undo');
  back.type = 'button';
  back.setAttribute('aria-label', `בטל סימון של ${undo}`);
  back.onclick = () => { done.delete(undo); saveDone(); undo = null; render(); };
  $('status').append(' ', back);
}

function renderSign() {
  const p = signPlace = nextPlace();
  $('near').disabled = locating;
  $('near').classList.toggle('locating', locating);
  $('near').classList.toggle('found', !!me);
  $('sign').hidden = !p;
  if (!p) return;
  const headline = p.name.split(' - ')[0];
  $('signName').textContent = headline;
  $('signName').classList.toggle('long', headline.length > 20); // keeps the sign from pushing the list off screen
  $('signMeta').textContent = [p.cat && `${icon(p.cat)} ${p.cat}`, fmtWalk(dist(p))].filter(Boolean).join(' · ');
  $('signNav').href = navUrl(p);
  $('signNav').setAttribute('aria-label', `נווט אל ${p.name}`);
  $('signDone').setAttribute('aria-label', `סמן כבוצע: ${p.name}`);
}

function render() {
  const shown = visible();
  const next = nextPlace();
  pins.forEach(pin => pin.setMap(null));
  pins = [];
  info?.close();
  const nodes = shown.map(card); // every place gets its pin, including the one on the sign
  $('list').replaceChildren(...nodes.filter((_, i) => shown[i] !== next));
  if (me && map) dot(me, '#1a73e8', 'אני כאן');
  renderSign();
  showStatus();
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
  undo = null;
  if (!navigator.geolocation) { notice = 'הדפדפן לא תומך במיקום'; return showStatus(); }
  locating = true;
  notice = 'מאתר מיקום…';
  renderSign();
  showStatus();
  navigator.geolocation.getCurrentPosition(pos => {
    locating = false;
    me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    notice = inLondon() ? '' : 'רחוק מלונדון, הרשימה לפי מרחק';
    reframe = true;
    render();
    scrollTo(0, 0);
    showOnMap();
  }, err => {
    locating = false;
    notice = err.code === 1
      ? 'אין הרשאת מיקום. טענו מחדש ואשרו, או בדקו בהגדרות האייפון'
      : 'לא הצלחתי לאתר מיקום. נסו שוב בעוד רגע';
    renderSign();
    showStatus();
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
};

$('signDone').onclick = () => {
  if (!signPlace) return;
  done.add(signPlace.name);
  saveDone();
  undo = signPlace.name;
  render();
};
$('signMap').onclick = () => focusOnMap(signPlace);

$('day').onchange = $('pri').onchange = e => { filter[e.target.id] = e.target.value; undo = null; render(); };
addEventListener('online', () => { load(); loadMap(); });
addEventListener('offline', render);

if ('serviceWorker' in navigator) {
  // First visit: the page loads before the worker controls it, so fetch once more to get the CSV into its cache.
  // Later: a new worker means a new version was deployed, so reload onto it instead of showing the old one.
  const update = navigator.serviceWorker.controller ? () => location.reload() : load;
  navigator.serviceWorker.addEventListener('controllerchange', update, { once: true });
  navigator.serviceWorker.register('sw.js').catch(() => {}); // app still works online without it
}
renderSign();
load();
loadMap();
