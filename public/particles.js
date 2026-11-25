// Sahih — glowing particle sphere (canvas 2D, no dependency)
// Each particle is a node of the verification network; every moment one receives a message:
// a violet ring (Hedera consensus) opens, then the node turns mint (verified).
(function () {
  function mount(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const N = opts.points || 2200;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pts = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
      const j = 1 + (Math.random() - 0.5) * 0.06; // slight shell thickness
      pts.push({ x: Math.cos(th) * r * j, y: y * j, z: Math.sin(th) * r * j, tw: Math.random() * 6.28, v: 0, pulse: -1 });
    }
    let w, h, R, dpr, rot = 0, tilt = 0.35, mx = 0, my = 0, last = performance.now(), next = 400;
    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      const b = canvas.getBoundingClientRect();
      w = b.width; h = b.height; R = Math.min(w, h) * 0.34;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    addEventListener("pointermove", (e) => { mx = (e.clientX / innerWidth - 0.5); my = (e.clientY / innerHeight - 0.5); });
    function frame(t) {
      const dt = Math.min(50, t - last); last = t;
      if (!reduce) rot += dt * 0.00011;
      const tl = tilt + my * 0.25, ry = rot + mx * 0.4;
      const cr = Math.cos(ry), sr = Math.sin(ry), ct = Math.cos(tl), st = Math.sin(tl);
      ctx.clearRect(0, 0, w, h);
      // inner glow
      const g = ctx.createRadialGradient(w / 2, h / 2, R * 0.1, w / 2, h / 2, R * 1.25);
      g.addColorStop(0, "rgba(120,105,255,0.30)"); g.addColorStop(0.6, "rgba(90,70,230,0.10)"); g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(w / 2, h / 2, R * 1.25, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      const vis = [];
      for (const p of pts) {
        const x = p.x * cr + p.z * sr, z0 = -p.x * sr + p.z * cr;
        const y = p.y * ct - z0 * st, z = p.y * st + z0 * ct;
        const sx = w / 2 + x * R, sy = h / 2 + y * R, f = (z + 1) / 2;
        const tw = 0.75 + 0.25 * Math.sin(t * 0.002 + p.tw);
        const a = (0.10 + f * 0.75) * tw, s = 0.5 + f * 1.25;
        if (p.v > 0) { ctx.fillStyle = `rgba(61,220,151,${Math.min(1, a + 0.25)})`; ctx.beginPath(); ctx.arc(sx, sy, s + 0.9, 0, 6.283); ctx.fill(); }
        else { ctx.fillStyle = `rgba(${200 + f * 40 | 0},${195 + f * 45 | 0},255,${a})`; ctx.fillRect(sx - s / 2, sy - s / 2, s, s); }
        if (p.pulse >= 0) {
          const k = p.pulse / 1300;
          if (z > 0) { ctx.strokeStyle = `rgba(169,156,255,${0.9 * (1 - k)})`; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(sx, sy, 3 + k * 30, 0, 6.283); ctx.stroke(); }
          p.pulse += dt; if (p.pulse > 520) p.v = 1; if (p.pulse > 1300) p.pulse = -1;
        }
        if (z > 0.45 && p.pulse < 0 && !p.v) vis.push(p);
      }
      ctx.globalCompositeOperation = "source-over";
      next -= dt;
      if (next <= 0 && !reduce && vis.length) {
        vis[(Math.random() * vis.length) | 0].pulse = 0;
        next = 280 + Math.random() * 520;
        if (Math.random() < 0.35) { const v = pts.filter((p) => p.v); if (v.length > 60) v[(Math.random() * v.length) | 0].v = 0; }
      }
      if (!reduce) requestAnimationFrame(frame);
    }
    for (let i = 0; i < N; i += 37) pts[i].v = 1;
    size(); addEventListener("resize", () => { size(); if (reduce) frame(performance.now()); });
    requestAnimationFrame(frame);
  }
  window.SahihParticles = { mount };
})();
