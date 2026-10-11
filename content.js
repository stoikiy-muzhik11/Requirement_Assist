// Polarion Change Minimap - content script v1.6
// Vanilla JS, no dependencies.

(() => {
  'use strict';

  const KINDS = [
    { n: 'added',   c: '#2e9e4f', s: '.diff-html-added, .diff-added-image' },
    { n: 'removed', c: '#d13b3b', s: '.diff-html-removed, .diff-removed-image' },
    { n: 'changed', c: '#d69016', s: '.diff-html-changed, .diff-changed-image' },
  ];
  const ALL = KINDS.map(k => k.s).join(', ');

  const WIDTH  = 11;  // strip width in px
  const TICK   = 4;   // tick height in px
  const MERGE  = 2;   // collapse ticks closer than this
  const SNAP   = 10;  // click within this many px of a tick jumps to it
  const NUDGE_X = 0;  // shift the strip left(-) or right(+) if it sits off

  function makeMinimap(win, doc) {
    let strip, badge, view, sc, page;
    let changes = [], marks = [], cursor = -1;
    let timer, settleTimer, quietUntil = 0, lastSig = '';

    const collect = () => {
      const items = [];
      for (const k of KINDS)
        for (const el of doc.querySelectorAll(k.s)) items.push({ el, k });
      const set = new Set(items.map(i => i.el));
      return items.filter(i => {
        let p = i.el.parentElement;
        while (p) { if (set.has(p)) return false; p = p.parentElement; }
        return i.el.getClientRects().length > 0;
      });
    };

    const findScroller = from => {
      let n = from;
      while (n && n !== doc.body && n !== doc.documentElement) {
        const o = win.getComputedStyle(n).overflowY;
        if (/auto|scroll/.test(o) && n.scrollHeight > n.clientHeight + 40) return n;
        n = n.parentElement;
      }
      return doc.scrollingElement || doc.documentElement;
    };

    const offsetIn = el => {
      const r = el.getBoundingClientRect();
      if (page) return r.top + (win.scrollY || 0);
      return r.top - sc.getBoundingClientRect().top + sc.scrollTop;
    };

    /* ---------- build ---------- */

    function build() {
      strip = doc.createElement('div');
      strip.id = 'pcm-strip';
      Object.assign(strip.style, {
        position: 'fixed', width: WIDTH + 'px', zIndex: 2147483000,
        background: 'rgba(0,0,0,.05)', cursor: 'pointer',
        pointerEvents: 'auto',
      });

      // One handler on the strip itself. The strip is never destroyed, so
      // a rebuild of the ticks can never swallow a click.
      strip.addEventListener('mousedown', e => {
        e.preventDefault();
        const r = strip.getBoundingClientRect();
        const y = e.clientY - r.top;

        // Snap to the nearest tick if one is close.
        let best = -1, bestD = SNAP;
        for (const m of marks) {
          const d = Math.abs(m.y - y);
          if (d < bestD) { bestD = d; best = m.i; }
        }
        if (best >= 0) return jump(best);

        // Otherwise behave like the scrollbar track.
        quietUntil = Date.now() + 600;
        sc.scrollTo({
          top: (y / (r.height || 1)) * sc.scrollHeight - sc.clientHeight / 2,
          behavior: 'smooth',
        });
      });

      badge = doc.createElement('div');
      badge.id = 'pcm-counter';
      Object.assign(badge.style, {
        position: 'fixed', zIndex: 2147483001,
        font: '11px system-ui, sans-serif', color: '#fff',
        background: 'rgba(30,30,30,.85)', padding: '3px 7px',
        borderRadius: '3px', pointerEvents: 'none', whiteSpace: 'nowrap',
      });

      view = doc.createElement('div');
      view.id = 'pcm-view';
      Object.assign(view.style, {
        position: 'absolute', left: '0px', right: '0px',
        background: 'rgba(60,120,220,.16)',
        border: '1px solid rgba(60,120,220,.5)',
        borderRadius: '2px', pointerEvents: 'none', boxSizing: 'border-box',
      });

      doc.body.append(strip, badge);
    }

    /* ---------- placement ---------- */

    // Sit flush against the scrollbar, whichever element owns it.
    function position() {
      if (page) {
        const sbw = Math.max(win.innerWidth - doc.documentElement.clientWidth, 0);
        const arrow = sbw;   // scrollbar arrow buttons are square
        Object.assign(strip.style, {
          top: arrow + 'px',
          height: Math.max(win.innerHeight - 2 * arrow, 10) + 'px',
          right: (sbw + NUDGE_X) + 'px', left: 'auto',
        });
        Object.assign(badge.style, {
          top: (arrow + 6) + 'px',
          right: (sbw + WIDTH + 6 + NUDGE_X) + 'px', left: 'auto',
        });
      } else {
        const r = sc.getBoundingClientRect();
        const cs = win.getComputedStyle(sc);
        const br = parseFloat(cs.borderRightWidth) || 0;
        const bl = parseFloat(cs.borderLeftWidth) || 0;
        const sbw = Math.max(sc.offsetWidth - sc.clientWidth - br - bl, 0);
        const arrow = sbw;
        const x = r.right - br - sbw - WIDTH + NUDGE_X;
        Object.assign(strip.style, {
          top: (r.top + arrow) + 'px',
          height: Math.max(r.height - 2 * arrow, 10) + 'px',
          left: x + 'px', right: 'auto',
        });
        Object.assign(badge.style, {
          top: (r.top + arrow + 6) + 'px',
          left: Math.max(x - 136, 4) + 'px', right: 'auto',
        });
      }
    }

    function updateView() {
      if (!view || !sc || !strip) return;
      const total = sc.scrollHeight || 1;
      const H = parseFloat(strip.style.height) || win.innerHeight;
      view.style.top = ((sc.scrollTop / total) * H) + 'px';
      view.style.height = Math.max((sc.clientHeight / total) * H, 6) + 'px';
      if (view.parentNode !== strip) strip.appendChild(view);
    }

    /* ---------- draw ---------- */

    function draw() {
      if (!doc.body) return;
      changes = collect();
      if (!changes.length) {
        if (strip) strip.style.display = badge.style.display = 'none';
        return;
      }
      if (!strip) build();
      strip.style.display = badge.style.display = '';

      sc = findScroller(changes[0].el);
      page = sc === doc.scrollingElement || sc === doc.documentElement || sc === doc.body;
      position();

      const total = sc.scrollHeight || 1;
      const H = parseFloat(strip.style.height) || win.innerHeight;

      changes.forEach(c => (c.y = offsetIn(c.el)));
      changes.sort((a, b) => a.y - b.y);

      const sig = changes.length + ':' + total + ':' + Math.round(H);
      if (sig === lastSig && strip.firstChild) { updateView(); return; }
      lastSig = sig;

      strip.textContent = '';
      marks = [];
      const seen = new Set(), counts = {};

      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        counts[c.k.n] = (counts[c.k.n] || 0) + 1;
        const y = Math.max(0, Math.min(Math.round((c.y / total) * H), H - TICK));
        const key = c.k.n + Math.round(y / MERGE);
        if (seen.has(key)) continue;
        seen.add(key);

        marks.push({ y, i });   // remembered for click snapping

        const t = doc.createElement('div');
        Object.assign(t.style, {
          position: 'absolute', left: '1px', right: '1px', top: y + 'px',
          height: TICK + 'px', background: c.k.c, borderRadius: '1px',
          pointerEvents: 'none',   // the strip handles all clicks
        });
        strip.appendChild(t);
      }

      strip.appendChild(view);
      updateView();

      badge.textContent = KINDS.filter(k => counts[k.n])
        .map(k => counts[k.n] + ' ' + k.n).join('  ');
    }

    /* ---------- navigation ---------- */

    function jump(i) {
      if (i < 0 || i >= changes.length) return;
      cursor = i;
      quietUntil = Date.now() + 900;
      const el = changes[i].el;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const prev = el.style.outline;
      el.style.outline = '2px solid #3b82f6';
      el.style.outlineOffset = '2px';
      win.setTimeout(() => (el.style.outline = prev), 1200);
      badge.textContent = 'change ' + (i + 1) + ' of ' + changes.length;
    }

    const nearest = () => {
      const mid = page ? (win.scrollY || 0) + win.innerHeight / 2
                       : sc.scrollTop + sc.clientHeight / 2;
      let best = 0;
      for (let i = 0; i < changes.length; i++) { if (changes[i].y <= mid) best = i; else break; }
      return best;
    };

    /* ---------- sync ---------- */

    const schedule = () => {
      win.clearTimeout(timer);
      timer = win.setTimeout(draw, Math.max(200, quietUntil - Date.now()));
    };

    const reposition = () => {
      if (!strip || strip.style.display === 'none') return;
      position();
      updateView();
      win.clearTimeout(settleTimer);
      settleTimer = win.setTimeout(() => { lastSig = ''; draw(); }, 400);
    };

    const onKey = e => {
      if (!changes.length || !e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName))) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); jump(cursor < 0 ? nearest() : Math.min(cursor + 1, changes.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); jump(cursor < 0 ? nearest() : Math.max(cursor - 1, 0)); }
    };

    new win.MutationObserver(schedule).observe(doc.documentElement, { childList: true, subtree: true });
    if (win.ResizeObserver) new win.ResizeObserver(schedule).observe(doc.documentElement);
    win.addEventListener('resize', schedule);
    win.addEventListener('scroll', reposition, true);
    doc.addEventListener('keydown', onKey);
    if (win !== win.top) { try { win.top.document.addEventListener('keydown', onKey); } catch (e) {} }

    draw();
    return draw;
  }

  /* ================================================================== */

  const done = new WeakSet();

  function attach(win, doc) {
    if (!doc || !doc.body || done.has(doc)) return;
    if (!doc.querySelector(ALL)) return;
    if (doc.getElementById('pcm-strip')) return;
    done.add(doc);
    const redraw = makeMinimap(win, doc);
    try { win.top.pcmRedraw = redraw; } catch (e) { win.pcmRedraw = redraw; }
    console.log('[minimap] active in', doc.location ? doc.location.href.slice(0, 70) : '(frame)');
  }

  function sweep(win, depth) {
    if (depth > 4) return;
    try {
      attach(win, win.document);
      for (const f of win.document.querySelectorAll('iframe, frame')) {
        if (f.contentWindow) sweep(f.contentWindow, depth + 1);
      }
    } catch (e) { /* cross-origin */ }
  }

  setTimeout(() => sweep(window, 0), 500);
  setInterval(() => sweep(window, 0), 2000);
})();