// config.js - VERSIÓN CON CAPACITOR HTTP

window.APP_CONFIG = {
  API_BASE: 'https://domipancho.com',
  API_TIMEOUT: 10000,
  GEOLOCATION_TIMEOUT: 15000,
  POLLING_INTERVAL: 30000,
  IS_MOBILE_APP: true
};

// config.js - AGREGAR al inicio después de APP_CONFIG
const SESSION_KEY = 'domipancho_session';

// Función para guardar sesión localmente
window.guardarSesion = function(usuario) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({
      usuario: usuario,
      timestamp: Date.now()
    }));
    console.log('✅ Sesión guardada localmente');
  } catch (error) {
    console.error('❌ Error guardando sesión:', error);
  }
};

// Función para recuperar sesión
window.recuperarSesion = function() {
  try {
    const sesionGuardada = localStorage.getItem(SESSION_KEY);
    if (!sesionGuardada) return null;
    
    const { usuario, timestamp } = JSON.parse(sesionGuardada);
    
    // Verificar que no sea muy antigua (7 días)
    const DURACION_SESION = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - timestamp > DURACION_SESION) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    
    return usuario;
  } catch (error) {
    console.error('❌ Error recuperando sesión:', error);
    return null;
  }
};

// Función para limpiar sesión
window.limpiarSesion = function() {
  localStorage.removeItem(SESSION_KEY);
  console.log('🗑️ Sesión limpiada');
};


// Detectar si estamos en Capacitor
const isCapacitor = !!window.Capacitor;

// ✅ RENDIMIENTO: logs de red solo en modo debug (localStorage.dp_debug = '1').
// En Android WebView cada console.log con objetos cuesta tiempo en cada request.
const DP_DEBUG = (() => { try { return localStorage.getItem('dp_debug') === '1'; } catch (e) { return false; } })();
const dpLog = DP_DEBUG ? console.log.bind(console) : () => {};

// ✅ RENDIMIENTO: deduplicación + micro-cache de GET.
// Varias partes de la app (polling, contadores, disponibilidad, FCM) piden el
// mismo endpoint casi al mismo tiempo. Ahora:
//  - Si ya hay una petición GET idéntica en vuelo → se reutiliza (1 sola request).
//  - Si se respondió hace < GET_CACHE_MS → se devuelve la misma respuesta.
//  - Cualquier POST/PUT/DELETE invalida el cache (los datos cambiaron).
const GET_CACHE_MS = 1500;
const _inflight = new Map();
const _getCache = new Map();

function _envolverRespuesta(status, headersObj, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key) => headersObj?.[key] ?? headersObj?.[String(key).toLowerCase()] },
    json: async () => data,
    text: async () => (typeof data === 'string' ? data : JSON.stringify(data))
  };
}

async function _requestNativo(url, options) {
  const { CapacitorHttp } = window.Capacitor.Plugins;
  const nativeOptions = {
    url,
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...options.headers
    },
    connectTimeout: window.APP_CONFIG.API_TIMEOUT,
    readTimeout: window.APP_CONFIG.API_TIMEOUT + 5000
  };
  if (options.body) {
    nativeOptions.data = typeof options.body === 'string' ? JSON.parse(options.body) : options.body;
  }
  const response = await CapacitorHttp.request(nativeOptions);
  dpLog('📱', nativeOptions.method, url, response.status);
  return _envolverRespuesta(response.status, response.headers, response.data);
}

async function _requestFetch(url, options) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), window.APP_CONFIG.API_TIMEOUT + 5000) : null;
  try {
    const response = await fetch(url, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...options.headers
      },
      signal: controller ? controller.signal : undefined
    });
    dpLog('🌐', options.method || 'GET', url, response.status);
    const text = await response.text();
    let data = text;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* no es JSON */ }
    const headersObj = {};
    response.headers.forEach((v, k) => { headersObj[k] = v; });
    return _envolverRespuesta(response.status, headersObj, data);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

