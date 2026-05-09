import type { AppContext, CelestialEvent } from '../types.js';
import { getPlanetEvents, getMoonEvent, getAltAzForRaDec } from '../engine/astro.js';
import { loadDSOCatalog } from '../catalog/dso.js';
import { METEOR_SHOWERS } from '../catalog/meteors.js';
import { renderHeader, renderNav } from './layout.js';
import { renderFinderChart } from '../chart/finder.js';

function renderEventDetail(container: HTMLElement, ctx: AppContext, event: CelestialEvent): void {
  container.innerHTML = '';
  renderHeader(container, ctx);
  renderNav('#/');

  const content = document.createElement('div');
  content.innerHTML = `
    <a href="#/" class="detail-back">← Tonight</a>
    <h2 class="detail-title">${event.name}</h2>
    <p class="detail-brief">${event.brief}</p>
    <div class="detail-grid">
      ${detailItem('Altitude', event.altitude !== null ? `${event.altitude.toFixed(1)}°` : '—')}
      ${detailItem('Azimuth', event.azimuth !== null ? `${event.azimuth.toFixed(0)}°` : '—')}
      ${detailItem('Magnitude', event.magnitude !== null ? event.magnitude.toFixed(1) : '—')}
      ${detailItem('Constellation', event.constellation ?? '—')}
      ${event.rise ? detailItem('Rise', fmtTime(event.rise)) : ''}
      ${event.set ? detailItem('Set', fmtTime(event.set)) : ''}
      ${event.transit ? detailItem('Transit', fmtTime(event.transit)) : ''}
      ${event.distanceAU !== null ? detailItem('Distance', `${event.distanceAU.toFixed(3)} AU`) : ''}
      ${event.illumination !== null ? detailItem('Phase', `${(event.illumination * 100).toFixed(0)}%`) : ''}
      ${event.angularSize !== null ? detailItem('Size', `${event.angularSize.toFixed(1)}'`) : ''}
    </div>
  `;
  container.appendChild(content);

  // Finder chart canvas
  if (event.ra !== null && event.dec !== null) {
    const chartDiv = document.createElement('div');
    chartDiv.className = 'chart-container';
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    chartDiv.appendChild(canvas);
    container.appendChild(chartDiv);
    renderFinderChart(canvas, event.ra, event.dec, event.name);

    // SkyView image
    const img = document.createElement('img');
    img.className = 'skyview-img skeleton';
    img.alt = `SkyView image of ${event.name}`;
    img.loading = 'lazy';
    img.src = `https://skyview.gsfc.nasa.gov/current/cgi/runquery.pl?Position=${event.ra},${event.dec}&Survey=DSS2+Red&Size=0.5&Pixels=300&Return=PNG`;
    img.onload = () => img.classList.remove('skeleton');
    container.appendChild(img);
  }
}

export function renderDetail(container: HTMLElement, ctx: AppContext, eventId: string): void {
  const now = new Date();
  const event = findEvent(ctx, eventId, now);
  if (!event) {
    container.innerHTML = '';
    renderHeader(container, ctx);
    renderNav('#/');
    container.innerHTML += '<p style="padding:20px;color:var(--text-dim)">Event not found.</p>';
    return;
  }
  renderEventDetail(container, ctx, event);
}

export async function renderDSODetail(container: HTMLElement, ctx: AppContext, dsoId: string): Promise<void> {
  // Show loading state
  container.innerHTML = '';
  renderHeader(container, ctx);
  renderNav('#/');
  container.innerHTML += '<p style="padding:20px;color:var(--text-dim)">Loading…</p>';

  const catalog = await loadDSOCatalog();
  const raw = dsoId.replace('dso-', '');
  const entry = catalog.find((d) => d.id === raw);
  if (!entry) {
    container.innerHTML = '';
    renderHeader(container, ctx);
    renderNav('#/');
    container.innerHTML += '<p style="padding:20px;color:var(--text-dim)">Object not found.</p>';
    return;
  }
  const now = new Date();
  const hor = getAltAzForRaDec(entry.ra, entry.dec, ctx.location, now);
  const event: CelestialEvent = {
    id: dsoId, name: entry.commonName || entry.name, type: 'dso', source: 'catalog',
    brief: `${entry.type} · Mag ${entry.magnitude.toFixed(1)} in ${entry.constellation}`,
    rise: null, set: null, transit: null,
    altitude: hor.altitude, azimuth: hor.azimuth,
    magnitude: entry.magnitude, constellation: entry.constellation,
    illumination: null, ra: entry.ra, dec: entry.dec,
    angularSize: entry.size, distanceAU: null,
    extra: { catalogType: entry.type, size: entry.size },
  };
  renderEventDetail(container, ctx, event);
}

function findEvent(ctx: AppContext, id: string, date: Date): CelestialEvent | null {
  if (id === 'moon') return getMoonEvent(ctx.location, date);
  if (id.startsWith('planet-')) {
    const planets = getPlanetEvents(ctx.location, date);
    return planets.find((p) => p.id === id) ?? null;
  }
  if (id.startsWith('meteor-')) {
    const sid = id.replace('meteor-', '');
    const shower = METEOR_SHOWERS.find((s) => s.id === sid);
    if (!shower) return null;
    const hor = getAltAzForRaDec(shower.radiantRA, shower.radiantDec, ctx.location, date);
    return {
      id, name: shower.name, type: 'meteor-shower', source: 'catalog',
      brief: `ZHR ${shower.zhr} · ${shower.speed} km/s`,
      rise: null, set: null, transit: null,
      altitude: hor.altitude, azimuth: hor.azimuth,
      magnitude: null, constellation: null, illumination: null,
      ra: shower.radiantRA, dec: shower.radiantDec,
      angularSize: null, distanceAU: null,
      extra: { zhr: shower.zhr, parentBody: shower.parentBody },
    };
  }
  return null;
}

function detailItem(label: string, value: string): string {
  return `<div class="detail-item"><div class="label">${label}</div><div class="value">${value}</div></div>`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
