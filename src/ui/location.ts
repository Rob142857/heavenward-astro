import type { AppContext } from '../types.js';
import { requestGPS, saveLocation } from '../services/geolocation.js';
import { renderHeader, renderNav } from './layout.js';
import { navigate } from './router.js';

export function renderLocation(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = '';
  renderHeader(container, ctx);
  renderNav('#/location');

  const title = document.createElement('h3');
  title.className = 'section-title';
  title.textContent = 'Location';
  container.appendChild(title);

  // GPS button
  const gpsBtn = document.createElement('button');
  gpsBtn.className = 'btn btn-primary btn-block';
  gpsBtn.textContent = '📍 Use GPS Location';
  gpsBtn.addEventListener('click', async () => {
    gpsBtn.textContent = 'Locating…';
    gpsBtn.disabled = true;
    try {
      const loc = await requestGPS();
      ctx.location = loc;
      navigate('#/');
    } catch {
      gpsBtn.textContent = 'GPS failed — try manual entry';
      gpsBtn.disabled = false;
    }
  });
  container.appendChild(gpsBtn);

  // Manual entry
  const manualSection = document.createElement('h3');
  manualSection.className = 'section-title';
  manualSection.textContent = 'Manual Entry';
  container.appendChild(manualSection);

  const form = document.createElement('div');
  form.style.display = 'flex';
  form.style.flexDirection = 'column';
  form.style.gap = '8px';
  form.innerHTML = `
    <input class="input" type="number" id="lat" placeholder="Latitude" value="${ctx.location.lat}" step="0.01" min="-90" max="90">
    <input class="input" type="number" id="lon" placeholder="Longitude" value="${ctx.location.lon}" step="0.01" min="-180" max="180">
    <input class="input" type="number" id="elev" placeholder="Elevation (m)" value="${ctx.location.elev}" step="1" min="0">
    <button class="btn btn-outline btn-block" id="save-loc">Save Location</button>
  `;
  container.appendChild(form);

  form.querySelector('#save-loc')!.addEventListener('click', () => {
    const lat = parseFloat((form.querySelector('#lat') as HTMLInputElement).value);
    const lon = parseFloat((form.querySelector('#lon') as HTMLInputElement).value);
    const elev = parseFloat((form.querySelector('#elev') as HTMLInputElement).value) || 0;
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    const loc = { lat, lon, elev };
    saveLocation(loc);
    ctx.location = loc;
    navigate('#/');
  });
}
