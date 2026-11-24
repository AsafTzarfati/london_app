// Paste the Google Sheet "File → Share → Publish to web → (places tab) → CSV" link here.
// Until then the app reads the bundled places.csv.
const CSV_URL = 'places.csv';

// Browser key from Google Cloud, restricted to the site's URL, the Maps JavaScript API and Places API (New).
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

// Routes are built on this phone and travel to the others as a link (no backend).
let routes = JSON.parse(localStorage.getItem('london-routes') || '[]'), routeName = localStorage.getItem('london-route') || '';
let routeLine = [], lineKey = '', routeInfo = '', editing = false;
const NEW_ROUTE = '\u0000new';
const route = () => routes.find(r => r.name === routeName);
const stopsOf = r => (r ? r.stops.map(n => places.find(p => p.name === n)).filter(Boolean) : []);
const saveRoutes = () => { localStorage.setItem('london-routes', JSON.stringify(routes)); localStorage.setItem('london-route', routeName); };

let map = null, info = null, pins = [];
let locating = false, signPlace = null, focusName = null, reframe = false, query = '', fullBtn = null;

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
  await Promise.all(['core', 'maps', 'marker', 'places'].map(lib => google.maps.importLibrary(lib)));
  $('map').textContent = '';
  map = new google.maps.Map($('map'), {
    center: { lat: 51.509, lng: -0.126 }, zoom: 13,
    gestureHandling: 'greedy', // one finger pans: the page itself doesn't scroll
    mapTypeControl: false, streetViewControl: false, fullscreenControl: false,
    cameraControl: false, // its corner belongs to the location button; pinch zooms
  });
  info = new google.maps.InfoWindow();
  map.addListener('zoom_changed', () => pins.forEach(paint));

  // Full-screen map = the sheet lowered to its peek. iPhone Safari has no Fullscreen API.
  fullBtn = el('button', 'מסך מלא', 'map-full-btn');
  fullBtn.type = 'button';
  fullBtn.onclick = () => setSheet(sheetStop === 'peek' ? 'half' : 'peek', true);
  map.controls[google.maps.ControlPosition.TOP_RIGHT].push(fullBtn);
  setSheet(sheetStop);
  render();
  if (route()) fitRoute(); else showOnMap();
};

// The real walking line from Google's Routes API; a dashed straight line when that fails (offline, API off, >25 stops).
async function drawRoute(stops) {
  if (!map) return;
  const pts = stops.filter(p => p.ll).map(p => p.ll);
  const key = JSON.stringify(pts);
  if (key === lineKey) return; // only when the stops change, not on every render
  lineKey = key;
  routeLine.forEach(l => l.setMap(null));
  routeLine = [];
  routeInfo = '';
  if (pts.length > 1) {
    let line = [], text = '';
    try {
      if (pts.length > 27) throw new Error('too many stops');
      const { Route } = await google.maps.importLibrary('routes');
      const { routes: [best] = [] } = await Route.computeRoutes({
        origin: pts[0], destination: pts.at(-1), intermediates: pts.slice(1, -1).map(location => ({ location })),
        travelMode: 'WALKING', fields: ['path', 'distanceMeters', 'durationMillis'],
      });
      if (!best) throw new Error('no route');
      line = best.createPolylines({ polylineOptions: { strokeColor: '#d81e3f', strokeWeight: 5, strokeOpacity: 0.85 } });
      text = `${Math.round(best.durationMillis / 60000)} דק׳ הליכה · ${(best.distanceMeters / 1000).toFixed(1)} ק״מ`;
    } catch {
      line = [new google.maps.Polyline({ path: pts, strokeOpacity: 0,
        icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: '#d81e3f', scale: 3 }, offset: '0', repeat: '12px' }] })];
      text = `${fmtWalk(pts.slice(1).reduce((m, p, i) => m + metres(pts[i], p), 0))} בקו ישר`;
    }
    if (key !== lineKey) return; // the stops changed while Google answered
    routeLine = line;
    routeLine.forEach(l => l.setMap(map));
    routeInfo = text;
  }
  renderRouteBar();
}

