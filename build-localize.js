#!/usr/bin/env node
/**
 * Post-build localization injector
 * Updates index.html to reference the French translation script
 */

const fs = require('fs');
const path = require('path');

const indexHtml = path.join(__dirname, 'index.html');
const localizeJs = path.join(__dirname, 'localize.js');

if (!fs.existsSync(indexHtml)) {
  console.error('index.html not found at:', indexHtml);
  process.exit(1);
}

if (!fs.existsSync(localizeJs)) {
  console.error('localize.js not found at:', localizeJs);
  process.exit(1);
}

console.log('Injecting localize.js reference into index.html...');

let html = fs.readFileSync(indexHtml, 'utf-8');

// Add script tag before </body>
const scriptTag = `\n    <script src="/localize.js" defer></script>
  </body>
</html>`;

if (html.includes('/localize.js')) {
  console.log(' localize.js already included — skipping...');
} else {
  html = html.replace(/<\/body>\s*<\/html>/, scriptTag);
  fs.writeFileSync(indexHtml, html);
  console.log('✓ localize.js injected');
}

console.log('Build localization complete! ☀️');