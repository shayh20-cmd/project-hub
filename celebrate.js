/* celebrate.js — short full-screen celebration animations (canvas, no dependencies).
 *
 *   Celebrate.play()            a random one
 *   Celebrate.play('fireworks') a named one: fireworks | confetti | unicorn | balloons | rocket
 *   Celebrate.kinds             the list of names
 *
 * One canvas overlay at a time (a new call replaces the running one), pointer-events none,
 * removed when finished. Skipped entirely when the user prefers reduced motion.
 * Draws no text of its own, so there is nothing to translate; the unicorn/rocket are emoji.
 */
(function (global) {
  'use strict';

  var COLORS = ['#ff4d6d', '#ffb703', '#ffd60a', '#06d6a0', '#4cc9f0', '#4361ee', '#b5179e', '#ff7b00'];
  var RAINBOW = ['#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#32ade6', '#5856d6', '#af52de'];
  var TAU = Math.PI * 2;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function reduced() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  var current = null;

  /* Runs step(ctx, dt, t, W, H) every frame until it returns true (or a hard cap of 9 s). */
  function play(step) {
    if (current) current.stop();
    var c = document.createElement('canvas');
    c.setAttribute('aria-hidden', 'true');
    c.setAttribute('data-i18n-skip', '');
    c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
    document.body.appendChild(c);
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var W = global.innerWidth, H = global.innerHeight;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var raf = 0, last = 0, t = 0, stopped = false;
    var run = {
      stop: function () {
        if (stopped) return;
        stopped = true;
        cancelAnimationFrame(raf);
        if (c.parentNode) c.parentNode.removeChild(c);
        if (current === run) current = null;
      }
    };
    function frame(now) {
      if (stopped) return;
      var dt = last ? Math.min((now - last) / 1000, 0.05) : 0.016;
      last = now;
      t += dt;
      var finished = false;
      try { finished = step(ctx, dt, t, W, H); } catch (e) { finished = true; }
      if (finished || t > 9) run.stop(); else raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    current = run;
    return run;
  }

  /* Fade the previous frame instead of clearing it: gives particles a glowing tail. */
  function fade(ctx, W, H, amount) {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,' + amount + ')';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  function sparkle(ctx, x, y, r, color, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ---------- 1. fireworks ---------- */
  function fireworks() {
    var rockets = [], sparks = [], launched = 0, total = 7, nextAt = 0;
    return play(function (ctx, dt, t, W, H) {
      fade(ctx, W, H, 0.22);
      if (launched < total && t >= nextAt) {
        launched++;
        nextAt = t + rnd(0.25, 0.55);
        var x = rnd(W * 0.15, W * 0.85);
        rockets.push({ x: x, y: H + 10, vx: rnd(-40, 40), vy: -rnd(H * 0.9, H * 1.15), color: pick(COLORS) });
      }
      ctx.globalCompositeOperation = 'lighter';
      for (var i = rockets.length - 1; i >= 0; i--) {
        var r = rockets[i];
        r.x += r.vx * dt; r.y += r.vy * dt; r.vy += 520 * dt;
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(r.x, r.y, 2.2, 0, TAU); ctx.fill();
        if (r.vy >= -40) {
          var n = 70, hue2 = pick(COLORS);
          for (var k = 0; k < n; k++) {
            var a = (k / n) * TAU + rnd(-0.05, 0.05), sp = rnd(110, 340) * (k % 2 ? 1 : 0.62);
            sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: rnd(0.5, 0.9), color: k % 5 === 0 ? hue2 : r.color });
          }
          rockets.splice(i, 1);
        }
      }
      for (var j = sparks.length - 1; j >= 0; j--) {
        var s = sparks[j];
        s.vx *= 0.985; s.vy = s.vy * 0.985 + 150 * dt;
        s.x += s.vx * dt; s.y += s.vy * dt;
        s.life -= s.decay * dt;
        if (s.life <= 0) { sparks.splice(j, 1); continue; }
        ctx.globalAlpha = Math.max(0, s.life);
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, 2.2 * (0.5 + s.life * 0.5), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return launched >= total && !rockets.length && !sparks.length;
    });
  }

  /* ---------- 2. confetti ---------- */
  function confetti() {
    var bits = [], fired = 0;
    function burst(x, dir, W, H) {
      for (var i = 0; i < 90; i++) {
        var ang = -Math.PI / 2 + dir * rnd(0.1, 0.9) + rnd(-0.15, 0.15);
        var sp = rnd(H * 0.7, H * 1.25);
        bits.push({
          x: x, y: H + 6, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          w: rnd(6, 11), h: rnd(9, 16), rot: rnd(0, TAU), vr: rnd(-9, 9),
          flip: rnd(0, TAU), vf: rnd(4, 11), color: pick(COLORS), round: Math.random() < 0.2
        });
      }
    }
    return play(function (ctx, dt, t, W, H) {
      if (!fired) { burst(-4, 1, W, H); burst(W + 4, -1, W, H); fired = 1; }
      if (fired === 1 && t > 0.7) { burst(W * 0.15, 0.6, W, H); burst(W * 0.85, -0.6, W, H); fired = 2; }
      ctx.clearRect(0, 0, W, H);
      var alive = 0;
      for (var i = 0; i < bits.length; i++) {
        var b = bits[i];
        if (b.y > H + 30) continue;
        alive++;
        b.vx *= Math.pow(0.12, dt); b.vy = b.vy * Math.pow(0.35, dt) + 420 * dt;
        b.x += b.vx * dt; b.y += b.vy * dt; b.rot += b.vr * dt; b.flip += b.vf * dt;
        ctx.save();
        ctx.translate(b.x, b.y); ctx.rotate(b.rot); ctx.scale(1, Math.cos(b.flip));
        ctx.fillStyle = b.color;
        if (b.round) { ctx.beginPath(); ctx.arc(0, 0, b.w / 2, 0, TAU); ctx.fill(); }
        else ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
      return fired === 2 && !alive;
    });
  }

  /* ---------- 3. unicorn with a rainbow trail ---------- */
  function unicorn() {
    var W0 = global.innerWidth, H0 = global.innerHeight;
    var dir = Math.random() < 0.5 ? 1 : -1;          // 1: left to right
    var dur = 3.4, size = Math.max(56, Math.min(96, W0 / 9));
    var baseY = H0 * rnd(0.3, 0.55), amp = H0 * 0.07, trail = [], stars = [];
    return play(function (ctx, dt, t, W, H) {
      ctx.clearRect(0, 0, W, H);
      var p = Math.min(t / dur, 1);
      var margin = size * 1.2;
      var x = dir > 0 ? -margin + (W + margin * 2) * p : W + margin - (W + margin * 2) * p;
      var y = baseY + Math.sin(p * TAU * 1.5) * amp;
      trail.push({ x: x, y: y });
      var band = size * 0.1, keep = Math.round(W / 4.2);
      if (trail.length > keep) trail.splice(0, trail.length - keep);

      // rainbow: seven parallel ribbons following the unicorn's path, fading toward the tail
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      for (var c = 0; c < RAINBOW.length; c++) {
        var off = (c - 3) * band + size * 0.12;
        for (var i = 1; i < trail.length; i++) {
          var a = i / trail.length;
          ctx.globalAlpha = Math.pow(a, 1.3) * 0.95;
          ctx.strokeStyle = RAINBOW[c];
          ctx.lineWidth = band + 0.8;
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x - dir * 0, trail[i - 1].y + off);
          ctx.lineTo(trail[i].x, trail[i].y + off);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;

      if (Math.random() < 0.6 && p < 1) stars.push({ x: x - dir * size * 0.5 + rnd(-8, 8), y: y + rnd(-size * 0.5, size * 0.5), life: 1, r: rnd(3, 7), color: pick(RAINBOW) });
      for (var s = stars.length - 1; s >= 0; s--) {
        var st = stars[s];
        st.life -= dt * 1.4; st.y += 20 * dt; st.x -= dir * 15 * dt;
        if (st.life <= 0) { stars.splice(s, 1); continue; }
        sparkle(ctx, st.x, st.y, st.r * (0.6 + st.life * 0.6), st.color, st.life);
      }

      ctx.save();
      ctx.translate(x, y);
      if (dir > 0) ctx.scale(-1, 1);                  // the emoji faces left
      ctx.rotate(Math.sin(t * 9) * 0.04);
      ctx.font = size + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('🦄', 0, 0);
      ctx.restore();

      return p >= 1 && !stars.length;
    });
  }

  /* ---------- 4. balloons ---------- */
  function balloons() {
    var list = [], spawned = 0, total = 26, nextAt = 0;
    return play(function (ctx, dt, t, W, H) {
      ctx.clearRect(0, 0, W, H);
      while (spawned < total && t >= nextAt) {
        spawned++; nextAt += rnd(0.04, 0.12);
        var r = rnd(20, 34);
        list.push({ x: rnd(r, W - r), y: H + r * 2.5, r: r, vy: rnd(120, 220), ph: rnd(0, TAU), sw: rnd(10, 26), color: pick(COLORS) });
      }
      var alive = 0;
      for (var i = 0; i < list.length; i++) {
        var b = list[i];
        b.y -= b.vy * dt;
        if (b.y < -b.r * 4) continue;
        alive++;
        var x = b.x + Math.sin(t * 1.8 + b.ph) * b.sw, y = b.y;
        ctx.strokeStyle = 'rgba(120,120,120,0.55)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, y + b.r * 1.25);
        ctx.quadraticCurveTo(x + Math.sin(t * 2.4 + b.ph) * 8, y + b.r * 2.2, x, y + b.r * 3.2); ctx.stroke();
        ctx.fillStyle = b.color;
        ctx.beginPath(); ctx.ellipse(x, y, b.r * 0.82, b.r, 0, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, y + b.r * 0.98); ctx.lineTo(x - 4, y + b.r * 1.28); ctx.lineTo(x + 4, y + b.r * 1.28); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath(); ctx.ellipse(x - b.r * 0.3, y - b.r * 0.35, b.r * 0.16, b.r * 0.3, 0.5, 0, TAU); ctx.fill();
      }
      return spawned >= total && !alive;
    });
  }

  /* ---------- 5. rocket with a flame trail, ending in a star burst ---------- */
  function rocket() {
    var flip = Math.random() < 0.5;                   // false: bottom-left to top-right
    var dur = 2.2, size = 64, puffs = [], stars = [], burstDone = false;
    return play(function (ctx, dt, t, W, H) {
      ctx.clearRect(0, 0, W, H);
      var p = Math.min(t / dur, 1), e = p * p * (3 - 2 * p) * 0.35 + p * 0.65;
      var sx = flip ? W + size : -size, ex = flip ? W * 0.62 : W * 0.38;
      var sy = H + size, ey = H * 0.16;
      var x = sx + (ex - sx) * e, y = sy + (ey - sy) * e;
      var dx = flip ? 1 : -1;
      if (p < 1) {
        for (var k = 0; k < 3; k++) puffs.push({ x: x + dx * size * 0.3 + rnd(-4, 4), y: y + size * 0.3 + rnd(-4, 4), vx: dx * rnd(10, 50), vy: rnd(40, 110), life: 1, r: rnd(5, 11), hot: Math.random() < 0.6 });
      }
      for (var i = puffs.length - 1; i >= 0; i--) {
        var q = puffs[i];
        q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt * 1.5;
        if (q.life <= 0) { puffs.splice(i, 1); continue; }
        ctx.globalAlpha = q.life * 0.8;
        ctx.fillStyle = q.hot ? (q.life > 0.6 ? '#ffd60a' : '#ff7b00') : '#d0d0d0';
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (1.2 - q.life * 0.5), 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (p >= 1 && !burstDone) {
        burstDone = true;
        for (var n = 0; n < 40; n++) {
          var a = (n / 40) * TAU, sp = rnd(80, 280);
          stars.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, r: rnd(4, 9), color: pick(COLORS) });
        }
      }
      for (var s = stars.length - 1; s >= 0; s--) {
        var st = stars[s];
        st.vx *= 0.97; st.vy = st.vy * 0.97 + 120 * dt; st.x += st.vx * dt; st.y += st.vy * dt; st.life -= dt * 0.9;
        if (st.life <= 0) { stars.splice(s, 1); continue; }
        sparkle(ctx, st.x, st.y, st.r * (0.5 + st.life * 0.6), st.color, st.life);
      }
      if (p < 1) {
        ctx.save();
        ctx.translate(x, y);
        if (flip) ctx.scale(-1, 1);                   // the emoji points up-right
        ctx.font = size + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('🚀', 0, 0);
        ctx.restore();
      }
      return burstDone && !stars.length && !puffs.length;
    });
  }

  var kinds = { fireworks: fireworks, confetti: confetti, unicorn: unicorn, balloons: balloons, rocket: rocket };
  var names = Object.keys(kinds);
  var lastKind = '';

  /* ---------- when to celebrate ---------- */
  var EVERY = 20;
  var COUNT_KEY = 'hubCelebrateDoneCount';

  function taskDone(t) { return !!t && (t.statusId === 'C' || t.done === true); }
  function msDone(m) { return !!m && (m.status ? m.status === 'done' : !!m.done); }

  /* What newly became done between two versions of the project document.
     Only items present in both versions count (a task created already done does not).
     { licensing, milestones, regular }: how many of each. */
  function detect(oldD, newD) {
    var out = { licensing: 0, milestones: 0, regular: 0 };
    if (!oldD || !newD) return out;
    var before = {};
    (oldD.sheets || []).forEach(function (s) {
      (s.tasks || []).forEach(function (t) { before[t.id] = taskDone(t); });
    });
    (newD.sheets || []).forEach(function (s) {
      (s.tasks || []).forEach(function (t) {
        if (before[t.id] === false && taskDone(t)) {
          if (s.track === 'licensing') out.licensing++; else out.regular++;
        }
      });
    });
    var oldMs = {};
    (oldD.licensingMilestones || []).forEach(function (m) { oldMs[m.id] = msDone(m); });
    (newD.licensingMilestones || []).forEach(function (m) {
      if (oldMs[m.id] === false && msDone(m)) out.milestones++;
    });
    return out;
  }

  /* Pure: given the running count of completed regular tasks and what just got done,
     returns { fire, count }. Fires for any licensing task or milestone, and each time the
     regular count passes a multiple of EVERY. */
  function decide(count, found) {
    var next = count + found.regular;
    var crossed = Math.floor(next / EVERY) > Math.floor(count / EVERY);
    return { fire: found.licensing > 0 || found.milestones > 0 || crossed, count: next };
  }

  /* Called by the hub on each local save. The regular-task count is per browser (localStorage). */
  function onSave(oldD, newD) {
    var found = detect(oldD, newD);
    if (!found.licensing && !found.milestones && !found.regular) return;
    var count = 0;
    try { count = parseInt(global.localStorage.getItem(COUNT_KEY), 10) || 0; } catch (e) {}
    var r = decide(count, found);
    try { global.localStorage.setItem(COUNT_KEY, String(r.count)); } catch (e) {}
    if (r.fire) global.Celebrate.play();
  }

  global.Celebrate = {
    detect: detect,
    decide: decide,
    onSave: onSave,
    EVERY: EVERY,
    kinds: names,
    play: function (kind) {
      if (reduced()) return null;
      if (!kinds[kind]) {                              // random, never the same one twice in a row
        var pool = names.filter(function (n) { return n !== lastKind; });
        kind = pick(pool);
      }
      lastKind = kind;
      return kinds[kind]();
    },
    stop: function () { if (current) current.stop(); }
  };
})(typeof window !== 'undefined' ? window : (globalThis.window = globalThis));
if (typeof module !== 'undefined' && module.exports && typeof window !== 'undefined') module.exports = window.Celebrate;
