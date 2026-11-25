// Sahih — "verification network" globe (canvas, no dependency)
// Dots = institutions and Hedera nodes. Every few moments one dot on the visible side
// receives a message: a violet ring (Hedera consensus) expands, then the dot turns seal-green (verified).
(function () {
  const SEAL = [11, 107, 75], VIOLET = [75, 63, 168], RULE = [11, 107, 75];
  function mount(canvas, opts = {}) {
    const ctx = canvas.getContext("2d");
    const N = opts.points || 260;
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Fibonacci sphere
    const pts = [];
    const ga = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i;
      pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, verified: 0, pulse: -1 });
    }
    let w, h, R, dpr, rot = 0, last = performance.now(), nextPulse = 600;
    function size() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const b = canvas.getBoundingClientRect();
      w = b.width; h = b.height; R = Math.min(w, h) * 0.42;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    const tilt = 0.38, ct = Math.cos(tilt), st = Math.sin(tilt);
    function project(p) {
      const cr = Math.cos(rot), sr = Math.sin(rot);
      let x = p.x * cr + p.z * sr, z = -p.x * sr + p.z * cr, y = p.y;
      const y2 = y * ct - z * st, z2 = y * st + z * ct;
      return { sx: w / 2 + x * R, sy: h / 2 + y2 * R, z: z2 };
    }
    function rings() {
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(RULE, 0.13);
      ctx.beginPath(); ctx.arc(w / 2, h / 2, R, 0, Math.PI * 2); ctx.stroke();
      for (let k = -2; k <= 2; k++) {             // latitude rings (ellipses, tilted)
        const lat = (k / 3) * (Math.PI / 2), ry = Math.cos(lat) * R, cy = h / 2 + Math.sin(lat) * R * ct;
        ctx.beginPath(); ctx.ellipse(w / 2, cy, ry, ry * st, 0, 0, Math.PI * 2); ctx.stroke();
      }
      for (let m = 0; m < 6; m++) {               // meridians
        const a = rot + (m / 6) * Math.PI;
        ctx.beginPath(); ctx.ellipse(w / 2, h / 2, Math.abs(Math.sin(a)) * R, R, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
    function frame(t) {
      const dt = Math.min(64, t - last); last = t;
      if (!reduce) rot += dt * 0.00012;
      ctx.clearRect(0, 0, w, h);
      rings();
      const proj = pts.map((p) => ({ p, ...project(p) })).sort((a, b) => a.z - b.z);
      for (const q of proj) {
        const front = (q.z + 1) / 2;               // 0 = back, 1 = front
        const p = q.p;
        const rad = 1.1 + front * 2.2;
        const col = p.verified > 0 ? SEAL : [74, 90, 82];
        ctx.fillStyle = rgba(col, 0.18 + front * (p.verified > 0 ? 0.8 : 0.45));
        ctx.beginPath(); ctx.arc(q.sx, q.sy, rad + (p.verified > 0 ? 0.8 : 0), 0, Math.PI * 2); ctx.fill();
        if (p.pulse >= 0 && q.z > 0) {             // Hedera consensus ring
          const k = p.pulse / 1200;
          ctx.strokeStyle = rgba(VIOLET, 0.85 * (1 - k)); ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(q.sx, q.sy, 4 + k * 26, 0, Math.PI * 2); ctx.stroke();
        }
        if (p.pulse >= 0) { p.pulse += dt; if (p.pulse > 500 && !p.verified) p.verified = 1; if (p.pulse > 1200) p.pulse = -1; }
      }
      nextPulse -= dt;
      if (nextPulse <= 0 && !reduce) {             // pick a visible dot to "verify"
        const vis = proj.filter((q) => q.z > 0.35 && q.p.pulse < 0);
        if (vis.length) vis[(Math.random() * vis.length) | 0].p.pulse = 0;
        nextPulse = 550 + Math.random() * 700;
        const ver = pts.filter((p) => p.verified);
        if (ver.length > N * 0.45) ver[(Math.random() * ver.length) | 0].verified = 0; // keep it alive
      }
      if (!reduce) requestAnimationFrame(frame);
    }
    size();
    for (let i = 0; i < N; i += reduce ? 3 : 7) pts[i].verified = 1; // some messages already verified
    window.addEventListener("resize", () => { size(); if (reduce) frame(performance.now()); });
    requestAnimationFrame(frame);
  }
  window.SahihGlobe = { mount };
})();
