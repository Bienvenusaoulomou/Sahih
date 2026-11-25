// Sahih — image fingerprints for signed posters (runs in the browser, no dependency)
//  • dhash: 64-bit perceptual hash, survives resizing and recompression (WhatsApp, Facebook…)
//  • compare: aligns a received image on the official one and finds the zones that differ
//  • stamp: adds the "signed on Hedera" band (QR code + SAH code) under a poster
(function () {
  const BAND = 0.16; // band height = 16 % of the image width (kept when networks resize the image)

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Image illisible. Utilisez un fichier JPG, PNG ou WEBP."));
      if (src instanceof Blob) img.src = URL.createObjectURL(src); else img.src = src;
    });
  }
  function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }

  // Region of an image (sx, sy, sw, sh) drawn at w x h, as grayscale floats
  function gray(img, w, h, region) {
    const r = region || { x: 0, y: 0, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height };
    // downscale in steps so small sizes stay faithful
    let src = img, sx = r.x, sy = r.y, sw = r.w, sh = r.h;
    while (sw / 2 > w * 2 && sh / 2 > h * 2) {
      const c = canvas(Math.round(sw / 2), Math.round(sh / 2));
      const x = c.getContext("2d"); x.imageSmoothingQuality = "high";
      x.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
      src = c; sx = 0; sy = 0; sw = c.width; sh = c.height;
    }
    const c = canvas(w, h), x = c.getContext("2d");
    x.imageSmoothingQuality = "high";
    x.fillStyle = "#fff"; x.fillRect(0, 0, w, h);
    x.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data, g = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return g;
  }

  function dhash(img, region) {
    const g = gray(img, 9, 8, region);
    let bits = "";
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x] < g[y * 9 + x + 1] ? "1" : "0";
    let hex = "";
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }
  function hamming(a, b) {
    let n = 0;
    for (let i = 0; i < 16; i++) { let v = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (v) { n += v & 1; v >>= 1; } }
    return n;
  }

  const size = (img) => ({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height });
  const bandHeight = (w) => Math.round(w * BAND);

  // Fingerprints of a received image: as is, and without the Sahih band (if it carries one)
  function variants(img) {
    const { w, h } = size(img);
    const out = [{ crop: 0, dhash: dhash(img) }];
    const b = bandHeight(w);
    if (h - b > w * 0.3) out.push({ crop: b, dhash: dhash(img, { x: 0, y: 0, w, h: h - b }) });
    return out;
  }

  function blur(g, w, h, passes = 1) { // 3x3 box blur
    let a = g;
    for (let pass = 0; pass < passes; pass++) {
      const o = new Float32Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && yy < h && xx >= 0 && xx < w) { s += a[yy * w + xx]; n++; }
        }
        o[y * w + x] = s / n;
      }
      a = o;
    }
    return a;
  }
  function zscore(g) {
    let m = 0; for (const v of g) m += v; m /= g.length;
    let s = 0; for (const v of g) s += (v - m) * (v - m); s = Math.sqrt(s / g.length) || 1;
    return g.map((v) => (v - m) / s);
  }

  // Compare a received image (optionally without its band) to the official one.
  // Returns the changed zones as rectangles in % of the compared area.
  function compare(official, received, crop, opt = {}) {
    const o = size(official), r = size(received);
    const W = opt.W || 720, H = Math.max(40, Math.round((W * o.h) / o.w));
    const region = { x: 0, y: 0, w: r.w, h: r.h - (crop || 0) };
    const aspectGap = Math.abs(region.h / region.w - o.h / o.w) / (o.h / o.w);
    const A = zscore(blur(gray(official, W, H), W, H, opt.blur ?? 1));
    const B = zscore(blur(gray(received, W, H, region), W, H, opt.blur ?? 1));
    const C = opt.C || 24, cols = Math.ceil(W / C), rows = Math.ceil(H / C);
    const cells = [], all = [];
    let total = 0;
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      let s = 0, n = 0, peak = 0;
      for (let y = cy * C; y < Math.min(H, (cy + 1) * C); y++) for (let x = cx * C; x < Math.min(W, (cx + 1) * C); x++) {
        const d = Math.abs(A[y * W + x] - B[y * W + x]); s += d; n++; if (d > peak) peak = d;
      }
      const score = s / n; total += score;
      all.push(score);
      if (score > (opt.T || 0.3) && peak > (opt.P || 0.8)) cells.push({ cx, cy, score });
    }
    // merge neighbouring cells into boxes
    const seen = new Set(), boxes = [];
    const key = (x, y) => x + "," + y, set = new Set(cells.map((c) => key(c.cx, c.cy)));
    for (const c of cells) {
      if (seen.has(key(c.cx, c.cy))) continue;
      let x0 = c.cx, x1 = c.cx, y0 = c.cy, y1 = c.cy;
      const stack = [[c.cx, c.cy]]; seen.add(key(c.cx, c.cy));
      while (stack.length) {
        const [x, y] = stack.pop();
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const k = key(x + dx, y + dy);
          if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push([x + dx, y + dy]); }
        }
      }
      boxes.push({ x: (x0 * C) / W, y: (y0 * C) / H, w: ((x1 - x0 + 1) * C) / W, h: ((y1 - y0 + 1) * C) / H });
    }
    all.sort((a, b) => b - a);
    const sameImage = total / (cols * rows) < 0.035 && cells.length < cols * rows * 0.12;
    return { sameImage, boxes, changedCells: cells.length, cells: cols * rows, meanDiff: total / (cols * rows), aspectGap, top: all.slice(0, 6).map((v) => +v.toFixed(3)), p90: +all[Math.floor(all.length * 0.1)].toFixed(3) };
  }

  // Normalise a file before publishing: max 2000 px, JPEG — the exact bytes that get signed
  async function normalize(file) {
    const img = await loadImage(file);
    const { w, h } = size(img);
    const k = Math.min(1, 2000 / Math.max(w, h));
    const c = canvas(Math.round(w * k), Math.round(h * k)), x = c.getContext("2d");
    x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL("image/jpeg", 0.9);
    const out = await loadImage(dataUrl);
    return { dataUrl, img: out, w: c.width, h: c.height, dhash: dhash(out) };
  }

  // The signed poster: original image + band with QR code, institution and SAH code
  async function stamp(imgSrc, { code, qr, institution }) {
    const img = await loadImage(imgSrc), q = await loadImage(qr);
    const { w, h } = size(img), b = bandHeight(w);
    const c = canvas(w, h + b), x = c.getContext("2d");
    x.drawImage(img, 0, 0, w, h);
    const g = x.createLinearGradient(0, h, w, h + b);
    g.addColorStop(0, "#0B0F1F"); g.addColorStop(1, "#2A1460");
    x.fillStyle = g; x.fillRect(0, h, w, b);
    const pad = Math.round(b * 0.12), qs = b - pad * 2;
    x.fillStyle = "#fff"; x.fillRect(pad, h + pad, qs, qs);
    x.drawImage(q, pad + qs * 0.04, h + pad + qs * 0.04, qs * 0.92, qs * 0.92);
    const tx = pad * 2 + qs, fs = Math.max(11, Math.round(b * 0.16));
    x.fillStyle = "#fff"; x.font = `700 ${fs}px Inter, Arial, sans-serif`; x.textBaseline = "top";
    x.fillText(("✔ Affiche officielle · " + institution).slice(0, 60), tx, h + pad + fs * 0.2, w - tx - pad);
    x.fillStyle = "#C4B5FD"; x.font = `600 ${Math.round(fs * 1.25)}px Inter, Arial, sans-serif`;
    x.fillText(code, tx, h + pad + fs * 1.6, w - tx - pad);
    x.fillStyle = "#CBD5E1"; x.font = `500 ${Math.round(fs * 0.8)}px Inter, Arial, sans-serif`;
    x.fillText("Signée et horodatée sur Hedera · scannez le QR pour vérifier", tx, h + pad + fs * 3.3, w - tx - pad);
    return c.toDataURL("image/jpeg", 0.92);
  }

  window.SahihImage = { BAND, loadImage, dhash, hamming, variants, compare, normalize, stamp };
})();
