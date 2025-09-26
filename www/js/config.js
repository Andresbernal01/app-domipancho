// config.js - VERSIÓN MEJORADA CON DEBUG
console.log('🔧 config.js cargando...');

// Configuración global para la app móvil de DomiPancho
window.APP_CONFIG = {
  API_BASE: 'https://domipancho.com',
  API_TIMEOUT: 10000,
  GEOLOCATION_TIMEOUT: 15000,
  POLLING_INTERVAL: 30000,
  IS_MOBILE_APP: true
};

console.log('🔧 APP_CONFIG definido:', window.APP_CONFIG);

// Función helper para hacer requests con configuración consistente
window.apiRequest = async (endpoint, options = {}) => {
  console.log('🌐 apiRequest llamado:', endpoint);
  
  const defaultOptions = {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...options.headers
    }
  };

  const finalOptions = { ...defaultOptions, ...options };
  const url = endpoint.startsWith('http') ? endpoint : `${window.APP_CONFIG.API_BASE}${endpoint}`;
  
  console.log('🌐 URL final:', url);
  
  try {
    const response = await fetch(url, finalOptions);
    console.log('🌐 Response status:', response.status);
    return response;
  } catch (error) {
    console.error('❌ Error en API request:', error);
    throw error;
  }
};




// AGREGAR al final de config.js después del console.log final

// Función helper para detectar respuestas HTML inválidas
window.isHtmlResponse = function(response, text) {
  const contentType = response.headers.get('content-type') || '';
  return (
    contentType.includes('text/html') ||
    text.trim().startsWith('<!DOCTYPE') ||
    text.trim().startsWith('<html')
  );
};

// Función helper para parsear respuestas JSON de manera segura
window.parseJsonSafely = async function(response) {
  const contentType = response.headers.get('content-type') || '';
  
  if (!contentType.includes('application/json')) {
    const text = await response.text();
    console.error('⛔ Respuesta no es JSON. Content-Type:', contentType);
    console.error('📄 Respuesta del servidor:', text.substring(0, 300));
    
    if (window.isHtmlResponse(response, text)) {
      if (text.includes('login') || text.includes('auth')) {
        console.warn('🔑 Redirigiendo a login por respuesta HTML');
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