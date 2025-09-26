// inactividad.js - Modificar la función de cerrar sesión y el beforeunload
(async () => {
  let tiempoLimite = 60 * 60 * 1000; // por defecto 1 hora
  let tiempoInactividad;
  let tipoUsuario = 'restaurante';
  let intervaloActividad; // Para el heartbeat de domiciliarios
  let usuarioId = null;

  function cerrarSesionPorInactividad() {
    // Si es domiciliario, marcar como inactivo
    if (tipoUsuario === 'domiciliario' && usuarioId) {
      // Usar sendBeacon para asegurar que la solicitud se complete aunque la página se cierre
      const data = new Blob([JSON.stringify({ domiciliarioId: usuarioId })], {type: 'application/json'});
      navigator.sendBeacon('/api/domiciliario-inactivo', data);
    }
    
    window.apiRequest('/api/logout', { method: 'POST' }).finally(() => {
      localStorage.setItem('cerrado_por_inactividad', 'true');
      location.href = '/login.html';
    });
  }

  function reiniciarTemporizador() {
    clearTimeout(tiempoInactividad);
    tiempoInactividad = setTimeout(cerrarSesionPorInactividad, tiempoLimite);
    
    // Si es domiciliario, enviar latido de actividad
    if (tipoUsuario === 'domiciliario') {
      enviarLatidoActividad();
    }
  }

  // Función para enviar latido de actividad (domiciliarios)
  async function enviarLatidoActividad() {
    try {
      await window.apiRequest('/api/domiciliario-activo', { method: 'POST' });
    } catch (error) {
      console.error('Error al enviar latido de actividad:', error);
    }
  }

  try {
    const res = await window.apiRequest('/api/usuario-actual');
    if (!res.ok) return;
    const usuario = await res.json();
    tipoUsuario = usuario.tipo || 'restaurante';
    usuarioId = usuario.id;
    
    if (tipoUsuario === 'domiciliario') {
      tiempoLimite = 15 * 60 * 1000;
      
      // Enviar latido inmediatamente y cada minuto
      enviarLatidoActividad();
      intervaloActividad = setInterval(enviarLatidoActividad, 60 * 1000);
    }
  } catch (e) {
    console.warn('No autenticado, omitiendo control de inactividad');
    return;
  }

  reiniciarTemporizador();

  ['click', 'mousemove', 'keydown', 'touchstart'].forEach(e =>
    document.addEventListener(e, reiniciarTemporizador, { passive: true })
  );

  // Limpiar intervalo al cerrar la página
  window.addEventListener('beforeunload', () => {
    if (intervaloActividad) {
      clearInterval(intervaloActividad);
    }
    
    // Si es domiciliario, marcar como inactivo al cerrar
    if (tipoUsuario === 'domiciliario' && usuarioId) {
      const data = new Blob([JSON.stringify({ domiciliarioId: usuarioId })], {type: 'application/json'});
      navigator.sendBeacon('/api/domiciliario-inactivo', data);
    }
  });

  // Mostrar notificación si fue cerrada por inactividad
  if (localStorage.getItem('cerrado_por_inactividad')) {
    localStorage.removeItem('cerrado_por_inactividad');
    const msg = document.createElement('div');
    msg.textContent = '🔒 Tu sesión se cerró por inactividad';
    msg.style.position = 'fixed';
    msg.style.bottom = '30px';
    msg.style.left = '50%';
    msg.style.transform = 'translateX(-50%)';
    msg.style.background = '#facc15';
    msg.style.color = '#121212';
    msg.style.padding = '1rem 1.5rem';
    msg.style.borderRadius = '12px';
    msg.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
    msg.style.zIndex = '9999';
    msg.style.fontSize = '16px';
    document.body.appendChild(msg);
    setTimeout(() => msg.remove(), 4000);
  }
})();