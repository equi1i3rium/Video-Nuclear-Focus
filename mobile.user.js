// ==UserScript==
// @name         Mobil Focus (Minimal)
// @version      5.13
// @description  Minimalist video player for mobile with volume, progress bar and swipe gestures - Firefox native controls support with auto-hide
// @author       Admin
// @match        *://*/*
// @exclude      *://*.youtube.com/*
// @grant        none
// @run-at       document-idle
// @allFrames    true
// ==/UserScript==

(function() {
    'use strict';

    const CONFIG = {
        SPEEDS: [1, 1.25, 1.5, 2, 0.5, 0.75],
        SEEK_STEP: 5,
        INITIAL_RETRY_DELAY: 2000,
        MAX_RETRY_DELAY: 12000,
        DEBOUNCE_DELAY: 350,
        MAX_Z_INDEX: 2147483647,
        PORTRAIT_SCALE: 0.8,
        STORAGE_PREFIX: 'mobilfocus_',
        CONTROLS_HIDE_DELAY: 3000
    };

    let state = { currentSpeedIdx: 0, currentRetryDelay: CONFIG.INITIAL_RETRY_DELAY };
    let observer = null, debounceTimerId = null, retryTimerId = null, touchListeners = null;
    let injectButtonStyleAdded = false, controlsTimeout = null;
    const listenerRegistry = [];

    const addTrackedListener = (el, evt, fn, opts) => { if (!el) return; el.addEventListener(evt, fn, opts); listenerRegistry.push({ el, evt, fn, opts }); };
    const removeAllTrackedListeners = () => { listenerRegistry.forEach(({ el, evt, fn, opts }) => { try { el.removeEventListener(evt, fn, opts); } catch(e) {} }); listenerRegistry.length = 0; };

    const storage = {
        get: (key, defaultVal) => { try { const val = localStorage.getItem(CONFIG.STORAGE_PREFIX + key); return val !== null ? JSON.parse(val) : defaultVal; } catch(e) { return defaultVal; } },
 set: (key, val) => { try { localStorage.setItem(CONFIG.STORAGE_PREFIX + key, JSON.stringify(val)); } catch(e) {} }
    };

    const cleanup = () => {
        const host = document.getElementById('iso-portal-host'); if (host) host.remove();
        if (observer) { observer.disconnect(); observer = null; }
        if (debounceTimerId) { clearTimeout(debounceTimerId); debounceTimerId = null; }
        if (retryTimerId) { clearTimeout(retryTimerId); retryTimerId = null; }
        if (controlsTimeout) { clearTimeout(controlsTimeout); controlsTimeout = null; }
        removeAllTrackedListeners();
    };

    let focusWrap = null;
    const cleanupFocusMode = () => {
        if (focusWrap && touchListeners) { focusWrap.removeEventListener('touchstart', touchListeners.onTouchStart); focusWrap.removeEventListener('touchmove', touchListeners.onTouchMove); focusWrap.removeEventListener('touchend', touchListeners.onTouchEnd); touchListeners = null; focusWrap = null; }
        removeAllTrackedListeners();
    };

    const findVideoNuclear = () => {
        try {
            const candidates = document.querySelectorAll('video');
            for (const el of candidates) {
                try {
                    const rect = el.getBoundingClientRect();
                    if (rect.width <= 0 || rect.height <= 0) continue;
                    const classList = el.className.toLowerCase();
                    if (classList.includes('ad') || classList.includes('advertisement') || classList.includes('promo') || classList.includes('banner')) continue;
                    if (!el.src || el.src.length === 0) { const hasSource = el.querySelector('source[src]'); if (!hasSource) continue; }
                    if (!isNaN(el.duration) && el.duration > 0 && el.duration < 3) continue;
                    const style = window.getComputedStyle(el);
                    if (style.position === 'fixed' || style.position === 'absolute') { if (rect.top > window.innerHeight * 0.8 || rect.bottom < window.innerHeight * 0.2) continue; }
                    const isLargeEnough = rect.height > 100;
                    const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                    if (isLargeEnough && isVisible) return el;
                } catch (e) { continue; }
            }
        } catch (e) { return null; }
        return null;
    };

    const injectButton = (video) => {
        if (!video || document.getElementById('iso-portal-host')) return;
        const isIframe = window.self !== window.top;
        const host = document.createElement('div');
        host.id = 'iso-portal-host';
        host.style.cssText = `position: fixed !important; top: 15px !important; right: 10px !important; z-index: ${CONFIG.MAX_Z_INDEX} !important; display: flex !important; gap: 6px !important;`;
        if (!injectButtonStyleAdded) {
            const style = document.createElement('style');
            style.id = 'iso-host-style';
            style.textContent = `.iso-btn { all: unset !important; color: #fff !important; font-size: 12px !important; font-weight: 600 !important; cursor: pointer !important; padding: 8px 12px !important; min-width: 36px !important; min-height: 36px !important; text-align: center !important; background: rgba(0, 0, 0, 0.85) !important; border-radius: 6px !important; transition: transform 0.1s ease !important; }`;
            document.head.appendChild(style);
            injectButtonStyleAdded = true;
        }
        if (isIframe) {
            const extractBtn = document.createElement('button');
            extractBtn.className = 'iso-btn';
            extractBtn.innerText = '⬆ EXTRACT';
            extractBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { const a = document.createElement('a'); a.href = window.location.href; a.target = '_blank'; document.body.appendChild(a); a.click(); a.remove(); } catch(e) {} });
            host.appendChild(extractBtn);
        } else {
            const focusBtn = document.createElement('button');
            focusBtn.className = 'iso-btn';
            focusBtn.innerText = '▶ FOCUS';
            focusBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); launchFocus(video); });
            host.appendChild(focusBtn);
        }
        (document.body || document.documentElement).appendChild(host);
    };

    const launchFocus = (video) => {
        if (!video || document.getElementById('p-wrap')) return;
        try {
            const originalVolume = video.volume !== undefined ? video.volume : 1;
            cleanupFocusMode(); cleanup();
            document.body.replaceChildren();
            document.body.style.cssText = 'background: #000 !important; margin: 0 !important; overflow: hidden !important;';
            const isPortrait = window.innerHeight > window.innerWidth;
            const style = document.createElement('style');
            style.id = 'p-styles';
            style.textContent = `* { box-sizing: border-box; } #p-wrap { position: fixed; inset: 0; display: flex; justify-content: center; align-items: center; background: #000; } #p-controls { position: fixed; bottom: 0; left: 0; right: 0; padding: 15px; display: flex; flex-direction: column; gap: 10px; z-index: ${CONFIG.MAX_Z_INDEX}; opacity: 1; transition: opacity 0.3s ease; } #p-controls.hidden { opacity: 0; pointer-events: none; } video { max-width: 100% !important; max-height: calc(100vh - 180px) !important; width: 100% !important; height: auto !important; object-fit: contain !important; } video.portrait { transform: scale(${CONFIG.PORTRAIT_SCALE}) !important; } .ctrl-btn { all: unset; color: #fff; font-size: 12px; cursor: pointer; padding: 6px 10px; } #v-slider { width: 60px; height: 3px; accent-color: #fff; } #p-bar { width: 100%; min-height: 32px; display: flex; align-items: center; padding: 14px 0; } #p-bar-inner { width: 100%; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; cursor: pointer; position: relative; } #p-fill { height: 100%; background: #fff; border-radius: 2px; width: 0; transition: width 0.1s linear; } #p-time { color: #fff; font-size: 11px; } #s-ind { position: fixed; top: 15px; right: 15px; color: #fff; font-size: 12px; cursor: pointer; z-index: ${CONFIG.MAX_Z_INDEX}; padding: 8px; } #fs-btn { position: fixed; top: 15px; left: 15px; z-index: ${CONFIG.MAX_Z_INDEX}; } video::-moz-media-controls { display: block !important; } video::-webkit-media-controls { display: block !important; } :fullscreen video { object-fit: contain !important; width: 100vw !important; height: 100vh !important; }`;
            document.head.appendChild(style);
            const wrap = document.createElement('div'); wrap.id = 'p-wrap';
            const controls = document.createElement('div'); controls.id = 'p-controls';
            const progressBar = document.createElement('div'); progressBar.id = 'p-bar';
            const progressBarInner = document.createElement('div'); progressBarInner.id = 'p-bar-inner';
            const progressFill = document.createElement('div'); progressFill.id = 'p-fill';
            progressBarInner.appendChild(progressFill); progressBar.appendChild(progressBarInner);
            const timeDisplay = document.createElement('span'); timeDisplay.id = 'p-time'; timeDisplay.innerText = '0:00 / 0:00';
            const speedInd = document.createElement('div'); speedInd.id = 's-ind';
            const savedSpeedIdx = storage.get('speedIdx', 0);
            state.currentSpeedIdx = savedSpeedIdx;
            const currentSpeed = CONFIG.SPEEDS[savedSpeedIdx];
            speedInd.innerText = `${currentSpeed}x`;
            const fsBtn = document.createElement('button'); fsBtn.id = 'fs-btn'; fsBtn.className = 'ctrl-btn'; fsBtn.innerText = '⛶';
            fsBtn.addEventListener('click', () => { try { if (document.fullscreenElement) { document.exitFullscreen(); } else { document.documentElement.requestFullscreen(); } } catch(e) {} });
            const playPauseBtn = document.createElement('button'); playPauseBtn.className = 'ctrl-btn'; playPauseBtn.innerText = '❚❚';
            playPauseBtn.addEventListener('click', () => { try { if (video.paused) { video.play(); playPauseBtn.innerText = '❚❚'; showControlsTemporarily(); } else { video.pause(); playPauseBtn.innerText = '▶'; showControlsTemporarily(); } } catch(e) {} });
            const seekBackBtn = document.createElement('button'); seekBackBtn.className = 'ctrl-btn'; seekBackBtn.innerText = `-${CONFIG.SEEK_STEP}`;
            seekBackBtn.addEventListener('click', () => { try { video.currentTime = Math.max(0, video.currentTime - CONFIG.SEEK_STEP); } catch(e) {} showControlsTemporarily(); });
            const seekFwdBtn = document.createElement('button'); seekFwdBtn.className = 'ctrl-btn'; seekFwdBtn.innerText = `+${CONFIG.SEEK_STEP}`;
            seekFwdBtn.addEventListener('click', () => { try { video.currentTime = Math.min(video.duration || 0, video.currentTime + CONFIG.SEEK_STEP); } catch(e) {} showControlsTemporarily(); });
            const savedVolume = storage.get('volume', originalVolume);
            const savedMuted = storage.get('muted', false);
            const muteBtn = document.createElement('button'); muteBtn.className = 'ctrl-btn'; muteBtn.innerText = (savedMuted || savedVolume === 0) ? '🔇' : '🔊';
            muteBtn.addEventListener('click', () => { try { video.muted = !video.muted; muteBtn.innerText = video.muted ? '🔇' : '🔊'; storage.set('muted', video.muted); } catch(e) {} showControlsTemporarily(); });
            const volumeSlider = document.createElement('input'); volumeSlider.id = 'v-slider'; volumeSlider.type = 'range'; volumeSlider.min = '0'; volumeSlider.max = '1'; volumeSlider.step = '0.05'; volumeSlider.value = savedVolume;
            volumeSlider.addEventListener('input', (e) => { try { video.volume = parseFloat(e.target.value); video.muted = false; muteBtn.innerText = video.volume === 0 ? '🔇' : '🔊'; storage.set('volume', video.volume); } catch(e) {} });
            volumeSlider.addEventListener('touchstart', () => showControlsTemporarily());
            const controlsRow = document.createElement('div'); controlsRow.style.cssText = 'display: flex; align-items: center; justify-content: center; gap: 8px;';
            controlsRow.appendChild(fsBtn); controlsRow.appendChild(speedInd); controlsRow.appendChild(seekBackBtn); controlsRow.appendChild(playPauseBtn); controlsRow.appendChild(seekFwdBtn); controlsRow.appendChild(muteBtn); controlsRow.appendChild(volumeSlider);
            const bottomRow = document.createElement('div'); bottomRow.style.cssText = 'display: flex; align-items: center; gap: 10px;';
            bottomRow.appendChild(progressBar); bottomRow.appendChild(timeDisplay);
            controls.appendChild(bottomRow); controls.appendChild(controlsRow);
            document.body.appendChild(wrap); document.body.appendChild(controls); wrap.appendChild(video);
            if (isPortrait) video.classList.add('portrait');
            // Firefox native controls AÇIK - otomatik gizleme ile
            video.controls = true;
            video.playbackRate = currentSpeed; video.volume = savedVolume; video.muted = savedMuted;
            speedInd.addEventListener('click', () => { state.currentSpeedIdx = (state.currentSpeedIdx + 1) % CONFIG.SPEEDS.length; video.playbackRate = CONFIG.SPEEDS[state.currentSpeedIdx]; speedInd.innerText = `${CONFIG.SPEEDS[state.currentSpeedIdx]}x`; storage.set('speedIdx', state.currentSpeedIdx); showControlsTemporarily(); });
            const hideDelay = CONFIG.CONTROLS_HIDE_DELAY;
            const hideControls = () => { if (!video.paused) controls.classList.add('hidden'); };
            const showControls = () => { controls.classList.remove('hidden'); };
            const showControlsTemporarily = () => { showControls(); if (controlsTimeout) clearTimeout(controlsTimeout); if (!video.paused) controlsTimeout = setTimeout(hideControls, hideDelay); };
            const resetControlsTimer = () => { if (controlsTimeout) clearTimeout(controlsTimeout); if (!video.paused) controlsTimeout = setTimeout(hideControls, hideDelay); };
            addTrackedListener(video, 'play', () => { resetControlsTimer(); });
            addTrackedListener(video, 'pause', () => { if (controlsTimeout) clearTimeout(controlsTimeout); showControls(); });
            addTrackedListener(video, 'seeking', () => { showControls(); });
            addTrackedListener(video, 'playing', () => { resetControlsTimer(); });
            addTrackedListener(wrap, 'touchstart', () => { showControlsTemporarily(); }, { passive: true });
            addTrackedListener(wrap, 'click', () => { showControlsTemporarily(); });
            const seekFromPosition = (clientX) => { try { const rect = progressBarInner.getBoundingClientRect(); const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)); if (video.duration && !isNaN(video.duration)) video.currentTime = percent * video.duration; } catch(e) {} };
            addTrackedListener(progressBar, 'click', (e) => { seekFromPosition(e.clientX); showControlsTemporarily(); });
            let isProgressTouching = false;
            addTrackedListener(progressBar, 'touchstart', (e) => { isProgressTouching = true; showControls(); seekFromPosition(e.touches[0].clientX); }, { passive: true });
            addTrackedListener(progressBar, 'touchmove', (e) => { if (isProgressTouching) { e.preventDefault(); seekFromPosition(e.touches[0].clientX); } }, { passive: false });
            addTrackedListener(progressBar, 'touchend', () => { isProgressTouching = false; showControlsTemporarily(); }, { passive: true });
            addTrackedListener(video, 'timeupdate', () => { try { if (!video.duration || isNaN(video.duration)) return; const percent = (video.currentTime / video.duration) * 100; progressFill.style.width = `${percent}%`; const currMin = Math.floor(video.currentTime / 60); const currSec = Math.floor(video.currentTime % 60); const durMin = Math.floor(video.duration / 60); const durSec = Math.floor(video.duration % 60); timeDisplay.innerText = `${currMin}:${currSec.toString().padStart(2, '0')} / ${durMin}:${durSec.toString().padStart(2, '0')}`; } catch(e) {} });
            let touchStartX = 0, touchStartTime = 0, isSwiping = false;
            const onTouchStart = (e) => { touchStartX = e.touches[0].clientX; touchStartTime = video.currentTime || 0; isSwiping = false; showControls(); };
            const onTouchMove = (e) => { const deltaX = e.touches[0].clientX - touchStartX; if (Math.abs(deltaX) > 50 && !isSwiping) isSwiping = true; if (isSwiping) { e.preventDefault(); try { const seekDelta = (deltaX / wrap.getBoundingClientRect().width) * (video.duration || 0) * 0.5; video.currentTime = Math.max(0, Math.min(video.duration || 0, touchStartTime + seekDelta)); const percent = video.duration ? (video.currentTime / video.duration) * 100 : 0; progressFill.style.width = `${percent}%`; } catch(e) {} } };
            const onTouchEnd = () => { isSwiping = false; showControlsTemporarily(); };
            touchListeners = { onTouchStart, onTouchMove, onTouchEnd }; focusWrap = wrap;
            wrap.addEventListener('touchstart', onTouchStart, { passive: true });
            wrap.addEventListener('touchmove', onTouchMove, { passive: false });
            wrap.addEventListener('touchend', onTouchEnd, { passive: true });
            addTrackedListener(window, 'keydown', (e) => { if (e.key === 'Escape') location.reload(); if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') showControlsTemporarily(); });
            video.play().catch(() => {});
        } catch (e) { console.error('[Mobil Focus] launchFocus error:', e); try { location.reload(); } catch(e2) {} }
    };

    const handleMutation = () => {
        if (document.getElementById('iso-portal-host') || document.getElementById('p-wrap')) return;
        const target = findVideoNuclear();
        if (target) { state.currentRetryDelay = CONFIG.INITIAL_RETRY_DELAY; injectButton(target); }
        else { if (retryTimerId) clearTimeout(retryTimerId); retryTimerId = setTimeout(handleMutation, state.currentRetryDelay); state.currentRetryDelay = Math.min(state.currentRetryDelay * 1.3, CONFIG.MAX_RETRY_DELAY); }
    };

    if (document.documentElement.clientWidth < 200) return;
    observer = new MutationObserver(() => { if (debounceTimerId) clearTimeout(debounceTimerId); debounceTimerId = setTimeout(handleMutation, CONFIG.DEBOUNCE_DELAY); });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    handleMutation();
    window.addEventListener('beforeunload', () => { cleanupFocusMode(); cleanup(); });
})();
