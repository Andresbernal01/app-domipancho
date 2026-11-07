// pull-to-refresh.js — Deslizar hacia abajo (estando arriba del todo) para recargar.
// Estilo Material: un círculo con flecha baja desde el header, gira según el
// arrastre y al soltar pasado el umbral queda girando hasta que termina la carga.
// No mueve el contenido (solo el indicador), así no hay saltos ni repintados caros.
(function () {
    'use strict';
  
    const UMBRAL = 72;      // px de arrastre (ya con resistencia) para disparar
    const MAX = 120;        // tope del arrastre visual
    const REPOSO = 64;      // posición del indicador mientras recarga
    const MIN_VISIBLE = 450; // ms mínimos girando (evita un parpadeo si la red es muy rápida)
  
    let indicador = null;
    let startY = 0, startX = 0;
    let tirando = false, decidido = false, recargando = false;
    let distancia = 0;
  
    function crearIndicador() {
      indicador = document.createElement('div');
      indicador.className = 'ptr-indicador';
      indicador.setAttribute('aria-hidden', 'true');
      indicador.innerHTML = `
        <svg class="ptr-flecha" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
        </svg>
        <span class="ptr-spinner"></span>`;
      document.body.appendChild(indicador);
    }
  
    // ¿Hay algo encima de la página (modal, mapa, banner) que deba recibir el gesto?
    function hayCapaEncima() {
      const abiertos = document.querySelectorAll('.modal-problema, .modal-overlay, .modal-mapa-fullscreen');
      for (const el of abiertos) {
        if (el.style.display && el.style.display !== 'none') return true;
      }
      return !!document.querySelector('.success-modal.show');
    }
  
    function enLoAlto() {
      return (window.scrollY || document.documentElement.scrollTop || 0) <= 0;
    }
  
    function pintar(d) {
      const p = Math.min(d / UMBRAL, 1);
      indicador.style.transform = `translate(-50%, ${d - 48}px) rotate(${d * 2.6}deg)`;
      indicador.style.opacity = String(Math.min(1, p * 1.4));
      indicador.classList.toggle('listo', d >= UMBRAL);
    }
  
    function ocultar() {
      indicador.classList.add('animando');
      indicador.style.transform = 'translate(-50%, -48px) scale(0.6)';
      indicador.style.opacity = '0';
      setTimeout(() => {
        indicador.classList.remove('animando', 'cargando', 'listo');
      }, 260);
    }
  
    function vibrar() {
      try {
        const H = window.Capacitor?.Plugins?.Haptics;
        if (H) H.impact({ style: 'LIGHT' });
        else if (navigator.vibrate) navigator.vibrate(12);
      } catch (e) { /* sin vibración */ }
    }
  
    async function disparar() {
      recargando = true;
      indicador.classList.add('animando', 'cargando');
      indicador.style.transform = `translate(-50%, ${REPOSO - 48}px)`;
      indicador.style.opacity = '1';
      vibrar();
  
      const t0 = Date.now();
      try {
        if (typeof window.refrescarVistaActual === 'function') {
          await window.refrescarVistaActual();
        }
      } catch (e) {
        console.warn('Pull-to-refresh: error recargando', e);
      }
      const resta = MIN_VISIBLE - (Date.now() - t0);
      if (resta > 0) await new Promise(r => setTimeout(r, resta));
  
      ocultar();
      recargando = false;
    }
  
    function onStart(e) {
      if (recargando || e.touches.length !== 1) return;
      if (!enLoAlto() || hayCapaEncima()) return;
      if (e.target.closest('.bottom-nav, #fcm-notification-banner, input, textarea, select')) return;
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
      tirando = true;
      decidido = false;
      distancia = 0;
    }
  
    function onMove(e) {
      if (!tirando) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
  
      if (!decidido) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        // Solo es "pull" si el gesto es hacia abajo y más vertical que horizontal
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || !enLoAlto()) {
          tirando = false;
          return;
        }
        decidido = true;
        indicador.classList.remove('animando');
      }
  
      // Resistencia: cuanto más se tira, menos avanza (sensación natural)
      distancia = Math.min(MAX, dy * 0.55);
      if (distancia > 0 && e.cancelable) e.preventDefault(); // evita el rebote/scroll nativo
      pintar(distancia);
    }
  
    function onEnd() {
      if (!tirando) return;
      tirando = false;
      if (!decidido) return;
      if (distancia >= UMBRAL) disparar();
      else ocultar();
      distancia = 0;
    }
  
    function init() {
      crearIndicador();
      document.addEventListener('touchstart', onStart, { passive: true });
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd, { passive: true });
      document.addEventListener('touchcancel', onEnd, { passive: true });
    }
  
    // Disparo manual (botón de recargar del header) con la misma animación
    window.pullToRefresh = {
      disparar: () => { if (!recargando && indicador) return disparar(); }
    };
  
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();