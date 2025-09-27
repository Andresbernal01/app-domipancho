// config.js - VERSIÓN CON CAPACITOR HTTP
console.log('🔧 config.js cargando...');

window.APP_CONFIG = {
  API_BASE: 'https://domipancho.com',
  API_TIMEOUT: 10000,
  GEOLOCATION_TIMEOUT: 15000,
  POLLING_INTERVAL: 30000,
  IS_MOBILE_APP: true
};

console.log('🔧 APP_CONFIG definido:', window.APP_CONFIG);

// Detectar si estamos en Capacitor
const isCapacitor = !!window.Capacitor;

// Función helper mejorada para requests
window.apiRequest = async (endpoint, options = {}) => {
  console.log('🌐 apiRequest llamado:', endpoint);
  
  const url = endpoint.startsWith('http') ? endpoint : `${window.APP_CONFIG.API_BASE}${endpoint}`;
  console.log('🌐 URL final:', url);

  // ✅ SI ES CAPACITOR, USAR CapacitorHttp (evita CORS)
  if (isCapacitor && window.Capacitor?.Plugins?.CapacitorHttp) {
    try {
      const { CapacitorHttp } = window.Capacitor.Plugins;
      
      const nativeOptions = {
        url: url,
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...options.headers
        }
      };

      // Agregar body si existe
      if (options.body) {
        nativeOptions.data = typeof options.body === 'string' ? 
          JSON.parse(options.body) : options.body;
      }

      console.log('📱 Usando CapacitorHttp:', nativeOptions);
      const response = await CapacitorHttp.request(nativeOptions);
      
      console.log('📱 Response status:', response.status);
      
      // Adaptar respuesta para que sea compatible con fetch
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        headers: {
          get: (key) => response.headers?.[key] || response.headers?.[key.toLowerCase()]
        },
        json: async () => response.data,
        text: async () => typeof response.data === 'string' ? 
          response.data : JSON.stringify(response.data)
      };
      
    } catch (error) {
      console.error('❌ Error en CapacitorHttp:', error);
      throw error;
    }
  } 
  // ✅ SI NO ES CAPACITOR, USAR FETCH NORMAL
  else {
    const defaultOptions = {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
        ...options.headers
      }
    };

    const finalOptions = { ...defaultOptions, ...options };
    
    try {
      const response = await fetch(url, finalOptions);
      console.log('🌐 Response status:', response.status);
      return response;
    } catch (error) {
      console.error('❌ Error en fetch:', error);
      throw error;
    }
  }
};

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

console.log('✅ Funciones helper de JSON agregadas a config.js');
console.log('✅ window.apiRequest definido correctamente');
console.log('✅ config.js cargado completamente');