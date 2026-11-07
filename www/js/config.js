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
          window.location.href = '/login.html';
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


console.log('✅ config.js cargado completamente');