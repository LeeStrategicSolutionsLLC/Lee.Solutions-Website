/* The field engine — a deforming surface of points in three-dimensional space.

   Camera, wave direction and motion are fixed as of this revision. A grid exists across
   X (width) and Z (depth); every grid point gets its own height from a sum of travelling
   harmonics running in different directions, and the point is then projected through a
   perspective camera sitting low over the surface. Rows curve differently depending on
   their depth, columns descend into and rise out of space, and crests occlude the
   valleys behind them.

     height  = broad travelling swell
             + a second wave crossing it
             + shorter chop
             + low-frequency spatial drift
             + local disturbance
     screen  = ( cx + f·x/z , horizon + f·(eye − height)/z )

   Rendering is a density hierarchy, not a set of dotted paths. Per field:
     · tens of thousands of very small points, jittered off their lattice position, with
       a heavy-tailed weight so most are barely there and a few carry light
     · hairline filaments that weave through depth, cross, separate and fade
     · an irregular local network — triangles, branches, bridges, isolated nodes
     · frequent champagne junctions and warm crest marks, rarer ivory focal points
   Five fields share one camera: distant atmosphere, a crossing field, the primary
   network, and a sparse defocused foreground. Sage is the material; champagne is light
   travelling through it.

   Cost control: the height sum is separable — sin(kx·x + kz·z − ωt + φ) expands into
   per-column tables (built once) times per-row tables (rebuilt per frame), so the inner
   loop is multiply-add only. Each field carries a point budget; the sampling gap widens
   to meet it, so a wide viewport costs the same as a narrow one. */

const HARM = [
  /* amp   kx      kz      ω      φ    — wavelengths sized to the visible field. */
  [1.00, 0.620, 0.340, 0.55, 0.0],
  [0.60, -0.400, 0.950, -0.42, 1.9],
  [0.32, 1.250, 0.620, 0.80, 3.1],
  [0.13, 0.220, 0.160, 0.09, 0.7],
  [0.12, 2.600, 1.700, 1.15, 2.2]
];
const NH = HARM.length;
const SUMA = 2.17;
const TAU = Math.PI * 2;

/* Each field is described by the pitch it should have on screen at its nearest row
   (px at an 800px-tall canvas); row spacing, column pitch and row count derive from it,
   so the lattice stays square in the frame at every depth and canvas size.
   budget = visible points before the sampling gap widens. fil = hairline filaments.
   sw swaps the harmonics' two axes, giving a field that crosses the primary one. */
const LAYERS = [
  { key: 'atmos', pitch: 6, zN: 6, zF: 42, eye: 0.50, off: 0.11, amp: 0.10, ts: 41, sp: 0.6, dot: 0.0052, a: 0.56, warm: 0.12, soft: 0, fog: 46, mesh: false, gap: 1.7, budget: 3000, fil: 32, filA: 0.030, filDot: 0.7 },
  { key: 'cross', pitch: 20, zN: 1.3, zF: 20, eye: 0.46, off: 0.03, amp: 0.130, ts: 23, sp: 0.82, dot: 0.0106, a: 0.78, warm: 0.45, soft: 0, fog: 22, mesh: false, gap: 2.1, budget: 3400, fil: 40, filA: 0.040, filDot: 0.6, sw: true },
  { key: 'main', pitch: 16, zN: 0.95, zF: 13.5, eye: 0.42, off: 0, amp: 0.155, ts: 0, sp: 1, dot: 0.0150, a: 1.50, warm: 1, soft: 0, fog: 15, mesh: true, gap: 1.88, budget: 8000, fil: 70, filA: 0.056, filDot: 0.55 },
  { key: 'fore', pitch: 150, zN: 0.50, zF: 1.35, eye: 0.40, off: -0.05, amp: 0.17, ts: 17, sp: 1.2, dot: 0.050, a: 0.62, warm: 0.5, soft: 2, fog: 900, mesh: false, gap: 42, budget: 520, fil: 16, filA: 0.055, filDot: 0.25 }
];

function mulberry(seed) {
  let a = (seed || 1) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toRgb(c, fallback) {
  if (Array.isArray(c)) return c;
  if (typeof c === 'string') {
    const s = c.trim();
    let m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
    m = s.match(/^#([0-9a-f]{3})$/i);
    if (m) return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16));
    m = s.match(/rgba?\(([^)]+)\)/i);
    if (m) { const p = m[1].split(',').map(v => parseFloat(v)); if (p.length >= 3) return [p[0] | 0, p[1] | 0, p[2] | 0]; }
  }
  return fallback;
}

/* A point is a pre-rendered sprite: crisp, lightly diffused, fully defocused.
   Blur is a property of depth, never of the whole surface. */
function sprite(rgb, soft) {
  const S = 48, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d'), g = c.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  const col = a => 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a + ')';
  if (soft === 0) { g.addColorStop(0, col(1)); g.addColorStop(0.34, col(0.9)); g.addColorStop(0.62, col(0.22)); g.addColorStop(1, col(0)); }
  else if (soft === 1) { g.addColorStop(0, col(0.82)); g.addColorStop(0.42, col(0.4)); g.addColorStop(0.78, col(0.08)); g.addColorStop(1, col(0)); }
  else { g.addColorStop(0, col(0.36)); g.addColorStop(0.34, col(0.22)); g.addColorStop(0.72, col(0.06)); g.addColorStop(1, col(0)); }
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  return cv;
}

