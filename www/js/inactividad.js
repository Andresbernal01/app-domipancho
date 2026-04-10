// inactividad.js - Sistema de heartbeat optimizado
// ✅ v2: el heartbeat periódico ya no es necesario porque /domiciliario/ubicacion
// actualiza activo_contador y ultima_actividad en cada update de GPS.
// Solo mantenemos el heartbeat inicial y el marcar inactivo al cerrar.
(async () => {
  let tipoUsuario = null;
  let usuarioId = null;

  async function enviarHeartbeatInicial() {
    if (tipoUsuario !== 'domiciliario') return;
    
    try {
      await window.apiRequest('/api/domiciliario-activo', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('✓ Heartbeat inicial enviado');
    } catch (error) {
      console.error('Error en heartbeat inicial:', error);
    }
  }

  async function marcarInactivo() {
    if (tipoUsuario !== 'domiciliario' || !usuarioId) return;
    
    const data = new Blob(
      [JSON.stringify({ domiciliarioId: usuarioId })],
      { type: 'application/json' }
    );
    navigator.sendBeacon('/api/domiciliario-inactivo', data);
    console.log('✓ Marcado como inactivo');
  }

  try {
    // ✅ OPTIMIZACIÓN: usar cache del usuario si ya lo cargó domiciliario.js
    let usuario = null;
    if (typeof window.__getUsuarioCache === 'function') {
      usuario = window.__getUsuarioCache();
    }
    if (!usuario) {
      const res = await window.apiRequest('/api/usuario-actual');
      if (!res.ok) return;
      usuario = await res.json();
    }

    tipoUsuario = usuario.tipo;
    usuarioId = usuario.id;
    
    if (tipoUsuario === 'domiciliario') {
      // ✅ Solo heartbeat inicial — el tracking de ubicación mantiene activo_contador actualizado
      await enviarHeartbeatInicial();
      console.log('Sistema de actividad activo (heartbeat via ubicación)');
    } else if (tipoUsuario === 'restaurante') {
      console.log('Restaurante: sesión persistente sin control de inactividad');
    }
  } catch (error) {
    console.warn('No se pudo inicializar sistema de actividad:', error);
    return;
  }

  // Limpiar al cerrar/recargar página
  window.addEventListener('beforeunload', () => {
    marcarInactivo();
  });

  // Reactivar al volver del background (móvil)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && tipoUsuario === 'domiciliario') {
      console.log('App restaurada - enviando heartbeat');
      enviarHeartbeatInicial();
    }
  });

  // Reconexión
  window.addEventListener('online', () => {
    console.log('Conexión restaurada - enviando heartbeat');
    if (tipoUsuario === 'domiciliario') {
      enviarHeartbeatInicial();
    }
  });

})();