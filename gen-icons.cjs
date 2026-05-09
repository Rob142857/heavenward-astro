const sharp = require("sharp");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" fill="#0a0e1a"/>
  <circle cx="55" cy="40" r="20" fill="#4fc3f7" opacity="0.9"/>
  <circle cx="45" cy="38" r="18" fill="#0a0e1a"/>
  <circle cx="30" cy="25" r="1.5" fill="#e0e6f0"/>
  <circle cx="70" cy="20" r="1" fill="#e0e6f0"/>
  <circle cx="20" cy="60" r="1.2" fill="#e0e6f0"/>
  <circle cx="75" cy="65" r="1" fill="#e0e6f0"/>
  <circle cx="40" cy="75" r="1.3" fill="#e0e6f0"/>
</svg>`;
const buf = Buffer.from(svg);
Promise.all([
  sharp(buf).resize(192, 192).png().toFile("public/icons/icon-192.png"),
  sharp(buf).resize(512, 512).png().toFile("public/icons/icon-512.png"),
]).then(() => console.log("Icons generated"));