window.apiRequest = async (endpoint, options = {}) => {
  const url = endpoint.startsWith('http') ? endpoint : `${window.APP_CONFIG.API_BASE}${endpoint}`;
  const method = (options.method || 'GET').toUpperCase();
  const usarNativo = isCapacitor && window.Capacitor?.Plugins?.CapacitorHttp;
  const ejecutar = () => (usarNativo ? _requestNativo(url, options) : _requestFetch(url, options));

  if (method !== 'GET') {
    // Una mutación cambia los datos: lo cacheado ya no es válido
    _getCache.clear();
    try {
      return await ejecutar();
    } catch (error) {
      console.error('❌ Error en request', method, endpoint, error);
      throw error;
    }
  }

  const cached = _getCache.get(url);
  if (cached && Date.now() - cached.t < GET_CACHE_MS) return cached.res;
  if (_inflight.has(url)) return _inflight.get(url);

  const p = ejecutar()
    .then(res => {
      if (res.ok) _getCache.set(url, { t: Date.now(), res });
      return res;
    })
    .catch(error => {
      console.error('❌ Error en request GET', endpoint, error);
      throw error;
    })
    .finally(() => _inflight.delete(url));
  _inflight.set(url, p);
  return p;
};

// Forzar datos frescos (pull-to-refresh, después de acciones)
window.apiRequest.invalidate = () => _getCache.clear();

// Resto de funciones helper...
window.isHtmlResponse = function(response, text) {
  const contentType = response.headers.get('content-type') || '';
  return (
    contentType.includes('text/html') ||
    text.trim().startsWith('<!DOCTYPE') ||
    text.trim().startsWith('<html')
  );
};

window.parseJsonSafely = async function(response) {
  const contentType = response.headers.get('content-type') || '';
  
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    console.error('⛔ Respuesta no es JSON. Content-Type:', contentType);
    console.error('📄 Respuesta del servidor:', text.substring(0, 300));
    
    if (window.isHtmlResponse(response, text)) {
      if (text.includes('login') || text.includes('auth')) {
        console.warn('🔒 Redirigiendo a login por respuesta HTML');
        setTimeout(() => {
          window.location.href = '/index.html';
        }, 1000);
      }
      throw new Error('El servidor devolvió HTML en lugar de JSON');
    }
    
    throw new Error('Respuesta no es JSON válido');
  }
  
  try {
    return await response.json();
  } catch (jsonError) {
    console.error('❌ Error parseando JSON:', jsonError);
    throw new Error('JSON inválido recibido del servidor');
  }
};


