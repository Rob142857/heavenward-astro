import type { AppContext } from "../types.js";
import { renderHeader, renderNav } from "./layout.js";

export function renderAbout(container: HTMLElement, ctx: AppContext): void {
  container.innerHTML = "";
  renderHeader(container, ctx);
  renderNav("#/about");

  const content = document.createElement("div");
  content.className = "about-page";
  content.innerHTML = `
    <div class="about-hero">
      <h2 class="about-title">Heavenward</h2>
      <p class="about-tagline">Everything visible tonight — one tap away</p>
    </div>

    <div class="about-section">
      <p class="about-prose">
        Heavenward is a free, open-source astronomy companion that tells you exactly what's
        in <em>your</em> sky, right now, from wherever you're standing. No scrolling through
        star charts or fiddling with date pickers — just open the app and see what's up tonight.
      </p>
    </div>

    <div class="about-section">
      <h3 class="about-heading">What You Get</h3>
      <div class="about-features">
        <div class="about-feature">
          <div class="about-feature-icon">🌙</div>
          <div>
            <strong>Planets, Moon &amp; Stars</strong>
            <p>Rise/set times, altitude, magnitude, constellation — all computed live for your GPS location.</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🌌</div>
          <div>
            <strong>Deep Sky Objects</strong>
            <p>Hundreds of galaxies, nebulae, and clusters from a curated catalog with imaging notes and surface brightness.</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">☄️</div>
          <div>
            <strong>Meteor Showers</strong>
            <p>Active shower tracking with ZHR, radiant position, peak dates, and practical observing tips.</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🧭</div>
          <div>
            <strong>Sky Guide</strong>
            <p>Tap any object for compass directions, nearby objects, finder charts, and photography tips — everything you need to point your eyes or your camera.</p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🤖</div>
          <div>
            <strong>AI Commentary</strong>
            <p>Optional on-device AI generates rich, conversational guides to any region of the sky — fascinating facts, observing directions, Wikipedia links, and photography advice. Runs entirely in your browser using WebGPU. No data leaves your device.</p>
          </div>
        </div>
      </div>
    </div>

    <div class="about-section">
      <h3 class="about-heading">Data Sources &amp; Acknowledgements</h3>
      <p class="about-prose">
        Heavenward stands on the shoulders of extraordinary open-source projects and public datasets.
        All astronomy computation runs client-side. We are deeply grateful to the people behind these tools:
      </p>
      <div class="about-features" style="margin-top:16px">
        <div class="about-feature">
          <div class="about-feature-icon">⚙️</div>
          <div>
            <strong><a href="https://github.com/cosinekitty/astronomy" target="_blank" rel="noopener" class="wiki-link">astronomy-engine</a></strong>
            <p>
              Created by <a href="https://github.com/cosinekitty" target="_blank" rel="noopener" class="wiki-link">Don Cross</a>.
              A remarkable, dependency-free library that powers all our planetary ephemeris, rise/set times,
              altitude/azimuth calculations, lunar phases, eclipses, and conjunctions. MIT licensed.
              Thank you, Don — this app would not exist without your work.
            </p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🌌</div>
          <div>
            <strong>Curated DSO Catalog</strong>
            <p>
              Our deep-sky catalog draws from the
              <a href="https://en.wikipedia.org/wiki/Messier_object" target="_blank" rel="noopener" class="wiki-link">Messier catalog</a>,
              <a href="https://en.wikipedia.org/wiki/Caldwell_catalogue" target="_blank" rel="noopener" class="wiki-link">Caldwell catalog</a>,
              and select NGC/IC objects. Physical data sourced from the
              <a href="https://en.wikipedia.org/wiki/NGC/IC_Project" target="_blank" rel="noopener" class="wiki-link">NGC/IC Project</a>
              and <a href="https://cdsarc.cds.unistra.fr/" target="_blank" rel="noopener" class="wiki-link">CDS VizieR</a>.
            </p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">⭐</div>
          <div>
            <strong>Bright Star Catalog</strong>
            <p>
              Navigational and named stars with spectral classifications, based on the
              <a href="https://heasarc.gsfc.nasa.gov/W3Browse/star-catalog/bsc5p.html" target="_blank" rel="noopener" class="wiki-link">Yale Bright Star Catalogue</a>
              and <a href="https://www.iau.org/public/themes/naming_stars/" target="_blank" rel="noopener" class="wiki-link">IAU star names</a>.
              Thank you to the astronomers who have maintained these catalogs for decades.
            </p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">☄️</div>
          <div>
            <strong>IAU Meteor Data Center &amp; IMO</strong>
            <p>
              Shower activity windows, ZHR rates, velocities, and radiant coordinates compiled from the
              IAU Meteor Data Center working list and the
              <a href="https://www.imo.net/resources/meteor-shower-calendar/" target="_blank" rel="noopener" class="wiki-link">International Meteor Organization</a>
              annual calendar — the definitive resources for meteor shower observation worldwide.
            </p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🔭</div>
          <div>
            <strong><a href="https://skyview.gsfc.nasa.gov/" target="_blank" rel="noopener" class="wiki-link">NASA SkyView</a></strong>
            <p>
              DSS2 survey images used for finder chart views. SkyView is developed and maintained at
              NASA's HEASARC. We also use images from
              <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener" class="wiki-link">Wikimedia Commons</a>
              under Creative Commons licenses, with attribution shown per image.
            </p>
          </div>
        </div>
        <div class="about-feature">
          <div class="about-feature-icon">🤖</div>
          <div>
            <strong><a href="https://github.com/mlc-ai/web-llm" target="_blank" rel="noopener" class="wiki-link">WebLLM</a> + <a href="https://huggingface.co/microsoft/Phi-3.5-mini-instruct" target="_blank" rel="noopener" class="wiki-link">Phi-3.5 Mini</a></strong>
            <p>
              Optional on-device AI commentary powered by
              <a href="https://mlc.ai/" target="_blank" rel="noopener" class="wiki-link">MLC AI</a>'s WebLLM runtime
              and Microsoft's Phi-3.5 Mini model. Runs entirely in your browser via WebGPU —
              no data leaves your device. Thank you to the MLC and Microsoft Research teams
              for making local LLM inference accessible to everyone.
            </p>
          </div>
        </div>
      </div>
    </div>

    <div class="about-section">
      <h3 class="about-heading">Privacy</h3>
      <p class="about-prose">
        Your GPS location is used only for astronomical calculations and <strong>never leaves your device</strong>.
        All ephemeris, rise/set, and visibility computations run entirely client-side — no coordinates
        are transmitted to any server, even if you sign in. The AI model also runs entirely in your
        browser via WebGPU — no cloud, no tracking, no data sent anywhere.
      </p>
    </div>

    <div class="about-section">
      <h3 class="about-heading">Source &amp; License</h3>
      <p class="about-prose">
        Heavenward is open source under the
        <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener" class="wiki-link">Apache 2.0 License</a>.
        The source code is available on
        <a href="https://github.com/Rob142857/astroturf" target="_blank" rel="noopener" class="wiki-link">GitHub</a>.
        Contributions, bug reports, and feature ideas are welcome.
      </p>
    </div>

    <div class="about-section about-closing">
      <p class="about-prose about-personal">
        This is the astronomy app I always wanted but could never find — so I made it.
        I hope it helps you see more of the sky, learn something new, and feel a little
        wonder when you look up. Please enjoy. ✨
      </p>
      <p class="about-version">Heavenward v0.1.0</p>
    </div>
  `;
  container.appendChild(content);
}