// Two frames late: opening or closing the editor resizes the map, and Google must see the new size first.
const fitRoute = () => requestAnimationFrame(() => requestAnimationFrame(() => {
  const pts = stopsOf(route()).filter(p => p.ll);
  if (!map || !pts.length) return;
  map.fitBounds(pts.reduce((b, p) => b.extend(p.ll), new google.maps.LatLngBounds()), 60);
  google.maps.event.addListenerOnce(map, 'idle', () => { if (map.getZoom() > 16) map.setZoom(16); });
}));

// Bottom sheet: three resting places over the map.
const sheet = $('sheet'), sheetBody = $('sheetBody');
const STOPS = ['full', 'half', 'peek'];
let sheetStop = 'half', sheetY = 0, drag = null, settleTimer = 0, sizing = false;
const stopY = s => (s === 'full' ? 0 : s === 'peek' ? sheet.offsetHeight - 96 : Math.round(sheet.offsetHeight / 2));
const placeSheet = y => { sheetY = y; sheet.style.transform = `translateY(${y}px)`; };
// Google's logo and terms must stay visible, so the map ends where the sheet begins.
const sizeMap = h => { $('map').style.height = `${Math.max(120, Math.round(h) + 1)}px`; };

function setSheet(next, animate = false) {
  const y = stopY(next);
  sheetStop = next;
  clearTimeout(settleTimer);
  sheet.classList.toggle('glide', animate);
  sheet.classList.toggle('open', next === 'full');
  if (next !== 'full') sheetBody.scrollTop = 0;
  if (animate) { sizeMap(Math.max(sheetY, y)); settleTimer = setTimeout(() => sizeMap(y), 320); } else sizeMap(y);
  placeSheet(y);
  $('handle').setAttribute('aria-label', next === 'full' ? 'הקטן את הרשימה' : 'הרחב את הרשימה');
  if (fullBtn) fullBtn.textContent = next === 'peek' ? 'הצג רשימה' : 'מסך מלא';
}

sheet.addEventListener('touchstart', e => {
  if (drag) return; // a second finger never takes over
  const t = e.changedTouches[0];
  drag = { id: t.identifier, startY: t.clientY, startTop: sheetY, lastY: t.clientY, lastT: e.timeStamp, v: 0, live: false,
    inList: !!e.target.closest('#sheetBody') };
}, { passive: true });

sheet.addEventListener('touchmove', e => {
  const t = drag && [...e.touches].find(x => x.identifier === drag.id);
  if (!t) return;
  const dy = t.clientY - drag.startY;
  if (!drag.live) {
    const atListTop = !drag.inList || sheetBody.scrollTop <= 0; // the handle always drags the sheet
    if (sheetStop === 'full' && atListTop && dy > 0) e.preventDefault(); // pulling down closes the sheet, not the page
    if (Math.abs(dy) < 6) return;
    if (sheetStop === 'full' && drag.inList && (dy < 0 || !atListTop)) { drag = null; return; } // normal list scrolling
    drag.live = true;
    clearTimeout(settleTimer);
    sheet.classList.remove('glide');
  }
  e.preventDefault();
  drag.v = (t.clientY - drag.lastY) / Math.max(1, e.timeStamp - drag.lastT);
  drag.lastY = t.clientY;
  drag.lastT = e.timeStamp;
  const y = Math.min(stopY('peek'), Math.max(0, drag.startTop + dy));
  placeSheet(y);
  if (!sizing) { sizing = true; requestAnimationFrame(() => { sizing = false; sizeMap(sheetY); }); }
}, { passive: false });

function endDrag(e) {
  if (!drag || ![...e.changedTouches].some(t => t.identifier === drag.id)) return;
  const { live, v } = drag;
  drag = null;
  if (!live) return;
  let next = STOPS.reduce((a, b) => (Math.abs(stopY(b) - sheetY) < Math.abs(stopY(a) - sheetY) ? b : a));
  if (Math.abs(v) > 0.45) { // a flick moves one stop in its direction
    const ahead = STOPS.filter(s => (v > 0 ? stopY(s) > sheetY : stopY(s) < sheetY));
    if (ahead.length) next = v > 0 ? ahead[0] : ahead[ahead.length - 1];
  }
  setSheet(next, true);
}
sheet.addEventListener('touchend', endDrag);
sheet.addEventListener('touchcancel', endDrag);