// ============================================================
//  SEGURIDAD: escapar texto antes de meterlo en innerHTML
// ============================================================
// Todo dato que escribe un cliente/restaurante (notas, dirección, nombre…)
// debe pasar por aquí antes de insertarse en una plantilla HTML.
window.escHtml = function(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

// ============================================================
//  CONTACTO: links de llamada y WhatsApp a partir de un teléfono
// ============================================================
// Devuelve solo dígitos (conserva "+" inicial) o null si no es un número usable.
window.normalizarTelefono = function(tel) {
  if (tel === null || tel === undefined) return null;
  const str = String(tel).trim();
  if (str.includes('*')) return null; // teléfono censurado
  const digitos = str.replace(/\D/g, '');
  if (digitos.length < 7) return null;
  return (str.startsWith('+') ? '+' : '') + digitos;
};

window.telHref = function(tel) {
  const n = window.normalizarTelefono(tel);
  return n ? `tel:${n}` : null;
};

// WhatsApp necesita el número con indicativo de país (Colombia = 57)
window.whatsappHref = function(tel, mensaje) {
  const n = window.normalizarTelefono(tel);
  if (!n) return null;
  let digitos = n.replace(/\D/g, '');
  if (digitos.length === 10 && digitos.startsWith('3')) digitos = '57' + digitos;
  if (digitos.length < 11) return null; // fijo local sin indicativo: WhatsApp no sirve
  return `https://wa.me/${digitos}` + (mensaje ? `?text=${encodeURIComponent(mensaje)}` : '');
};

// Abre tel:/wa.me fuera del WebView (app de teléfono / WhatsApp).
// En el APK, Capacitor intercepta la navegación a esquemas/hosts externos y la
// abre con un Intent de Android (no sale de la app). En navegador web, nueva pestaña.
window.abrirContacto = function(url) {
  if (!url || !/^(tel:|https:\/\/wa\.me\/)/.test(url)) return;
  if (window.Capacitor || url.startsWith('tel:')) {
    window.location.href = url;
  } else {
    window.open(url, '_blank', 'noopener');
  }
};

// ============================================================
//  COLA OFFLINE: acciones que no se pudieron enviar por falta de red
// ============================================================
// Si se cae el internet justo al marcar "Entregado", "Ya recogí", "Liberar"
// o "No entregado", la acción se guarda aquí (persistida en localStorage) y se
// reenvía sola cuando vuelve la conexión. Solo se encolan errores de RED: si el
// servidor responde con un error real (4xx/5xx) se informa al usuario como antes.
(function() {
  const COLA_KEY = 'dp_cola_acciones';
  let enviando = false;
  const listeners = [];

  function leer() {
    try { return JSON.parse(localStorage.getItem(COLA_KEY) || '[]'); } catch (e) { return []; }
  }
  function guardar(cola) {
    try { localStorage.setItem(COLA_KEY, JSON.stringify(cola)); } catch (e) { /* sin espacio */ }
    listeners.forEach(fn => { try { fn(cola); } catch (e) {} });
  }

  function hayRed() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  }

  // Ejecuta la acción; si falla por red la encola. Devuelve:
  //   { estado: 'ok' | 'error', res, data }   → el servidor respondió
  //   { estado: 'encolado' }                   → sin red, se enviará después
  async function ejecutarOEncolar({ pedidoId, tipo, endpoint, method, body, descripcion }) {
    const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, pedidoId, tipo, endpoint, method, body, descripcion, creado: Date.now() };

    // Ya hay una acción pendiente para este pedido → va detrás, para respetar el orden
    const cola = leer();
    if (!hayRed() || cola.some(a => a.pedidoId === pedidoId)) {
      cola.push(item);
      guardar(cola);
      return { estado: 'encolado' };
    }

    try {
      const res = await window.apiRequest(endpoint, { method, body: body ? JSON.stringify(body) : undefined });
      let data = null;
      try { data = await res.json(); } catch (e) { /* sin cuerpo JSON */ }
      return { estado: res.ok ? 'ok' : 'error', res, data };
    } catch (error) {
      const c = leer();
      c.push(item);
      guardar(c);
      return { estado: 'encolado' };
    }
  }

  // Reenvía la cola en orden. Se detiene al primer error de red.
  async function procesar() {
    if (enviando || !hayRed()) return;
    let cola = leer();
    if (!cola.length) return;
    enviando = true;
    const enviados = [];
    const rechazados = [];
    try {
      while (cola.length) {
        const item = cola[0];
        let res;
        try {
          res = await window.apiRequest(item.endpoint, { method: item.method, body: item.body ? JSON.stringify(item.body) : undefined });
        } catch (e) {
          break; // sigue sin red: reintentar más tarde
        }
        if (res.status === 401 || res.status === 403) break; // sesión vencida: esperar a que vuelva a entrar
        if (res.ok) {
          enviados.push(item);
        } else {
          let data = null;
          try { data = await res.json(); } catch (e) {}
          rechazados.push({ ...item, error: (data && data.error) || `Error ${res.status}` });
        }
        cola = leer().filter(a => a.id !== item.id);
        guardar(cola);
      }
    } finally {
      enviando = false;
    }

    if (enviados.length || rechazados.length) {
      if (window.apiRequest.invalidate) window.apiRequest.invalidate();
      const msg = window.mostrarMensaje || (() => {});
      if (enviados.length) {
        msg(`Conexión recuperada: ${enviados.length === 1 ? enviados[0].descripcion : enviados.length + ' acciones'} enviada${enviados.length === 1 ? '' : 's'}`, 'success');
      }
      rechazados.forEach(r => msg(`No se pudo enviar "${r.descripcion}": ${r.error}`, 'error'));
      if (typeof window.cargarPedidos === 'function') window.cargarPedidos();
    }
  }

  window.colaAcciones = {
    ejecutarOEncolar,
    procesar,
    pendientes: leer,
    pendientePara: (pedidoId) => leer().find(a => String(a.pedidoId) === String(pedidoId)) || null,
    limpiar: () => guardar([]),
    onCambio: (fn) => listeners.push(fn)
  };

  // Reintentar cuando vuelve la red, al volver a la app y cada 20 s
  window.addEventListener('online', () => setTimeout(procesar, 1000));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) procesar(); });
  setInterval(procesar, 20000);
  try {
    const Network = window.Capacitor?.Plugins?.Network;
    if (Network) Network.addListener('networkStatusChange', (s) => { if (s.connected) setTimeout(procesar, 1000); });
  } catch (e) { /* plugin no disponible */ }
  setTimeout(procesar, 3000);
})();

console.log('✅ config.js cargado completamente');