export function fieldEngine(canvas, opts) {
  const cfg = Object.assign({
    horizon: 0.44, focal: 1.28, intensity: 1, speed: 1, density: 1, warmth: 1,
    eyeK: 1, relief: 1, dotK: 1, alphaK: 1, freq: 3.4, quiet: 0.8, quietTo: 0.5,
    line: null, light: null, ink: '#0B100D', seed: 7, mesh: true, paused: false, press: 0
  }, opts || {});
  const ctx = canvas.getContext('2d', { alpha: true });
  const still = cfg.paused || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* Colour comes from the nine-stop ramp on the element the canvas sits in, so any
     surface — website, print still, wallpaper, email header, `.on-ink` — re-points the
     whole field by overriding tokens. The hexes are the same values for a page that
     carries no stylesheet, and `line`/`light` still override both. */
  const cstyle = typeof getComputedStyle === 'function' ? getComputedStyle(canvas) : null;
  const tok = (name, hex) => {
    const v = cstyle ? (cstyle.getPropertyValue(name) || '').trim() : '';
    return toRgb(v, toRgb(hex, [159, 177, 148]));
  };
  const SAGE = toRgb(cfg.line, tok('--wave-line', '#758D79'));
  const GOLD = toRgb(cfg.light, tok('--wave-warm-bright', '#E2C48C'));
  const IVORY = tok('--wave-core', '#F2F1EA');
  const INK = toRgb(cfg.ink, [11, 16, 13]);
  const inkA = a => 'rgba(' + INK[0] + ',' + INK[1] + ',' + INK[2] + ',' + a + ')';
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  const k0 = cfg.intensity;

  /* PRESS MODE — `press` is the piece's resolution in logical px per printed inch (144 for
     a card drawn at 504×288, 96 for a 5×8 sheet drawn at 480×768). Screen and paper do not
     behave alike: on screen thousands of 0.5%-alpha marks sum additively into a visible
     wave, on paper each one falls under the screening threshold and prints as nothing at
     all — which is why the first proofs came back with the field missing.

     The fix that works is RESOLUTION, not a different mark. Press mode renders the field
     at `ss`× the piece's logical size and lets CSS scale the result into the trim box: the
     engine builds the same composition the desktop background builds, at desktop scale,
     and the card simply shows it smaller. Marks land 2–3 device pixels across at 432 ppi
     — comfortably printable — with no change to their shape, spacing or tint.

     Three earlier attempts are recorded so they are not repeated. Widening the sampling
     gap and forcing a 13% alpha floor gave a coarse dotty field that read nothing like the
     brand. Stamping marks flat to make that floor real on paper gave visible pixel-art
     squares. Replacing the squares with hard discs gave confetti. All three tried to make
     a small number of heavy marks survive; the answer is a large number of ordinary ones
     drawn at print resolution.

     What remains is a floor in real inches on mark diameter and stroke weight, so nothing
     falls under the screening threshold, and a slight alpha lift for paper's dot gain. */
  const PR = cfg.press || 0;
  const SS = PR ? 3 : 1;
  const inch = v => v * PR * SS;
  const P = PR ? {
    ss: SS,
    rad: Math.max(0.35, inch(0.0045) * 0.5),  /* ≥ 0.0045in across, ≈ 2 device px at 432ppi */
    hair: Math.max(0.6, inch(0.0055)),        /* filament / connector stroke ≥ ≈ 0.4pt */
    lift: 1.12                                /* paper eats a little; give it back evenly */
  } : null;

  const SP = {
    sage: [sprite(SAGE, 0), sprite(SAGE, 1), sprite(SAGE, 2)],
    gold: [sprite(GOLD, 0), sprite(GOLD, 1), sprite(GOLD, 2)],
    ivory: [sprite(IVORY, 0), sprite(IVORY, 1), sprite(IVORY, 2)]
  };

  /* The field draws at ONE fixed quality. An adaptive level that widened the sampling
     stride and halved the rank count under load made the composition visibly taper a few
     seconds after mount — dense and bright, then thinning out — so the cost is paid up
     front in the budgets instead, and what the first seconds look like is what it stays. */
  let w = 0, h = 0, f = 0, hz = 0, cx = 0, raf = 0, t0 = 0, dpr = 1, tPause = 0;
  let fN = 0, fT0 = 0, fps = 0, lastFrame = 0;
  const qual = 1;
  let markN = 0, edgeN = 0, rowN = 0;
  let L = [], sparks = [];

  /* Mark batching is PERSISTENT. One fillStyle per colour-and-weight bucket is what makes
     tens of thousands of marks affordable, but rebuilding the buckets per field per frame
     allocated two dozen growing arrays sixty times a second — a 25ms draw then spent the
     rest of its budget in the collector, and the loop stalled at 2–3fps. Buckets and their
     fill styles are built once and refilled in place. */
  const NBK = 12, BAT = [], BATN = new Int32Array(NBK * 2), BSTYLE = [];
  for (let i = 0; i < NBK * 2; i++) {
    BAT.push(new Float32Array(3 * 4096));
    const q = ((i % NBK) + 0.5) / NBK;
    BSTYLE.push(rgba(i >= NBK ? GOLD : SAGE, (q / 1.15).toFixed(3)));
  }

  /* ---- one field's static tables ---------------------------------------- */
  function buildLayer(spec0, li) {
    const spec = Object.assign({}, spec0, {
      eye: spec0.eye * cfg.eyeK, amp: spec0.amp * cfg.relief,
      dot: spec0.dot * cfg.dotK, a: spec0.a * cfg.alphaK
    });
    const rnd = mulberry(cfg.seed * 31 + li * 7 + 3);
    const px = Math.max(4, spec.pitch * (h / 800) / Math.max(0.5, cfg.density));
    spec.dx = px * spec.zN / f;
    const ratioStep = 1 / Math.max(0.02, 1 - px * spec.zN / (f * (spec.eye + spec.off)));

    const Xmax = (w * 0.5 + 70) * spec.zF / f;
    const nc = Math.min(2600, Math.max(8, Math.ceil(2 * Xmax / spec.dx) + 1));
    const x = new Float32Array(nc), xB = new Float32Array(nc);
    for (let j = 0; j < nc; j++) { x[j] = (j - (nc - 1) / 2) * spec.dx; xB[j] = x[j] + spec.dx * 0.5; }
    /* the two axes can be swapped so a field crosses the primary one */
    const KX = q => (spec.sw ? HARM[q][2] : HARM[q][1]) * cfg.freq;
    const KZ = q => (spec.sw ? HARM[q][1] : HARM[q][2]) * cfg.freq;
    const sx = [], cxT = [], sxB = [], cxB = [];
    for (let q = 0; q < NH; q++) {
      const kx = KX(q);
      const a = new Float32Array(nc), b = new Float32Array(nc);
      const a2 = new Float32Array(nc), b2 = new Float32Array(nc);
      for (let j = 0; j < nc; j++) {
        a[j] = Math.sin(kx * x[j]); b[j] = Math.cos(kx * x[j]);
        a2[j] = Math.sin(kx * xB[j]); b2[j] = Math.cos(kx * xB[j]);
      }
      sx.push(a); cxT.push(b); sxB.push(a2); cxB.push(b2);
    }
    const nr = Math.min(420, Math.max(6, Math.ceil(Math.log(spec.zF / spec.zN) / Math.log(ratioStep)) + 1));
    const z = new Float32Array(nr), ratio = Math.pow(spec.zF / spec.zN, 1 / (nr - 1));
    for (let i = 0; i < nr; i++) z[i] = spec.zN * Math.pow(ratio, i);

    /* the budget sets the sampling gap, so viewport width does not change the cost */
    let gap = spec.gap;
    const est = nr * (w / gap);
    if (spec.budget && est > spec.budget) gap = gap * est / spec.budget;
    spec.gapEff = gap;

    /* two jitter fields: one indexed by column, one mixed per point. Points sit off
       their lattice position so no path can read as evenly spaced beads. */
    const jit = new Float32Array(nc), jit2 = new Float32Array(nc), jit3 = new Float32Array(nc);
    for (let j = 0; j < nc; j++) { jit[j] = rnd(); jit2[j] = rnd(); jit3[j] = rnd(); }

    /* hairline filaments: each weaves through depth, so they cross and reconverge */
    const fils = [];
    for (let i = 0, n = Math.round((spec.fil || 0) * cfg.density); i < n; i++) {
      const u = rnd();
      fils.push({
        z0: spec.zN * Math.pow(spec.zF / spec.zN, Math.pow(u, 0.78)),
        weave: 0.02 + rnd() * 0.105, wk: 0.2 + rnd() * 0.62, ph: rnd() * TAU,
        drift: (rnd() - 0.5) * 0.07, a: 0.45 + rnd() * 0.9, dotted: rnd() < (spec.filDot || 0),
        gold: rnd() < 0.24, fade: rnd() * TAU, cut: 0.1 + rnd() * 0.5
      });
    }

    /* the network riding the same surface. Node columns are spaced by screen distance,
       not world index, so it reads evenly across the frame. */
    let nodes = [], grid = null;
    if (spec.mesh && cfg.mesh) {
      const GAP = 64, half = (nc - 1) / 2;
      grid = [];
      for (let i = 2; i < nr - 2; i += 3) {
        if (f * (spec.eye + spec.off) / z[i] - f * (spec.eye + spec.off) / z[Math.min(nr - 1, i + 3)] < 9) break;
        const step = Math.max(1, Math.round(GAP * z[i] / (f * spec.dx)));
        const reach = Math.ceil((w * 0.5 + 90) / GAP) + 1, row = [];
        for (let m = -reach; m <= reach; m++) {
          const j = Math.round(half + m * step + (rnd() - 0.5) * step * 0.6);
          if (j < 0 || j > nc - 1) continue;
          const r = rnd();
          row.push({
            i: i, j: j, gold: r < 0.18, ivory: r > 0.982,
            gate: 0.34 + rnd() * 0.46, diag: rnd() < 0.5, skip: rnd() < 0.22,
            bridge: rnd() < 0.010, ph: rnd() * TAU, s: 0.6 + rnd() * rnd() * 1.6,
            x: 0, y: 0, v: 0, b: 0, k: 1, on: false
          });
        }
        row.forEach(n => nodes.push(n));
        grid.push(row);
      }
    }
    const snapAt = {};
    if (grid) grid.forEach(r => { if (r[0]) snapAt[r[0].i] = 1; });

    return {
      spec, nc, nr, x, xB, z, sx, cx: cxT, sxB, cxB, jit, jit2, jit3, fils,
      nodes, grid, snapAt, snaps: {},
      rsz: new Float32Array(nr * NH), rcz: new Float32Array(nr * NH), KZ
    };
  }

  function build() {
    L = LAYERS.map(buildLayer);
    const rnd = mulberry(cfg.seed + 91);
    sparks = [];
    for (let i = 0; i < 4; i++) {
      sparks.push({ z: 1.8 + rnd() * 8, off: rnd(), sp: 0.02 + rnd() * 0.028, gold: rnd() < 0.78, s: 0.8 + rnd() * 0.7 });
    }
  }

  function hAt(lay, x, z, t) {
    const S = lay.spec;
    let s = 0;
    for (let q = 0; q < NH; q++) {
      const kx = (S.sw ? HARM[q][2] : HARM[q][1]) * cfg.freq;
      const kz = (S.sw ? HARM[q][1] : HARM[q][2]) * cfg.freq;
      s += HARM[q][0] * Math.sin(kx * x + kz * z - HARM[q][3] * t + HARM[q][4]);
    }
    return { y: s * S.amp, hn: s / SUMA };
  }

  function rows(lay, t) {
    const S = lay.spec, tt = t * S.sp + S.ts;
    for (let q = 0; q < NH; q++) {
      const kz = lay.KZ(q), wq = HARM[q][3], ph = HARM[q][4];
      for (let i = 0; i < lay.nr; i++) {
        const p = kz * lay.z[i] - wq * tt + ph;
        lay.rsz[i * NH + q] = Math.sin(p); lay.rcz[i * NH + q] = Math.cos(p);
      }
    }
    return tt;
  }

  /* ---- the surface pass -------------------------------------------------- */
  const BW = 8;
  let buf = null;

  function drawField(lay, t, occlude) {
    const S = lay.spec, nb = buf.length;
    BATN.fill(0);
    const amp = S.amp, eye = S.eye + S.off;
    const soft = S.soft, targetGap = S.gapEff;
    const rowStep = 1;
    /* tiny points are batched by colour and weight: one fillStyle per bucket, not per
       point, which is what makes tens of thousands of marks affordable */
    const nbk = NBK;

    for (let i = 0; i < lay.nr; i += rowStep) {
      const z = lay.z[i], kk = f / z;
      const xlim = (w * 0.5 + 60) / kk;
      const half = (lay.nc - 1) / 2;
      let j0 = Math.ceil(half - xlim / S.dx), j1 = Math.floor(half + xlim / S.dx);
      if (j0 < 0) j0 = 0; if (j1 > lay.nc - 1) j1 = lay.nc - 1;
      if (j1 < j0) continue;
      const gap = kk * S.dx;
      const stride = gap >= targetGap ? 1 : Math.max(1, Math.round(targetGap / gap));
      const radK = kk * S.dot * 0.5;
      const fog = Math.exp(-(z - S.zN) / S.fog);
      const nearFade = S.mesh ? Math.min(1, (z - S.zN) / 0.25 + 0.6) : 1;
      const base = S.a * k0 * fog * nearFade;
      if (lay.snapAt[i]) { const sb = lay.snaps[i] || (lay.snaps[i] = new Float32Array(nb)); sb.set(buf); }
      if (base < 0.004) continue;
      rowN++;
      const strideFade = Math.min(1.7, stride * 0.5 + 0.5);
      const odd = (i & 1) === 1, SX = odd ? lay.sxB : lay.sx, CX = odd ? lay.cxB : lay.cx, XA = odd ? lay.xB : lay.x;
      const jx = gap * stride * 0.45, jy = Math.min(26, kk * S.dx * 0.9);

      for (let j = j0; j <= j1; j += stride) {
        let s = 0;
        for (let q = 0; q < NH; q++) {
          const o = i * NH + q;
          s += HARM[q][0] * (SX[q][j] * lay.rcz[o] + CX[q][j] * lay.rsz[o]);
        }
        const hn = s / SUMA;
        const m = (j * 3 + i * 13) % lay.nc, m2 = (j * 7 + i * 29) % lay.nc;
        const jt = lay.jit[j], jt2 = lay.jit2[m], jt3 = lay.jit3[m2];
        const sxp = cx + kk * XA[j] + (jt - 0.5) * jx;
        const syp = hz + kk * (eye - s * amp) + (jt2 - 0.5) * jy;
        if (syp < -40 || syp > h + 60) continue;
        /* crests carry the light; troughs keep only their fine texture */
        let br = Math.max(0, Math.min(1, (hn + 0.42) / 1.18));
        br = Math.pow(br, 1.55);
        /* heavy-tailed weight: most marks are barely there, a few carry the surface */
        const w8 = 0.16 + 1.55 * jt3 * jt3 * jt3;
        let a = base * (0.24 + 1.24 * br) * w8 * strideFade;
        let rad = Math.max(P ? P.rad : 0.26, radK * (0.34 + 0.72 * br) * (0.55 + 1.0 * jt2 * jt2));
        if (occlude) {
          const b = (sxp / BW + 1) | 0;
          if (b > 0 && b < nb - 1) {
            let ym = buf[b];
            if (buf[b - 1] < ym) ym = buf[b - 1];
            if (buf[b + 1] < ym) ym = buf[b + 1];
            if (syp > ym + 30) continue;
            if (syp > ym) a *= 1 - (syp - ym) / 30;
            if (syp < buf[b]) buf[b] = syp;
          }
        }
        if (cfg.quiet < 1) {
          /* a quiet side rather than a dark panel: the field's light falls away where
             the words sit, but its fine structure stays */
          const u = Math.max(0, Math.min(1, sxp / (w * cfg.quietTo)));
          a *= cfg.quiet + (1 - cfg.quiet) * (u * u * (3 - 2 * u));
        }
        /* champagne is light inside the material: chosen on the crests, and carrying a
           little more of it than the sage around it so it reads as warm, not as pale */
        const warm = hn > 0.46 - 0.14 * jt && jt < 0.30 * S.warm * cfg.warmth;
        if (warm) a *= 1.35;
        if (P) a *= P.lift;
        if (a < 0.005) continue;
        if (a > 0.92) a = 0.92;
        markN++;
        /* The bucket is a SCREEN-ONLY path: one fillStyle per tint bucket makes tens of
           thousands of 1px marks affordable in a live loop, and at that size a square is
           indistinguishable from a dot. Press must never enter it — a press frame is drawn
           once, has nothing to buy from the throughput, and at 3× supersample the squares
           are plainly visible. */
        if (!P && soft === 0 && rad < 1.2) {
          const bk = Math.min(nbk - 1, Math.max(0, (a * nbk * 1.15) | 0)), key = (warm ? nbk : 0) + bk;
          let arr = BAT[key];
          const n = BATN[key];
          if (n + 3 > arr.length) { const g = new Float32Array(arr.length * 2); g.set(arr); arr = BAT[key] = g; }
          arr[n] = sxp; arr[n + 1] = syp; arr[n + 2] = rad * 2;
          BATN[key] = n + 3;
        } else {
          ctx.globalAlpha = a;
          ctx.drawImage(warm ? SP.gold[soft] : SP.sage[soft], sxp - rad, syp - rad, rad * 2, rad * 2);
        }
      }
    }
    for (let key = 0; key < nbk * 2; key++) {
      const n = BATN[key]; if (!n) continue;
      const arr = BAT[key];
      ctx.globalAlpha = 1;
      ctx.fillStyle = BSTYLE[key];
      for (let p = 0; p < n; p += 3) {
        const s = arr[p + 2];
        ctx.fillRect(arr[p] - s * 0.5, arr[p + 1] - s * 0.5, s, s);
      }
    }
  }

  /* ---- hairline filaments ------------------------------------------------ */
  function drawFilaments(lay, t, occlude) {
    const S = lay.spec, nb = buf.length, eye = S.eye + S.off;
    if (!lay.fils.length) return;
    const N = 26;
    ctx.lineWidth = P ? P.hair : 0.6;
    for (let i = 0; i < lay.fils.length; i++) {
      const F = lay.fils[i];
      /* a shallow breath: a filament varies in presence but never fades out of the field */
      const breathe = 0.76 + 0.24 * Math.pow(0.5 + 0.5 * Math.sin(t * 0.13 + F.fade), 1.5);
      let al = S.filA * F.a * breathe * k0 * (P ? P.lift : 1);
      if (al < 0.004) continue;
      const c = F.gold ? GOLD : SAGE;
      let started = false;
      ctx.strokeStyle = rgba(c, al.toFixed(3));
      ctx.beginPath();
      for (let n = 0; n <= N; n++) {
        const u = n / N;
        const z = F.z0 * (1 + F.weave * Math.sin(u * TAU * F.wk + F.ph + t * F.drift));
        const kk = f / z, Xs = (w * 0.5 + 50) * z / f;
        const x = -Xs + u * 2 * Xs;
        const p = hAt(lay, x, z, t * S.sp + S.ts);
        let sxp = cx + kk * x, syp = hz + kk * (eye - p.y);
        let vis = syp > -30 && syp < h + 40;
        if (vis && occlude) {
          const b = (sxp / BW + 1) | 0;
          if (b > 0 && b < nb - 1) {
            const ym = Math.min(buf[b], Math.min(buf[b - 1], buf[b + 1]));
            if (syp > ym + 24) vis = false;
          }
        }
        /* filaments continue through faint regions, with a short break here and there */
        if (vis && Math.sin(u * TAU * (1.5 + F.cut * 6) + F.ph * 2) < -0.94) vis = false;
        if (!vis) { started = false; continue; }
        if (!started) { ctx.moveTo(sxp, syp); started = true; } else ctx.lineTo(sxp, syp);
      }
      ctx.globalAlpha = 1;
      ctx.stroke();
      if (F.dotted) {
        ctx.fillStyle = rgba(c, (al * 2.6).toFixed(3));
        if (P) ctx.globalAlpha = Math.min(1, al * 2.6);
        for (let n = 0; n <= N; n += 2) {
          const u = n / N;
          const z = F.z0 * (1 + F.weave * Math.sin(u * TAU * F.wk + F.ph + t * F.drift));
          const kk = f / z, Xs = (w * 0.5 + 50) * z / f;
          const x = -Xs + u * 2 * Xs;
          const p = hAt(lay, x, z, t * S.sp + S.ts);
          const syp = hz + kk * (eye - p.y);
          if (syp < -20 || syp > h + 30) continue;
          const r = Math.max(P ? P.rad : 0.3, kk * 0.0016);
          /* beads are squares on screen (they are ~1px and it is the cheap path) but a
             press bead is several pixels across, so it takes the round sprite */
          if (P) ctx.drawImage(F.gold ? SP.gold[0] : SP.sage[0], cx + kk * x - r, syp - r, r * 2, r * 2);
          else ctx.fillRect(cx + kk * x - r, syp - r, r * 2, r * 2);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ---- the irregular network -------------------------------------------- */
  function drawMesh(lay, t) {
    if (!lay.grid) return;
    const S = lay.spec, amp = S.amp, eye = S.eye + S.off, nb = buf.length;
    for (let n = 0; n < lay.nodes.length; n++) {
      const nd = lay.nodes[n], z = lay.z[nd.i], kk = f / z;
      const odd = (nd.i & 1) === 1, SX = odd ? lay.sxB : lay.sx, CX = odd ? lay.cxB : lay.cx;
      let s = 0;
      for (let q = 0; q < NH; q++) {
        const o = nd.i * NH + q;
        s += HARM[q][0] * (SX[q][nd.j] * lay.rcz[o] + CX[q][nd.j] * lay.rsz[o]);
      }
      const hn = s / SUMA;
      nd.x = cx + kk * (odd ? lay.xB : lay.x)[nd.j];
      nd.y = hz + kk * (eye - s * amp);
      nd.b = Math.pow(Math.max(0, Math.min(1, (hn + 0.30) / 1.06)), 1.45);
      nd.k = kk;
      let v = 1;
      const sb = lay.snaps[nd.i] || buf;
      const b = (nd.x / BW + 1) | 0;
      if (b > 0 && b < nb - 1) {
        const ym = Math.min(sb[b], Math.min(sb[b - 1], sb[b + 1]));
        v = nd.y > ym + 26 ? 0 : nd.y > ym ? 1 - (nd.y - ym) / 26 : 1;
      }
      if (nd.x < -60 || nd.x > w + 60 || nd.y < -30 || nd.y > h + 40) v = 0;
      if (cfg.quiet < 1) {
        const u = Math.max(0, Math.min(1, nd.x / (w * cfg.quietTo)));
        v *= cfg.quiet + (1 - cfg.quiet) * (u * u * (3 - 2 * u));
      }
      nd.v = v;
      nd.on = v > 0.05;
    }
    /* short local connections, a few long bridges, whole regions left loose:
       organised irregularity rather than the whole lattice */
    ctx.lineWidth = P ? P.hair : 0.7;
    const link = (a, b, far) => {
      if (!a || !b || !a.on || !b.on || a.skip || b.skip) return;
      const br = (a.b + b.b) * 0.5, gate = (a.gate + b.gate) * 0.5;
      if (br < gate) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const lim = far ? 140 : 76;
      if (d > lim || d < 1) return;
      let al = Math.min(far ? 0.09 : 0.42, (br - gate) * br * (far ? 0.9 : 5.2) * Math.min(a.v, b.v) * k0 * (1 - d / (lim * 1.3)));
      if (P) al *= P.lift;
      if (al < 0.01) return;
      ctx.globalAlpha = 1;
      edgeN++;
      ctx.strokeStyle = rgba(a.gold && b.gold ? GOLD : SAGE, al.toFixed(3));
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    };
    for (let r = 0; r < lay.grid.length; r++) {
      const row = lay.grid[r], nxt = lay.grid[r + 1];
      for (let c = 0; c < row.length; c++) {
        const nd = row[c];
        link(nd, row[c + 1]);
        if (nxt) {
          link(nd, nxt[c]);
          if (nd.diag) link(nd, nxt[c + 1]);
          if (!nd.diag && nxt[c - 1]) link(nd, nxt[c - 1]);
        }
        if (nd.bridge && lay.grid[r + 2]) link(nd, lay.grid[r + 2][c + 2], true);
      }
    }
    for (let n = 0; n < lay.nodes.length; n++) {
      const nd = lay.nodes[n];
      if (!nd.on) continue;
      const pulse = 0.62 + 0.38 * Math.sin(t * 0.34 + nd.ph);
      const br = nd.b * pulse;
      const r = (0.45 + 1.5 * br) * nd.s * Math.max(0.35, Math.min(1.5, nd.k / 500));
      const sel = nd.ivory && nd.b > 0.6;
      /* bloom is proportional to importance — junctions only, never the surface */
      if (sel) {
        ctx.globalAlpha = Math.min(0.26, 0.2 * br * nd.v * k0 * cfg.warmth);
        const R = r * 12;
        ctx.drawImage(SP.ivory[2], nd.x - R, nd.y - R, R * 2, R * 2);
      } else if (nd.gold && nd.b > 0.72) {
        ctx.globalAlpha = Math.min(0.16, 0.1 * br * nd.v * k0 * cfg.warmth);
        const R = r * 7;
        ctx.drawImage(SP.gold[2], nd.x - R, nd.y - R, R * 2, R * 2);
      }
      const core = Math.min(0.9, (0.16 + 0.66 * br) * nd.v * k0 * (P ? P.lift : 1));
      ctx.globalAlpha = core;
      ctx.drawImage(sel ? SP.ivory[0] : nd.gold ? SP.gold[0] : SP.sage[0], nd.x - r, nd.y - r, r * 2, r * 2);
    }
  }

  /* ---- rare travelling lights -------------------------------------------- */
  function drawSparks(lay, t) {
    const S = lay.spec, eye = S.eye + S.off;
    for (let i = 0; i < sparks.length; i++) {
      const s = sparks[i], z = s.z, kk = f / z;
      const Xs = (w * 0.5 + 40) * z / f;
      const u = (s.off + t * s.sp) % 1;
      const x = -Xs + u * 2 * Xs;
      const p = hAt(lay, x, z, t + S.ts);
      const sxp = cx + kk * x, syp = hz + kk * (eye - p.y);
      if (syp > h + 20) continue;
      let q = 1;
      if (cfg.quiet < 1) {
        const uu = Math.max(0, Math.min(1, sxp / (w * cfg.quietTo)));
        q = cfg.quiet + (1 - cfg.quiet) * (uu * uu * (3 - 2 * uu));
      }
      const c = s.gold ? 'gold' : 'sage', r = s.s * Math.max(0.45, Math.min(1.6, kk / 460));
      const edge = Math.min(1, Math.min(u, 1 - u) * 9) * q;
      ctx.globalAlpha = 0.2 * edge * k0 * cfg.warmth;
      ctx.drawImage(SP[c][2], sxp - r * 12, syp - r * 12, r * 24, r * 24);
      ctx.globalAlpha = 0.72 * edge * k0;
      ctx.drawImage(SP.ivory[0], sxp - r * 1.1, syp - r * 1.1, r * 2.2, r * 2.2);
    }
  }

  function frame(now) {
    if (!t0) t0 = now;
    lastFrame = now;
    fN++;
    if (!fT0) fT0 = now;
    else if (now - fT0 >= 1000) { fps = Math.round(fN * 1000 / (now - fT0)); fN = 0; fT0 = now; }
    const t = still ? 21.5 : ((now - t0) / 1000) * cfg.speed;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    markN = 0; edgeN = 0; rowN = 0;
    ctx.globalCompositeOperation = 'lighter';
    const nb = Math.ceil(w / BW) + 3;
    if (!buf || buf.length !== nb) buf = new Float32Array(nb);

    /* distant atmosphere, then haze sinking it into the dark, then the crossing field,
       then the primary network, then the sparse defocused foreground */
    L.forEach(lay => rows(lay, t));

    buf.fill(1e9);
    drawField(L[0], t, true);
    drawFilaments(L[0], t, true);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, hz - h * 0.16, 0, hz + h * 0.36);
    g.addColorStop(0, inkA(0.5)); g.addColorStop(0.3, inkA(0.42)); g.addColorStop(0.62, inkA(0.16)); g.addColorStop(1, inkA(0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    buf.fill(1e9);
    drawField(L[1], t, true);
    drawFilaments(L[1], t, true);

    buf.fill(1e9);
    drawField(L[2], t, true);
    drawFilaments(L[2], t, true);
    drawMesh(L[2], t);
    drawSparks(L[2], t);

    drawField(L[3], t, false);
    drawFilaments(L[3], t, false);

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    if (still) return;
    raf = requestAnimationFrame(frame);
  }

  /* Deferring, not guessing, is the whole point of the early return. `clientWidth || 1`
     silently ACCEPTED an unresolved layout box: the field then built for a 1-logical-px
     viewport, every mark landed on the same few device pixels, and under `lighter` they
     saturated to solid white stretched across the piece. Worse, the only recovery path was
     the window `resize` listener, which never fires in normal use — so a canvas that was
     zero-size at mount stayed broken for the life of the page. A ResizeObserver is what
     covers this case; the window listener alone cannot. */
  let pending = 0;
  function resize() {
    if (!canvas.clientWidth || !canvas.clientHeight) {
      /* No box yet. Retry rather than build for a 1px viewport — this, not the observer,
         is the load-bearing recovery: ResizeObserver does not fire in every host (some
         preview and embed environments suppress it) and a window resize never fires in
         normal use. A timer rather than a frame, because rAF is throttled hard in
         background and preview contexts. Bounded, so a canvas that is legitimately
         display:none forever does not spin. */
      if (pending++ < 120) setTimeout(resize, 40);
      return;
    }
    pending = 0;
    /* Screen: one device pixel per logical pixel — the field is soft grain and gains
       nothing from a retina buffer, while a 2× buffer costs 4× the fill.
       Press: build at `ss`× the piece's logical size and let CSS scale it into the trim
       box, so the card draws the desktop background's field and shows it smaller. The
       card's 504px front becomes a 1512px canvas (432 ppi), the 480px leave-behind a
       1440px one (288 ppi). Cost is irrelevant — a press field is a single paused frame. */
    dpr = 1;
    const ss = P ? P.ss : 1;
    w = canvas.clientWidth * ss; h = canvas.clientHeight * ss;
    canvas.width = Math.round(w); canvas.height = Math.round(h);
    f = h * cfg.focal; hz = h * cfg.horizon; cx = w * 0.5;
    buf = null;
    build();
    /* a field that mounted without a box has no loop running yet — start it here, since
       this is the first moment it has real geometry to draw */
    if (still) { t0 = 0; frame(0); }
    else if (!raf && !document.hidden) { t0 = 0; raf = requestAnimationFrame(frame); }
  }
  let tm = 0;
  const onResize = () => { clearTimeout(tm); tm = setTimeout(resize, 140); };
  resize();
  addEventListener('resize', onResize);
  /* observe the element too, so a later size change rebuilds the field at the new box */
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    let seen = w;
    ro = new ResizeObserver(() => {
      const cw = canvas.clientWidth;
      if (!cw) return;
      if (!w || Math.abs(cw - seen) >= 1) { seen = cw; onResize(); }
    });
    ro.observe(canvas);
  }
  if (!still && w) raf = requestAnimationFrame(frame);
  /* A requested frame is not a guaranteed frame. If the page is laid out while its frame
     is not being painted (an unfocused preview, a display:none ancestor, a restored
     history entry), the rAF callback can simply never run — and because `raf` still holds
     a non-zero id, nothing downstream can tell a live loop from a dead one, so the field
     stays dark for the life of the page. The watchdog clears the stale id and re-arms.
     It polls fast while the page settles, then backs off. */
  let wdN = 0, wd2 = 0;
  function wdTick(fast) {
    if (document.hidden) return;
    if (!w) { resize(); return; }
    const idle = !lastFrame || performance.now() - lastFrame > (fast ? 260 : 1400);
    if (idle) { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); }
  }
  const wd = still ? 0 : setInterval(() => {
    wdTick(true);
    if (++wdN >= 24) { clearInterval(wd); wd2 = setInterval(() => wdTick(false), 1500); }
  }, 250);
  /* The measured colour balance, classified from the composited pixels — what it reports
     is what is on screen. Shares are of LIT pixels; `lit` and `meanLuma` are the density
     figures. `step` samples every Nth device pixel (default 2). */
  function stats(step) {
    const sk = Math.max(1, step || 2);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data, W = canvas.width;
    let lit = 0, tot = 0, sd = 0, sl = 0, ch = 0, iv = 0, lum = 0;
    for (let y = 0; y < canvas.height; y += sk) {
      for (let x = 0; x < W; x += sk) {
        const p = (y * W + x) * 4, al = d[p + 3];
        tot++;
        if (al < 8) continue;
        const r = d[p], g = d[p + 1], b = d[p + 2];
        const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) * (al / 255);
        if (l < 7) continue;
        lit++; lum += l;
        if (l > 148 && b > 140 && Math.abs(r - g) < 30) iv++;
        else if (r > g * 0.99) ch++;
        else if (l > 72) sl++;
        else sd++;
      }
    }
    const n = lit || 1;
    return {
      marks: markN, edges: edgeN, rows: rowN, nodes: L[2] ? L[2].nodes.length : 0, qual, fps,
      lit: +(100 * lit / (tot || 1)).toFixed(2), meanLuma: +(lum / n).toFixed(1),
      sageDarkMid: +(100 * sd / n).toFixed(1), sageLight: +(100 * sl / n).toFixed(1),
      champagne: +(100 * ch / n).toFixed(1), ivory: +(100 * iv / n).toFixed(1)
    };
  }

  /* A hidden tab stops the loop; the clock is advanced by the time spent hidden, so the
     field resumes where it left off instead of jumping. */
  const onVis = () => {
    if (still) return;
    if (document.hidden) { if (raf) { cancelAnimationFrame(raf); raf = 0; } tPause = performance.now(); }
    else if (!raf) { if (tPause && t0) t0 += performance.now() - tPause; tPause = 0; raf = requestAnimationFrame(frame); }
  };
  document.addEventListener('visibilitychange', onVis);

  return {
    stats,
    stop() {
      cancelAnimationFrame(raf);
      clearTimeout(tm);
      if (wd) clearInterval(wd);
      if (wd2) clearInterval(wd2);
      if (ro) ro.disconnect();
      removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
    }
  };
}
