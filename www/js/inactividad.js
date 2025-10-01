// inactividad.js - Sistema de heartbeat sin cierre de sesión
(async () => {
  let intervaloActividad = null;
  let tipoUsuario = null;
  let usuarioId = null;

  async function enviarHeartbeat() {
    if (tipoUsuario !== 'domiciliario') return;
    
    try {
      await window.apiRequest('/api/domiciliario-activo', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      console.log('✓ Heartbeat enviado');
    } catch (error) {
      console.error('Error en heartbeat:', error);
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
    const res = await window.apiRequest('/api/usuario-actual');
    if (!res.ok) return;
    
    const usuario = await res.json();
    tipoUsuario = usuario.tipo;
    usuarioId = usuario.id;
    
    if (tipoUsuario === 'domiciliario') {
      // Enviar heartbeat inicial
      await enviarHeartbeat();
      
      // Heartbeat cada 60 segundos
      intervaloActividad = setInterval(enviarHeartbeat, 60000);
      
      console.log('Sistema de heartbeat activo para domiciliario');
    } else if (tipoUsuario === 'restaurante') {
      console.log('Restaurante: sesión persistente sin control de inactividad');
    }
  } catch (error) {
    console.warn('No se pudo inicializar sistema de actividad:', error);
    return;
  }

  // Limpiar al cerrar/recargar página
  window.addEventListener('beforeunload', () => {
    if (intervaloActividad) {
      clearInterval(intervaloActividad);
    }
    marcarInactivo();
  });

  // Reactivar al volver del background (móvil)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && tipoUsuario === 'domiciliario') {
      console.log('App restaurada - enviando heartbeat');
      enviarHeartbeat();
    }
  });

  // Detectar pérdida de conexión
  window.addEventListener('offline', () => {
    console.warn('Sin conexión - pausando heartbeat');
    if (intervaloActividad) clearInterval(intervaloActividad);
  });

  window.addEventListener('online', () => {
    console.log('Conexión restaurada - reiniciando heartbeat');
    if (tipoUsuario === 'domiciliario' && !intervaloActividad) {
      enviarHeartbeat();
      intervaloActividad = setInterval(enviarHeartbeat, 60000);
    }
  });

})();