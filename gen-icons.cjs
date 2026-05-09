const sharp = require("sharp");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#c5a44e"/>
      <stop offset="50%" stop-color="#f5e6a3"/>
      <stop offset="100%" stop-color="#d4af37"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="50" r="50" fill="#0a0e1a"/>
  <g transform="translate(50,50)" fill="url(#g)">
    <circle r="5"/>
    <path d="M0,-8Q-4.5,-22 0,-40Q4.5,-22 0,-8Z"/>
    <path d="M0,-8Q-4.5,-22 0,-40Q4.5,-22 0,-8Z" transform="rotate(72)"/>
    <path d="M0,-8Q-4.5,-22 0,-40Q4.5,-22 0,-8Z" transform="rotate(144)"/>
    <path d="M0,-8Q-4.5,-22 0,-40Q4.5,-22 0,-8Z" transform="rotate(216)"/>
    <path d="M0,-8Q-4.5,-22 0,-40Q4.5,-22 0,-8Z" transform="rotate(288)"/>
  </g>
</svg>`;
const buf = Buffer.from(svg);
Promise.all([
  sharp(buf).resize(192, 192).png().toFile('public/icons/icon-192.png'),
  sharp(buf).resize(512, 512).png().toFile('public/icons/icon-512.png'),
]).then(() => console.log('Seba icons generated'));
