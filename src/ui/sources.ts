import type { AppContext } from '../types.js';
import { loadPrefs, savePrefs } from '../services/prefs.js';
import { renderHeader, renderNav } from './layout.js';

const SOURCES = [
  { key: 'planets', label: 'Planets' },
  { key: 'moon', label: 'Moon' },
  { key: 'dso', label: 'Deep Sky Objects' },
  { key: 'meteors', label: 'Meteor Showers' },
  { key: 'eclipses', label: 'Eclipses' },
  { key: 'conjunctions', label: 'Conjunctions' },
];

export function renderSources(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = '';
  renderHeader(container, ctx);
  renderNav('#/sources');

  const title = document.createElement('h3');
  title.className = 'section-title';
  title.textContent = 'Data Sources';
  container.appendChild(title);

  const prefs = loadPrefs();

  for (const src of SOURCES) {
    const row = document.createElement('div');
    row.className = 'toggle-row';
    row.innerHTML = `
      <span class="toggle-label">${src.label}</span>
      <label class="toggle">
        <input type="checkbox" ${prefs.enabledSources.includes(src.key) ? 'checked' : ''} data-source="${src.key}">
        <span class="slider"></span>
      </label>
    `;
    const input = row.querySelector('input')!;
    input.addEventListener('change', () => {
      const current = loadPrefs();
      if (input.checked) {
        if (!current.enabledSources.includes(src.key)) {
          current.enabledSources.push(src.key);
        }
      } else {
        current.enabledSources = current.enabledSources.filter((s) => s !== src.key);
      }
      savePrefs(current);
      ctx.prefs = current;
    });
    container.appendChild(row);
  }

  // Magnitude limit
  const magSection = document.createElement('h3');
  magSection.className = 'section-title';
  magSection.textContent = 'Magnitude Limit';
  container.appendChild(magSection);

  const magRow = document.createElement('div');
  magRow.className = 'toggle-row';
  magRow.innerHTML = `
    <span class="toggle-label">Show objects up to mag</span>
    <input type="number" class="input" style="width:80px" value="${prefs.magnitudeLimit}" min="1" max="15" step="0.5">
  `;
  const magInput = magRow.querySelector('input')!;
  magInput.addEventListener('change', () => {
    const current = loadPrefs();
    current.magnitudeLimit = parseFloat(magInput.value) || 6.0;
    savePrefs(current);
    ctx.prefs = current;
  });
  container.appendChild(magRow);
}
