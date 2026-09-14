// ==UserScript==
// @name         Minimalist Focus (Ultra Minimal)
// @version      8.4
// @description  Aggressively cleans page to focus only on video content
// @author       Admin
// @match        *://*/*
// @exclude      *://*.youtube.com/*
// @grant        GM_openInTab
// @run-at       document-start
// @allFrames    true
// ==/UserScript==

(function() {
    'use strict';

    // ========== CONFIGURATION ==========
    const CONFIG = {
        SPEEDS: [1, 1.25, 1.5, 2, 0.5, 0.75],
        INITIAL_RETRY_DELAY: 2000,
        MAX_RETRY_DELAY: 12000,
        DEBOUNCE_DELAY: 800,
        MAX_Z_INDEX: 2147483647,
        STORAGE_KEY: 'minimalist-focus-prefs'
    };

    // ========== STATE ==========
    let state = {
        currentSpeedIdx: 0,
        isDragging: false,
        dragOffset: { x: 0, y: 0 },
        currentRetryDelay: 2000
    };

    let observer = null;
    let debounceTimerId = null;
    let retryTimerId = null;
    let dragListeners = null;

    // ========== FIX: PERSISTENT PREFERENCES (localStorage) ==========
    const loadPreferences = () => {
        try {
            const saved = localStorage.getItem(CONFIG.STORAGE_KEY);
            if (saved) {
                const prefs = JSON.parse(saved);
                if (typeof prefs.speedIdx === 'number' && prefs.speedIdx >= 0 && prefs.speedIdx < CONFIG.SPEEDS.length) {
                    state.currentSpeedIdx = prefs.speedIdx;
                }
                if (prefs.dragPos && typeof prefs.dragPos.x === 'number' && typeof prefs.dragPos.y === 'number') {
                    state.savedDragPos = prefs.dragPos;
                }
            }
        } catch (e) {
            console.warn('[MinimalistFocus] Tercihler yüklenemedi:', e.message);
        }
    };

    const savePreferences = () => {
        try {
            const host = document.getElementById('iso-portal-host');
            const prefs = {
                speedIdx: state.currentSpeedIdx,
                dragPos: host ? { x: parseInt(host.style.left) || 0, y: parseInt(host.style.top) || 0 } : null
            };
            localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(prefs));
        } catch (e) {
            console.warn('[MinimalistFocus] Tercihler kaydedilemedi:', e.message);
        }
    };

    // ========== FIX: SAFE EXECUTION WRAPPER (Error Handling) ==========
    const safeExecute = (fn, fallback, context = '') => {
        try {
            return fn();
        } catch (err) {
            console.warn(`[MinimalistFocus] Hata${context ? ' (' + context + ')' : ''}:`, err.message);
            if (fallback) return fallback();
            return undefined;
        }
    };

    // ========== CLEANUP ==========
    const cleanup = () => {
        safeExecute(() => {
            const host = document.getElementById('iso-portal-host');
            if (host) host.remove();
        }, null, 'cleanup:host');

            if (observer) {
                observer.disconnect();
                observer = null;
            }

            if (debounceTimerId) {
                clearTimeout(debounceTimerId);
                debounceTimerId = null;
            }

            if (retryTimerId) {
                clearTimeout(retryTimerId);
                retryTimerId = null;
            }

            if (dragListeners) {
                document.removeEventListener('mousemove', dragListeners.onMouseMove);
                document.removeEventListener('mouseup', dragListeners.onMouseUp);
                dragListeners = null;
            }
    };

    // ========== VIDEO FINDER ==========
    const findVideoNuclear = () => {
        return safeExecute(() => {
            const candidates = document.querySelectorAll('video');
            for (const el of candidates) {
                const rect = el.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) continue;

                const classList = (el.className || '').toString().toLowerCase();
                if (classList.includes('ad') || classList.includes('advertisement') ||
                    classList.includes('promo') || classList.includes('banner') ||
                    classList.includes('googleads') || classList.includes('doubleclick')) {
                    continue;
                    }

                    if (!el.src || el.src.length === 0) {
                        const hasSource = el.querySelector('source[src]');
                        if (!hasSource) continue;
                    }

                    if (el.duration > 0 && el.duration < 3) continue;

                    const style = window.getComputedStyle(el);
                if (style.position === 'fixed' || style.position === 'absolute') {
                    if (rect.top > window.innerHeight * 0.8 || rect.bottom < window.innerHeight * 0.2) {
                        continue;
                    }
                }

                const isLargeEnough = rect.height > 100;
                const isVisible = style.display !== 'none'
                && style.visibility !== 'hidden'
                && style.opacity !== '0';

                if (isLargeEnough && isVisible) return el;
            }
            return null;
        }, null, 'findVideo');
    };

    // ========== FIX: ACCESSIBILITY HELPERS ==========
    const setA11yAttrs = (el, options = {}) => {
        if (options.role) el.setAttribute('role', options.role);
        if (options.ariaLabel) el.setAttribute('aria-label', options.ariaLabel);
        if (options.tabindex !== undefined) el.setAttribute('tabindex', options.tabindex);
        if (options.ariaHidden) el.setAttribute('aria-hidden', options.ariaHidden);
    };

        const addKeyboardActivation = (el, handler) => {
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handler(e);
                }
            });
        };

        // ========== INJECT BUTTON ==========
        const injectButton = (video) => {
            if (document.getElementById('iso-portal-host')) return;

            const host = document.createElement('div');
            host.id = 'iso-portal-host';
            host.style.cssText = `
            position: fixed !important;
            top: 50px !important;
            right: 10px !important;
            z-index: ${CONFIG.MAX_Z_INDEX} !important;
            display: flex;
            align-items: center;
            background: rgba(0, 0, 0, 0.85) !important;
            border: 1px solid rgba(255, 255, 255, 0.3) !important;
            border-radius: 6px !important;
            padding: 2px !important;
            cursor: move !important;
            transition: box-shadow 0.2s, transform 0.2s !important;
            box-shadow: 0 2px 10px rgba(0,0,0,0.5) !important;
            `;

            // FIX: ARIA attributes for host
            setA11yAttrs(host, { role: 'toolbar', ariaLabel: 'Video Focus Araç Çubuğu' });

            // FIX: Restore saved position
            if (state.savedDragPos) {
                host.style.right = 'auto';
                host.style.left = state.savedDragPos.x + 'px';
                host.style.top = state.savedDragPos.y + 'px';
            }

            const onMouseDown = (e) => {
                if (e.target === host || e.target.id === 'iso-portal-toggle') {
                    state.isDragging = true;
                    const rect = host.getBoundingClientRect();
                    state.dragOffset.x = e.clientX - rect.left;
                    state.dragOffset.y = e.clientY - rect.top;
                    host.style.opacity = '0.9';
                }
            };

            // FIX: Viewport boundary check for drag
            const onMouseMove = (e) => {
                if (state.isDragging) {
                    const hostRect = host.getBoundingClientRect();
                    const maxX = window.innerWidth - hostRect.width;
                    const maxY = window.innerHeight - hostRect.height;

                    const newX = Math.max(0, Math.min(e.clientX - state.dragOffset.x, maxX));
                    const newY = Math.max(0, Math.min(e.clientY - state.dragOffset.y, maxY));

                    host.style.right = 'auto';
                    host.style.left = newX + 'px';
                    host.style.top = newY + 'px';
                }
            };

            const onMouseUp = () => {
                if (state.isDragging) {
                    state.isDragging = false;
                    host.style.opacity = '1';
                    // FIX: Save position after drag ends
                    savePreferences();
                }
            };

            dragListeners = { onMouseMove, onMouseUp };

            host.addEventListener('mousedown', onMouseDown);
            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);

            const shadow = host.attachShadow({ mode: 'closed' }); // FIX: closed mode for security
            const isIframe = window.self !== window.top;

            if (isIframe) {
                const btn = document.createElement('button');
                btn.style.cssText = `
                all: unset !important;
                padding: 4px 8px !important;
                color: #fff !important;
                cursor: pointer !important;
                font-family: monospace !important;
                font-size: 10px !important;
                white-space: nowrap;
                background: rgba(0, 0, 0, 0.85) !important;
                border-radius: 6px !important;
                transition: background 0.2s;
                `;
                btn.innerText = 'EXTRACT';
                // FIX: Accessibility
                setA11yAttrs(btn, { role: 'button', ariaLabel: 'Videoyu yeni sekmede aç', tabindex: '0' });

                btn.addEventListener('mouseover', () => btn.style.background = 'rgba(255,255,255,0.2)');
                btn.addEventListener('mouseout', () => btn.style.background = 'rgba(0, 0, 0, 0.85)');
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    safeExecute(() => {
                        const url = window.location.href;
                        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                            const a = document.createElement('a');
                            a.href = url;
                            a.rel = 'referrer';
                            a.target = '_blank';
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                        }
                    }, null, 'extract');
                });
                // FIX: Keyboard activation
                addKeyboardActivation(btn, () => btn.click());

                shadow.appendChild(btn);
            } else {
                const toggle = document.createElement('div');
                toggle.id = 'iso-portal-toggle';
                toggle.innerHTML = '&#9654;';
                toggle.style.cssText = `
                padding: 4px 6px;
                color: #fff;
                cursor: pointer;
                font-family: monospace;
                font-size: 10px;
                border-right: 1px solid #555;
                user-select: none;
                transition: background 0.2s;
                `;
                // FIX: Accessibility
                setA11yAttrs(toggle, { role: 'button', ariaLabel: 'Araç çubuğunu aç/kapat', tabindex: '0' });

                const btn = document.createElement('button');
                btn.innerText = 'FOCUS';
                btn.style.cssText = `
                all: unset !important;
                padding: 4px 8px !important;
                color: #fff !important;
                cursor: pointer !important;
                font-family: monospace !important;
                font-size: 10px !important;
                white-space: nowrap;
                transition: background 0.2s;
                `;
                // FIX: Accessibility
                setA11yAttrs(btn, { role: 'button', ariaLabel: 'Video odak modunu etkinleştir', tabindex: '0' });

                let isOpen = true;
                toggle.addEventListener('click', () => {
                    isOpen = !isOpen;
                    btn.style.display = isOpen ? 'block' : 'none';
                    toggle.innerHTML = isOpen ? '&#9654;' : '&#9664;';
                    toggle.setAttribute('aria-expanded', isOpen.toString());
                });
                // FIX: Keyboard activation for toggle
                addKeyboardActivation(toggle, () => toggle.click());

                toggle.addEventListener('mouseover', () => toggle.style.background = 'rgba(255,255,255,0.2)');
                toggle.addEventListener('mouseout', () => toggle.style.background = 'transparent');
                btn.addEventListener('mouseover', () => btn.style.background = 'rgba(255,255,255,0.2)');
                btn.addEventListener('mouseout', () => btn.style.background = 'transparent');

                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopImmediatePropagation();
                    launchFocus(video);
                });
                // FIX: Keyboard activation for focus button
                addKeyboardActivation(btn, () => btn.click());

                shadow.appendChild(toggle);
                shadow.appendChild(btn);
            }

            // FIX: Safe DOM insertion
            safeExecute(() => {
                const target = document.body || document.documentElement;
                if (target) target.appendChild(host);
            }, null, 'inject:host');
        };

        // ========== FOCUS MODE ==========
        const launchFocus = (video) => {
            if (document.getElementById('p-wrap')) return;

            const originalSpeed = CONFIG.SPEEDS[state.currentSpeedIdx];
            video.playbackRate = originalSpeed;

            // Aggressive cleanup
            document.body.replaceChildren();
            cleanup();

            document.body.style.cssText = 'background: #000 !important; margin: 0 !important; overflow: hidden !important; width: 100vw; height: 100vh;';

            const style = document.createElement('style');
            style.id = 'p-styles';
            style.textContent = `
            html, body { background: #000 !important; }
            #p-wrap { position: fixed; inset: 0; display: flex; justify-content: center; align-items: center; background: #000; }
            video, canvas { max-width: 100% !important; max-height: 100vh !important; width: auto !important; height: auto !important; object-fit: contain !important; outline: none !important; }
            #s-ind { position: fixed; top: 20px; right: 20px; color: #888; font-family: monospace; cursor: pointer; z-index: ${CONFIG.MAX_Z_INDEX}; font-size: 14px; transition: color 0.2s; padding: 8px 12px; background: rgba(0,0,0,0.5); border-radius: 4px; }
            #s-ind:hover, #s-ind:focus { color: #fff; outline: 2px solid rgba(255,255,255,0.3); }
            `;
            document.head.appendChild(style);

            const wrap = document.createElement('div');
            wrap.id = 'p-wrap';

            const speedInd = document.createElement('div');
            speedInd.id = 's-ind';
            speedInd.innerText = `${originalSpeed}X`;
            // FIX: Accessibility for speed indicator
            setA11yAttrs(speedInd, { role: 'button', ariaLabel: `Oynatma hızı: ${originalSpeed}x. Değiştirmek için tıklayın.`, tabindex: '0' });

            speedInd.addEventListener('click', () => {
                state.currentSpeedIdx = (state.currentSpeedIdx + 1) % CONFIG.SPEEDS.length;
                video.playbackRate = CONFIG.SPEEDS[state.currentSpeedIdx];
                speedInd.innerText = `${CONFIG.SPEEDS[state.currentSpeedIdx]}X`;
                speedInd.setAttribute('aria-label', `Oynatma hızı: ${CONFIG.SPEEDS[state.currentSpeedIdx]}x. Değiştirmek için tıklayın.`);
                // FIX: Save speed preference
                savePreferences();
            });
            // FIX: Keyboard activation for speed indicator
            addKeyboardActivation(speedInd, () => speedInd.click());

            document.body.appendChild(wrap);
            document.body.appendChild(speedInd);
            wrap.appendChild(video);

            // FIX: Enhanced keyboard shortcuts with error handling
            const keyHandler = (e) => {
                safeExecute(() => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                    switch(e.key) {
                        case 'Escape':
                            e.preventDefault();
                            location.reload();
                            break;
                        case 's': case 'S':
                            e.preventDefault();
                            speedInd.click();
                            break;
                    }
                }, null, 'keyboard');
            };
            window.addEventListener('keydown', keyHandler);

            video.controls = true;
            video.play().catch((err) => {
                console.warn('[MinimalistFocus] Video oynatılamadı:', err.message);
            });
        };

        // ========== MUTATION HANDLER ==========
        const handleMutation = () => {
            if (document.getElementById('iso-portal-host') || document.getElementById('p-wrap')) return;

            const target = findVideoNuclear();
            if (target) {
                state.currentRetryDelay = CONFIG.INITIAL_RETRY_DELAY;
                injectButton(target);
            } else {
                if (retryTimerId) clearTimeout(retryTimerId);
                retryTimerId = setTimeout(handleMutation, state.currentRetryDelay);
                state.currentRetryDelay = Math.min(state.currentRetryDelay * 1.3, CONFIG.MAX_RETRY_DELAY);
            }
        };

        // ========== FIX: SPA COMPATIBILITY (History API) ==========
        const setupSPACompat = () => {
            // popstate listener
            window.addEventListener('popstate', () => {
                safeExecute(() => {
                    cleanup();
                    setTimeout(handleMutation, 1000);
                }, null, 'spa:popstate');
            });

            // Override pushState
            const origPushState = history.pushState;
            history.pushState = function() {
                origPushState.apply(this, arguments);
                safeExecute(() => {
                    cleanup();
                    setTimeout(handleMutation, 1000);
                }, null, 'spa:pushState');
            };

            // Override replaceState
            const origReplaceState = history.replaceState;
            history.replaceState = function() {
                origReplaceState.apply(this, arguments);
                safeExecute(() => {
                    cleanup();
                    setTimeout(handleMutation, 1000);
                }, null, 'spa:replaceState');
            };
        };

        // ========== INITIALIZATION ==========
        const init = () => {
            // FIX: Load saved preferences
            loadPreferences();

            // FIX: SPA compatibility
            setupSPACompat();

            // FIX: Safe observer setup - use documentElement as fallback
            const observeTarget = document.body || document.documentElement;
            if (!observeTarget) {
                // If neither exists yet, wait for DOM ready
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', init, { once: true });
                }
                return;
            }

            observer = new MutationObserver(() => {
                if (debounceTimerId) clearTimeout(debounceTimerId);
                debounceTimerId = setTimeout(handleMutation, CONFIG.DEBOUNCE_DELAY);
            });

            observer.observe(observeTarget, {
                childList: true,
                subtree: true
            });

            handleMutation();
        };

        // FIX: Safe initialization based on document state
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init, { once: true });
        } else {
            init();
        }

        window.addEventListener('beforeunload', () => {
            savePreferences();
            cleanup();
        });
})();