function focusOnMap(place) {
  focusName = place?.name || null;
  if (sheetStop === 'full') setSheet('half'); // keep the map in view
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
    id: col('place_id'),
  };
  if (i.name < 0) throw new Error('not the places sheet');
  // LRM marks around an en dash between digits: without them RTL shows "10:00–22:00" as "22:00–10:00"
  const get = (r, k) => (r[i[k]] || '').trim().replace(/(\d)–(?=\d)/g, '$1‎–‎');
  return rows.filter(r => get(r, 'name')).map(r => {
    const lat = parseFloat(get(r, 'lat')), lng = parseFloat(get(r, 'lng'));
    return {
      name: get(r, 'name'), cat: get(r, 'cat'), area: get(r, 'area'), pri: get(r, 'pri'), day: get(r, 'day'),
      book: get(r, 'book'), dur: get(r, 'dur'), notes: get(r, 'notes'), id: get(r, 'id'),
      ll: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null, // no coords: listed, not pinned
    };
  });
}

const uniq = key => [...new Set(places.map(p => p[key]).filter(Boolean))];
const dayNum = d => { const m = d.match(/(\d+)\.(\d+)/); return m ? m[2] * 100 + +m[1] : 0; }; // "ו׳ 11.12" -> 1211
const color = p => PIN_COLORS[p.cat] || '#123f31';
const dist = p => (me && p.ll ? metres(me, p.ll) : Infinity);
const inLondon = () => !!me && places.some(p => p.ll && metres(me, p.ll) < 50000);
const nextPlace = () => (route() ? stopsOf(route()).find(p => !done.has(p.name))
  : inLondon() ? visible().find(p => p.ll && !done.has(p.name)) : undefined);
const saveDone = () => localStorage.setItem('london-done', JSON.stringify([...done]));
// With a place ID Google opens the business itself (hours, reviews); coordinates alone open a bare pin.
const navUrl = p => 'https://www.google.com/maps/dir/?api=1&destination=' +
  encodeURIComponent(p.id ? p.name : p.ll ? `${p.ll.lat},${p.ll.lng}` : `${p.name} London`) +
  (p.id ? `&destination_place_id=${encodeURIComponent(p.id)}` : '');

// The place's first Google photo. Fetched live, never stored (Google's terms), and only once its card is on screen.
// ponytail: one Place Details + one photo request per place per page load; watch the Places quota if that adds up
const photos = new Map(); // place ID -> Promise<photo | null>, survives re-renders and the CSV reload
const onScreen = new IntersectionObserver(entries => entries.forEach(e => {
  if (!e.isIntersecting) return;
  onScreen.unobserve(e.target);
  showPhoto(e.target);
}), { rootMargin: '200px' });

async function showPhoto(thumb) {
  const id = thumb.dataset.id;
  if (!photos.has(id)) photos.set(id, new google.maps.places.Place({ id }).fetchFields({ fields: ['photos'] })
    .then(({ place }) => place.photos?.[0] || null).catch(() => null));
  const photo = await photos.get(id);
  if (!photo) return; // no photo or offline: the category icon stays
  const img = document.createElement('img');
  img.alt = '';
  img.src = photo.getURI({ maxWidth: 200, maxHeight: 200 });
  img.onload = () => {
    const by = photo.authorAttributions?.[0];
    const credit = el(by?.uri ? 'a' : 'span', by ? by.displayName : 'Google', 'credit');
    if (by?.uri) { credit.href = by.uri; credit.target = '_blank'; credit.rel = 'noopener'; }
    thumb.removeAttribute('aria-hidden'); // the credit link must stay reachable
    thumb.replaceChildren(img, credit);
  };
}

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
}

function buildRoutes() {
  $('route').replaceChildren(new Option('בלי מסלול', ''), ...routes.map(r => new Option(`מסלול: ${r.name}`, r.name)),
    new Option('+ מסלול חדש…', NEW_ROUTE));
  $('route').value = route() ? routeName : '';
}

