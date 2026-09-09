// ==UserScript==
// @name         Nuclear Focus
// @version      9.0
// @description  Isolate video into distraction-free focus mode
// @author       Admin
// @match        *://*/*
// @run-at       document-start
// @allFrames    true
// ==/UserScript==
(function () {
'use strict';

const MOBILE = matchMedia('(pointer: coarse)').matches;
const SPEEDS = [1, 1.25, 1.5, 2, 0.5, 0.75];
const Z = 2147483647;

let observer, debounceId, retryId, delay = 2000, speedIdx = 0;
let focusWrap = null, touchFns = null;

const $ = id => document.getElementById(id);

function cleanup() {
  $('iso-host')?.remove();
  observer?.disconnect();
  observer = null;
  clearTimeout(debounceId);
  clearTimeout(retryId);
  debounceId = retryId = null;
}

function findVideo() {
  for (const v of document.querySelectorAll('video')) {
    const r = v.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (/ad|advertisement|promo|banner|googleads|doubleclick/i.test(v.className)) continue;
    if (!v.src && !v.querySelector('source[src]')) continue;
    if (v.duration > 0 && v.duration < 3) continue;
    const s = getComputedStyle(v);
    if ((s.position === 'fixed' || s.position === 'absolute') &&
        (r.top > innerHeight * 0.8 || r.bottom < innerHeight * 0.2)) continue;
    if (r.height > 100 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0')
      return v;
  }
  return null;
}

function openInTab() {
  const a = document.createElement('a');
  a.href = location.href;
  a.rel = 'referrer';
  a.target = '_blank';
  document.body.append(a);
  a.click();
  a.remove();
}

function mkBtn(text, fn) {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'all:unset;color:#fff;font:600 12px/1 system-ui;padding:8px 12px;background:rgba(0,0,0,.85);border-radius:6px;cursor:pointer';
  b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); fn(); });
  return b;
}

function makeDraggable(el) {
  let dx = 0, dy = 0, drag = false;
  el.style.cursor = 'move';
  el.addEventListener('mousedown', e => {
    drag = true;
    const r = el.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    el.style.right = 'auto';
    el.style.left = `${e.clientX - dx}px`;
    el.style.top = `${e.clientY - dy}px`;
  });
  document.addEventListener('mouseup', () => drag = false);
}

function inject(video) {
  if ($('iso-host')) return;
  const host = document.createElement('div');
  host.id = 'iso-host';
  host.style.cssText = `position:fixed;top:${MOBILE ? 15 : 50}px;right:10px;z-index:${Z};display:flex;gap:6px`;
  host.append(self !== top
    ? mkBtn('⬆ EXTRACT', openInTab)
    : mkBtn('▶ FOCUS', () => enterFocus(video)));
  if (self === top && !MOBILE) makeDraggable(host);
  (document.body || document.documentElement).append(host);
}

function enterFocus(video) {
  if ($('p-wrap')) return;
  document.body.replaceChildren();
  cleanup();
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';

  const style = document.createElement('style');
  style.textContent = `
    #p-wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000}
    video{max-width:100%;max-height:100vh;object-fit:contain}
    #s-ind{position:fixed;top:15px;right:15px;z-index:${Z};color:#fff;font:12px system-ui;padding:8px;background:rgba(0,0,0,.5);border-radius:4px;cursor:pointer}`;
  document.head.append(style);

  const wrap = document.createElement('div');
  wrap.id = 'p-wrap';
  const ind = document.createElement('div');
  ind.id = 's-ind';
  ind.textContent = `${video.playbackRate}x`;
  ind.addEventListener('click', () => {
    speedIdx = (speedIdx + 1) % SPEEDS.length;
    video.playbackRate = SPEEDS[speedIdx];
    ind.textContent = `${SPEEDS[speedIdx]}x`;
  });

  document.body.append(wrap, ind);
  wrap.append(video);

  if (MOBILE && innerHeight > innerWidth)
    video.style.transform = 'scale(.8)';

  if (MOBILE) {
    let sx = 0, st = 0, swiping = false;
    const ts = e => { sx = e.touches[0].clientX; st = video.currentTime; swiping = false; };
    const tm = e => {
      if (!video.duration) return;
      const dx = e.touches[0].clientX - sx;
      if (!swiping && Math.abs(dx) > 50) swiping = true;
      if (!swiping) return;
      e.preventDefault();
      video.currentTime = Math.max(0, Math.min(video.duration,
        st + dx / wrap.getBoundingClientRect().width * video.duration * .5));
    };
    const te = () => swiping = false;
    touchFns = { ts, tm, te };
    focusWrap = wrap;
    wrap.addEventListener('touchstart', ts, { passive: true });
    wrap.addEventListener('touchmove', tm, { passive: false });
    wrap.addEventListener('touchend', te, { passive: true });
  }

  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape') location.reload();
    if (!MOBILE && e.key.toLowerCase() === 's') ind.click();
  });

  video.controls = true;
  video.play().catch(() => {});
}

function tick() {
  if ($('iso-host') || $('p-wrap')) return;
  const v = findVideo();
  if (v) {
    delay = 2000;
    inject(v);
  } else {
    clearTimeout(retryId);
    retryId = setTimeout(tick, delay);
    delay = Math.min(delay * 1.3, 12000);
  }
}

observer = new MutationObserver(() => {
  clearTimeout(debounceId);
  debounceId = setTimeout(tick, 800);
});
observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
tick();

addEventListener('beforeunload', () => {
  if (focusWrap && touchFns) {
    focusWrap.removeEventListener('touchstart', touchFns.ts);
    focusWrap.removeEventListener('touchmove', touchFns.tm);
    focusWrap.removeEventListener('touchend', touchFns.te);
    focusWrap = touchFns = null;
  }
  cleanup();
});
})();
