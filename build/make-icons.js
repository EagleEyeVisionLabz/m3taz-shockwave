// One-shot icon generator. Run: node build/make-icons.js
// Produces Mac-style squircle-masked icon.png + per-size PNGs, then
// the caller assembles .icns/.ico from these.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, 'icon-source.png');
const BUILD = __dirname;

// macOS Big Sur+ app icon spec: 1024 canvas, 824 squircle artwork, 100 padding, radius 185.
const CANVAS = 1024;
const ART = 824;
const PAD = (CANVAS - ART) / 2;
const RADIUS = 185;

function squircleSvg(size, x, y, w, h, r) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#fff"/>
     </svg>`
  );
}

async function buildMaster() {
  const art = await sharp(SRC).resize(ART, ART, { fit: 'cover' }).png().toBuffer();
  const canvas = await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: art, top: PAD, left: PAD }])
    .png()
    .toBuffer();
  const mask = squircleSvg(CANVAS, PAD, PAD, ART, ART, RADIUS);
  const masked = await sharp(canvas)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(BUILD, 'icon.png'), masked);
  return masked;
}

async function buildSizes(master) {
  const macSizes = [
    { size: 16, name: 'icon_16x16.png' },
    { size: 32, name: 'icon_16x16@2x.png' },
    { size: 32, name: 'icon_32x32.png' },
    { size: 64, name: 'icon_32x32@2x.png' },
    { size: 128, name: 'icon_128x128.png' },
    { size: 256, name: 'icon_128x128@2x.png' },
    { size: 256, name: 'icon_256x256.png' },
    { size: 512, name: 'icon_256x256@2x.png' },
    { size: 512, name: 'icon_512x512.png' },
    { size: 1024, name: 'icon_512x512@2x.png' },
  ];
  const iconset = path.join(BUILD, 'icon.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset, { recursive: true });
  for (const { size, name } of macSizes) {
    await sharp(master).resize(size, size).png().toFile(path.join(iconset, name));
  }

  // Linux: same masked image at 512.
  await sharp(master).resize(512, 512).png().toFile(path.join(BUILD, 'icon-linux.png'));

  // Windows ICO sources at multiple sizes (no mask — Windows uses its own rendering).
  const winSrc = path.join(BUILD, 'ico-src');
  fs.rmSync(winSrc, { recursive: true, force: true });
  fs.mkdirSync(winSrc, { recursive: true });
  for (const s of [16, 24, 32, 48, 64, 128, 256]) {
    await sharp(master).resize(s, s).png().toFile(path.join(winSrc, `${s}.png`));
  }
}

async function buildIco() {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map((s) => ({
    size: s,
    data: fs.readFileSync(path.join(BUILD, 'ico-src', `${s}.png`)),
  }));
  const count = pngs.length;
  const headerSize = 6 + count * 16;
  let offset = headerSize;
  const entries = Buffer.alloc(headerSize);
  entries.writeUInt16LE(0, 0);
  entries.writeUInt16LE(1, 2);
  entries.writeUInt16LE(count, 4);
  for (let i = 0; i < count; i++) {
    const { size, data } = pngs[i];
    const base = 6 + i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, base + 0);
    entries.writeUInt8(size >= 256 ? 0 : size, base + 1);
    entries.writeUInt8(0, base + 2);
    entries.writeUInt8(0, base + 3);
    entries.writeUInt16LE(1, base + 4);
    entries.writeUInt16LE(32, base + 6);
    entries.writeUInt32LE(data.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += data.length;
  }
  const out = Buffer.concat([entries, ...pngs.map((p) => p.data)]);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), out);
}

(async () => {
  const master = await buildMaster();
  await buildSizes(master);
  await buildIco();
  console.log('icons written:');
  console.log('  build/icon.png (mac/dev runtime, 1024 squircle)');
  console.log('  build/icon.iconset/ (for iconutil → icns)');
  console.log('  build/icon-linux.png (512)');
  console.log('  build/icon.ico (multi-size)');
})();