function renderRouteBar() {
  const r = route();
  $('routeBar').hidden = !r;
  if (!r) return;
  const n = stopsOf(r).length;
  const meta = [n === 1 ? 'עצירה אחת' : `${n} עצירות`, routeInfo].filter(Boolean).join(' · ');
  $('routeName').textContent = r.name;
  $('routeMeta').textContent = n ? meta : 'אין עדיין עצירות';
  $('edInfo').textContent = n ? meta : 'חפשו מקום או הקישו על סיכה במפה';
  $('routeEdit').setAttribute('aria-label', `ערוך את המסלול ${r.name}`);
  $('routeShare').setAttribute('aria-label', `שתף את המסלול ${r.name}`);
  $('routeDel').setAttribute('aria-label', `מחק את המסלול ${r.name}`);
}

// i = the place's position in the active route; undefined = not a stop.
function card(p, i) {
  const node = $('card').content.firstElementChild.cloneNode(true);
  const isDone = done.has(p.name);
  node.classList.toggle('is-done', isDone);
  if (i !== undefined) node.dataset.n = i + 1;
  node.style.setProperty('--c', color(p));
  const thumb = node.querySelector('.thumb');
  thumb.textContent = icon(p.cat);
  if (p.id && map) { thumb.dataset.id = p.id; onScreen.observe(thumb); }
  node.querySelector('h3').textContent = p.name;
  node.querySelector('.meta').textContent = [p.cat, p.area].filter(Boolean).join(' · ');
  node.querySelector('.notes').textContent = p.notes;
  const nav = node.querySelector('.nav');
  nav.href = navUrl(p);
  nav.setAttribute('aria-label', `נווט אל ${p.name}`);

  if (me && p.ll) {
    const walk = node.querySelector('.walk');
    walk.hidden = false;
    walk.textContent = fmtWalk(dist(p));
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
  return node;
}

// The place's pin and its popup. i = position in the active route (numbered pin); undefined = not a stop.
function pinFor(p, i) {
  if (!p.ll || !map) return;
  const r = route(), isStop = i !== undefined, isDone = done.has(p.name);
  const pop = el('div', '');
  pop.dir = 'auto';
  const link = el('a', 'נווט ↗');
  link.href = navUrl(p); link.target = '_blank'; link.rel = 'noopener';
  pop.append(el('strong', p.name), document.createElement('br'), link);
  if (editing && r) { // the editor: a pin adds or removes its place
    const act = el('button', isStop ? 'הסר מהמסלול' : '+ הוסף למסלול', isStop ? 'pin-act out' : 'pin-act');
    act.type = 'button';
    act.onclick = () => editStops(isStop ? r.stops.filter(n => n !== p.name) : [...r.stops, p.name]);
    pop.append(act);
  }
  // ponytail: classic Marker needs no Cloud map ID; move to AdvancedMarkerElement if Google removes it
  const pin = isStop ? dot(p.ll, color(p), p.name, String(i + 1), isDone ? 0.5 : 1, true)
    : dot(p.ll, color(p), p.name, icon(p.cat), isDone || (r && !editing) ? 0.4 : 1); // a route dims everything else
  p.openPin = () => { info.setContent(pop); info.open({ map, anchor: pin }); };
  pin.addListener('click', p.openPin);
}

// Pins shrink as you zoom out; far out they're plain category-coloured dots so the map stays readable.
const pinSize = zoom => zoom < 12.5 ? { scale: 4 } : zoom < 13.5 ? { scale: 5 } :
  zoom < 14.5 ? { scale: 8, font: 10 } : zoom < 15.5 ? { scale: 10, font: 12 } : { scale: 13, font: 15 };

function paint(pin) {
  const { ring, emoji, stop } = pin.look;
  // my location keeps its size; route stops keep their number at every zoom
  const { scale, font } = !emoji ? { scale: 8 } : stop ? { scale: 12, font: 14 } : pinSize(map.getZoom());
  const withIcon = emoji && font;
  pin.setLabel(withIcon ? { text: emoji, fontSize: `${font}px`, fontWeight: stop ? '700' : '400' } : null);
  if (withIcon) {
    // a white disc with a soft shadow; the classic Marker's vector symbols can't cast one
    const size = scale * 2 + 10, c = size / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><filter id="s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dy="1.5" stdDeviation="1.8" flood-opacity=".32"/></filter></defs><circle cx="${c}" cy="${c}" r="${scale}" fill="#fff" filter="url(#s)"/></svg>`;
    pin.setIcon({
      url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      scaledSize: new google.maps.Size(size, size),
      anchor: new google.maps.Point(c, c),
      labelOrigin: new google.maps.Point(c, c),
    });
  } else {
    pin.setIcon({ path: google.maps.SymbolPath.CIRCLE, scale, fillOpacity: 1, strokeWeight: 1.5, fillColor: ring, strokeColor: '#fff' });
  }
}

function dot(position, ring, title, emoji, opacity = 1, stop = false) {
  const pin = new google.maps.Marker({ map, position, title, opacity, zIndex: stop ? 1000 : undefined });
  pin.look = { ring, emoji, stop };
  paint(pin);
  pins.push(pin);
  return pin;
}

// The filtered places. A route's stops are left out (they have their own numbered pins and cards);
// the editor ignores the main screen's filters, so every place can be added.
function visible() {
  const stops = route()?.stops || [];
  const shown = places.filter(p => !stops.includes(p.name) &&
    (editing || (['cat', 'day', 'pri'].every(k => !filter[k] || p[k] === filter[k]) && matches(p, query))));
  return me ? rankNear(shown, p => done.has(p.name), dist) : shown;
}

function showStatus() {
  if (!loaded && !notice) return;
  const count = route() ? stopsOf(route()).length : visible().length;
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
  $('signLabel').textContent = route() ? 'התחנה הבאה' : 'הכי קרוב עכשיו';
  $('signName').textContent = headline;
  $('signName').classList.toggle('long', headline.length > 20); // keeps the sign from pushing the list off screen
  const d = dist(p); // Infinity before the location is known
  $('signMeta').textContent = [p.cat && `${icon(p.cat)} ${p.cat}`, Number.isFinite(d) && fmtWalk(d)].filter(Boolean).join(' · ');
  $('signNav').href = navUrl(p);
  $('signNav').setAttribute('aria-label', `נווט אל ${p.name}`);
  $('signDone').setAttribute('aria-label', `סמן כבוצע: ${p.name}`);
}

function render() {
  const shown = visible();
  const next = nextPlace();
  const r = route(), stops = stopsOf(r);
  pins.forEach(pin => pin.setMap(null));
  pins = [];
  info?.close();
  stops.forEach((p, i) => pinFor(p, i));
  shown.forEach(p => pinFor(p)); // every place gets its pin, including the one on the sign
  if (me && map) dot(me, '#1a73e8', 'אני כאן');
  // A route lists only its numbered stops, all of them (the next one is on the sign too).
  if (!editing) $('list').replaceChildren(...(r ? stops.map(card) : shown.filter(p => p !== next).map(p => card(p))));
  drawRoute(stops);
  renderRouteBar();
  if (editing) renderEditor();
  renderSign();
  showStatus();
}

// Opening a shared link (#r=…) adds its route to this phone and shows it.
function importLink() {
  const m = location.hash.match(/^#r=([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  const r = decodeRoute(m[1]);
  if (!r) { notice = 'קישור המסלול פגום'; return; }
  routes = [...routes.filter(x => x.name !== r.name), r]; // same name: the link wins
  routeName = r.name;
  saveRoutes();
  notice = 'המסלול נוסף';
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
    if (sheetStop !== 'half') setSheet('half');
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
$('q').oninput = e => {
  query = e.target.value;
  undo = null;
  render();
  if (query && sheetStop !== 'full') setSheet('full', true);
};
$('handle').onclick = () => setSheet(sheetStop === 'half' ? 'full' : 'half', true);
sheetBody.addEventListener('focusin', e => { // keyboard users reach the whole list
  if (sheetStop !== 'full' && e.target.matches(':focus-visible')) setSheet('full', true);
});

const fitLayout = () => {
  document.documentElement.style.setProperty('--top', `${document.querySelector('.top').offsetHeight}px`);
  setSheet(sheetStop);
};
new ResizeObserver(fitLayout).observe(document.querySelector('.top'));
addEventListener('resize', fitLayout);

$('day').onchange = $('pri').onchange = e => { filter[e.target.id] = e.target.value; undo = null; render(); };

function showRoute(name) {
  routeName = name;
  saveRoutes();
  buildRoutes();
  undo = null;
  notice = '';
  render();
  fitRoute();
  if (name && sheetStop === 'peek') setSheet('half', true);
}
$('route').onchange = e => {
  if (e.target.value !== NEW_ROUTE) return showRoute(e.target.value);
  let name = 'מסלול חדש', k = 2; // renamed in the editor's header
  while (routes.some(r => r.name === name)) name = `מסלול חדש ${k++}`;
  routes.push({ name, stops: [] });
  openEditor(name);
  $('edQ').focus(); // an empty route starts from the list of places
};
$('routeEdit').onclick = () => openEditor(routeName);

// ── Route editor: stops on top, the map with the route under them ──
function openEditor(name) {
  routeName = name;
  saveRoutes();
  editing = true;
  document.body.classList.add('editing');
  history.pushState({ editor: true }, ''); // iPhone swipe-back closes the editor, not the app
  render();
  fitRoute();
}

function closeEditor() {
  if (!editing) return;
  editing = false;
  document.body.classList.remove('editing');
  $('edQ').value = '';
  $('edResults').hidden = true;
  buildRoutes();
  render();
  setSheet(sheetStop);
  fitRoute();
}

// Every change saves at once: there's no "save" to forget.
function editStops(stops) {
  const r = route();
  if (!r) return;
  r.stops = stops;
  saveRoutes();
  render();
}

function renderEditor() {
  const r = route();
  if (!r) return;
  if (document.activeElement !== $('edName')) $('edName').value = r.name;
  $('edStops').replaceChildren(...stopsOf(r).map((p, i) => {
    const li = document.createElement('li');
    li.dataset.name = p.name;
    const name = el('span', p.name, 'name');
    name.dir = 'auto';
    name.onclick = () => { if (p.ll && map) { map.panTo(p.ll); p.openPin?.(); } };
    const grip = el('button', '≡', 'grip');
    grip.type = 'button';
    grip.setAttribute('aria-label', `שינוי הסדר של ${p.name}: גררו, או חץ למעלה ולמטה`);
    grip.onpointerdown = e => dragStop(e, li);
    grip.onkeydown = e => {
      const d = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      editStops(moveStop(r.stops, r.stops.indexOf(p.name), d));
      $('edStops').querySelector(`li[data-name="${CSS.escape(p.name)}"] .grip`)?.focus();
    };
    const del = el('button', '✕');
    del.type = 'button';
    del.setAttribute('aria-label', `הסר את ${p.name} מהמסלול`);
    del.onclick = () => editStops(r.stops.filter(n => n !== p.name));
    li.append(el('span', i + 1, 'num'), name, grip, del);
    return li;
  }));
  if (!$('edResults').hidden) showResults();
}

// Drag ≡ to reorder. The row follows the finger, the others slide aside; the order is saved on release.
function dragStop(e, li) {
  if (e.button > 0) return;
  e.preventDefault();
  const grip = e.currentTarget, rows = [...$('edStops').children];
  const from = rows.indexOf(li), h = li.offsetHeight, startY = e.clientY;
  let to = from;
  grip.setPointerCapture(e.pointerId);
  li.classList.add('dragging');
  const move = ev => {
    const dy = ev.clientY - startY;
    li.style.transform = `translateY(${dy}px)`;
    to = Math.min(rows.length - 1, Math.max(0, from + Math.round(dy / h)));
    rows.forEach((x, k) => {
      if (x === li) return;
      const shift = from < to && k > from && k <= to ? -h : from > to && k < from && k >= to ? h : 0;
      x.style.transform = shift ? `translateY(${shift}px)` : '';
    });
  };
  const end = () => {
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    rows.forEach(x => { x.style.transform = ''; });
    li.classList.remove('dragging');
    if (to === from) return;
    const names = rows.map(x => x.dataset.name);
    names.splice(to, 0, ...names.splice(from, 1));
    editStops(names);
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

// "Add stop": the saved places not in the route yet, nearest to the last stop first (routes are walked).
function showResults() {
  const r = route();
  if (!r) return;
  const last = stopsOf(r).filter(p => p.ll).at(-1);
  const from = p => (last && p.ll ? metres(last.ll, p.ll) : Infinity);
  const found = places.filter(p => !r.stops.includes(p.name) && matches(p, $('edQ').value))
    .sort((a, b) => from(a) - from(b) || 0);
  $('edResults').hidden = false;
  $('edResults').replaceChildren(...(found.length ? found.map(p => {
    const b = document.createElement('button');
    b.type = 'button';
    const txt = el('span', '', 'txt');
    const name = el('strong', p.name);
    name.dir = 'auto';
    const away = from(p);
    txt.append(name, el('small', [p.cat, p.area, Number.isFinite(away) && fmtWalk(away)].filter(Boolean).join(' · ')));
    b.append(el('span', icon(p.cat), 'ico'), txt);
    b.onclick = () => {
      $('edQ').value = '';
      $('edQ').blur();
      editStops([...r.stops, p.name]);
      fitRoute();
    };
    const li = document.createElement('li');
    li.append(b);
    return li;
  }) : [el('li', 'אין מקום כזה ברשימה', 'empty')]));
}

$('edQ').onfocus = $('edQ').oninput = showResults;
$('edQ').onblur = () => { $('edResults').hidden = true; };
$('edQ').onkeydown = e => { if (e.key === 'Escape') $('edQ').blur(); };
$('edResults').onpointerdown = e => e.preventDefault(); // keeps the box focused, so the tap lands on the result
$('edName').onchange = () => {
  const r = route(), name = $('edName').value.trim().slice(0, 60);
  if (r && name && !routes.some(x => x !== r && x.name === name)) { r.name = routeName = name; saveRoutes(); }
  $('edName').value = route()?.name || ''; // empty or taken: back to the old name
};
$('edName').onkeydown = e => { if (e.key === 'Enter') $('edName').blur(); };
$('edBack').onclick = () => (history.state?.editor ? history.back() : closeEditor());
addEventListener('popstate', closeEditor);
new ResizeObserver(() => document.documentElement.style.setProperty('--etop', `${$('editor').offsetHeight}px`)).observe($('editor'));
$('routeShare').onclick = async () => {
  const r = route();
  if (!r) return;
  const url = `${location.origin}${location.pathname}#r=${encodeRoute(r)}`;
  try {
    if (navigator.share) return void await navigator.share({ title: r.name, url });
    await navigator.clipboard.writeText(url);
    notice = 'הקישור למסלול הועתק';
    showStatus();
  } catch (err) {
    if (err.name !== 'AbortError') prompt('העתיקו את הקישור למסלול:', url); // share sheet closed = AbortError
  }
};
$('routeDel').onclick = () => {
  const r = route();
  if (!r || !confirm(`למחוק את המסלול "${r.name}"? המקומות עצמם נשארים.`)) return;
  routes = routes.filter(x => x !== r);
  showRoute('');
};
addEventListener('hashchange', () => { importLink(); buildRoutes(); render(); fitRoute(); });
addEventListener('online', () => { load(); loadMap(); });
addEventListener('offline', render);

if ('serviceWorker' in navigator) {
  // First visit: the page loads before the worker controls it, so fetch once more to get the CSV into its cache.
  // Later: a new worker means a new version was deployed, so reload onto it instead of showing the old one.
  const update = navigator.serviceWorker.controller ? () => location.reload() : load;
  navigator.serviceWorker.addEventListener('controllerchange', update, { once: true });
  navigator.serviceWorker.register('sw.js').catch(() => {}); // app still works online without it
}
importLink();
buildRoutes();
fitLayout();
renderSign();
load();
loadMap();
