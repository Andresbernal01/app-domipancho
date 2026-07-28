// domiciliario.js - Versión Optimizada: Sin delays, recarga instantánea
(function() {
  'use strict';

  // ========== VARIABLES GLOBALES ==========
  let pedidosActivosGlobal = 0;
  let maxPedidosGlobal = 2; // ✅ Límite dinámico (se actualiza desde el backend)
  let pedidoProblemaId = null;
  let pedidoALiberarId = null;
  let socketInstance = null;
  let mobileNotif = null;

  // ========== UTILIDAD DE FECHAS ==========
  // Supabase puede devolver "2026-05-09 15:06:37" sin zona horaria.
  // Sin Z el navegador lo trata como hora local → 5h de desfase.
  // Esta función normaliza a UTC agregando Z si no tiene zona explícita.
  function normalizarFechaUTC(fechaStr) {
    if (!fechaStr) return fechaStr;
    const s = String(fechaStr);
    if (!s.endsWith('Z') && !s.includes('+') && !/[+-]\d{2}:\d{2}$/.test(s)) {
      return s.replace(' ', 'T') + 'Z';
    }
    return s;
  }

  // ========== CONFIGURACIÓN ==========
  const TARIFAS_POR_CIUDAD = {
    'chiquinquira': 4000,
    'tunja': 5000,
    'cajica': 3000,
    'zipaquira': 4500
  };

  const ESTADOS_CLASES = {
    'pendiente': 'pendiente',
    'en preparacion': 'en-preparacion',
    'esperando repartidor': 'esperando-repartidor',
    'preparando pedido': 'preparando-pedido',
    'camino a tu casa': 'camino',
    'entregado': 'entregado',
    'cancelado': 'cancelado'
  };


  const TIPO_ESPECIAL_ICONS = {
    restaurante_externo: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:11px;height:11px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>`,
    encomienda:          `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:11px;height:11px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg>`,
    compra_encargo:      `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:11px;height:11px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"/></svg>`
  };

  const TIPO_ESPECIAL_CONFIG = {
    restaurante_externo: { icon: TIPO_ESPECIAL_ICONS.restaurante_externo, label: 'Rest. Externo', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
    encomienda:          { icon: TIPO_ESPECIAL_ICONS.encomienda,          label: 'Encomienda',    color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)' },
    compra_encargo:      { icon: TIPO_ESPECIAL_ICONS.compra_encargo,      label: 'Compra Encargo', color: '#06b6d4', bg: 'rgba(6,182,212,0.12)'  }
  };

  // ========== UTILIDADES ==========
  function obtenerCostoDomicilio(pedido) {
    if (pedido.costo_domicilio) {
      return pedido.costo_domicilio;
    }
    
    if (!pedido.restaurantes?.ciudad) {
      console.warn(`No hay datos de restaurante para pedido ${pedido.id}`);
      return 5000;
    }
    
    const ciudadNormalizada = pedido.restaurantes.ciudad
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    
    return TARIFAS_POR_CIUDAD[ciudadNormalizada] || 5000;
  }

  function actualizarContadorPedidos(cantidad) {
    pedidosActivosGlobal = cantidad;
    const contadorEl = document.getElementById('numPedidosActivos');
    const contadorContainer = document.getElementById('contadorPedidos');
    
    if (contadorEl) contadorEl.textContent = cantidad;
    if (contadorContainer) {
      // ✅ FIX: Usar la clase base correcta del CSS (orders-count, NO pedidos-activos-contador)
      contadorContainer.className = 'orders-count';
      if (cantidad >= maxPedidosGlobal) contadorContainer.classList.add('limite-alcanzado');
      else if (cantidad >= maxPedidosGlobal - 1 && cantidad > 0) contadorContainer.classList.add('limite-cerca');
    }
    // ✅ Actualizar denominador dinámico
    const maxLabel = document.getElementById('maxPedidosLabel');
    if (maxLabel) maxLabel.textContent = maxPedidosGlobal;
  }

  // ✅ NUEVO: Actualizar badges de navegación sin request extra
  function _actualizarBadgesNav(numActivos, numDisponibles) {
    const numDisp = document.getElementById('numPedidosDisponibles');
    if (numDisp) numDisp.textContent = numDisponibles;

    const badgeActivos = document.getElementById('navBadgeActivos');
    if (badgeActivos) {
      if (numActivos > 0) { badgeActivos.textContent = numActivos; badgeActivos.classList.add('show'); }
      else badgeActivos.classList.remove('show');
    }
    const badgeDisp = document.getElementById('navBadgePedidos');
    if (badgeDisp) {
      if (numDisponibles > 0) { badgeDisp.textContent = numDisponibles; badgeDisp.classList.add('show'); }
      else badgeDisp.classList.remove('show');
    }
  }

  function mostrarMensaje(texto, tipo = 'success') {
    const box = document.getElementById('mensajeSistema');
    if (!box) return;
    
    box.textContent = texto;
    box.className = `mensaje-sistema ${tipo}`;
    box.style.display = 'block';
    
    setTimeout(() => {
      box.style.display = 'none';
    }, 4000);
  }

  // ✅ Calcular totales con información de cupón
// ✅ Calcular totales con información de cupón y tarifa DomiPancho
function calcularTotalesPedido(pedido) {
  const productosArray = Array.isArray(pedido.productos) ? pedido.productos : [];
  const subtotalProductos = productosArray.reduce((sum, pr) => sum + (pr.precio * pr.cantidad), 0);
  const costoDomicilio = obtenerCostoDomicilio(pedido);
  
  // ✅ NUEVO: Incluir tarifa DomiPancho si existe
  const tarifaDomiPancho = pedido.tarifa_domipancho || 0;
  
  if (pedido.descuento_cupon && pedido.total_con_descuento) {
    return {
      subtotalProductos,
      costoDomicilio,
      tarifaDomiPancho,  // ✅ NUEVO
      descuentoCupon: pedido.descuento_cupon,
      totalSinDescuento: pedido.total_sin_descuento || (subtotalProductos + costoDomicilio + tarifaDomiPancho),
      totalConDescuento: pedido.total_con_descuento,
      tieneCupon: true
    };
  }
  
  const total = subtotalProductos + costoDomicilio + tarifaDomiPancho;
  return {
    subtotalProductos,
    costoDomicilio,
    tarifaDomiPancho,  // ✅ NUEVO
    descuentoCupon: 0,
    totalSinDescuento: total,
    totalConDescuento: total,
    tieneCupon: false
  };
}

  // ✅ Generar desglose de envío según configuración de tarifa
  // 2 líneas: tarifa DomiPancho incluida en domicilio
  // 3 líneas: tarifa DomiPancho como línea separada
  function generarDesgloseEnvio(pedido, totales) {
    const esPorKm = pedido.tipo_tarifa === 'por_km';
    const distanciaInfo = esPorKm && pedido.distancia_km 
      ? ` <small style="color:#6b7280;">(${pedido.distancia_km} km)</small>` 
      : '';
    
    // Detectar si la tarifa se muestra separada:
    // Si el pedido tiene tarifa_domipancho > 0 Y el costo_domicilio NO la incluye,
    // entonces son 3 líneas. Si no, son 2 líneas (tarifa incluida en domicilio).
    // Heurística: si ambos valores existen por separado en el pedido, mostrar separado.
    const mostrarSeparada = totales.tarifaDomiPancho > 0 && pedido.tarifa_domipancho > 0;
    
    if (mostrarSeparada) {
      // 3 LÍNEAS: Domicilio (solo envío) + Tarifa DomiPancho aparte
      return `
        <p>Costo envío: $${totales.costoDomicilio.toLocaleString('es-CO')}${distanciaInfo}</p>
        <p>Tarifa DomiPancho: $${totales.tarifaDomiPancho.toLocaleString('es-CO')}</p>
      `;
    } else {
      // 2 LÍNEAS: Domicilio (incluye tarifa DomiPancho si existe)
      const costoTotal = totales.costoDomicilio + totales.tarifaDomiPancho;
      return `
        <p>Domicilio: $${costoTotal.toLocaleString('es-CO')}${distanciaInfo}</p>
      `;
    }
  }
  async function logout() {
    try {
      const response = await window.apiRequest('/api/logout', { method: 'POST' });
      if (response.ok) {
        window.location.href = '/index.html';
      } else {
        mostrarMensaje('Error al cerrar sesión', 'error');
      }
    } catch (error) {
      console.error('Error en logout:', error);
      window.location.href = '/login.html';
    }
  }

  // ✅ OPTIMIZACIÓN: Cache del usuario — no cambia durante la sesión
  let _usuarioCache = null;
  let _usuarioCachePromise = null;

  async function cargarUsuario(forzar = false) {
    // Si ya tenemos el usuario cacheado, devolverlo instantáneamente
    if (!forzar && _usuarioCache) {
      return _usuarioCache;
    }
    // Si hay una petición en curso, esperar a esa misma (evita duplicados)
    if (!forzar && _usuarioCachePromise) {
      return _usuarioCachePromise;
    }

    _usuarioCachePromise = (async () => {
      try {
        const response = await window.apiRequest('/api/usuario-actual');
        if (response.ok) {
          const usuario = await response.json();
          const userEl = document.getElementById('restaurantName');
          if (userEl) {
            userEl.textContent = `${usuario.usuario || 'Usuario'}`;
          }
          _usuarioCache = usuario;
          return usuario;
        }
      } catch (error) {
        console.error('Error al cargar usuario:', error);
      } finally {
        _usuarioCachePromise = null;
      }
      return null;
    })();

    return _usuarioCachePromise;
  }
  // Exponer para que otros módulos puedan usarlo sin pedir otra vez
  window.__getUsuarioCache = () => _usuarioCache;
  window.__invalidarUsuarioCache = () => { _usuarioCache = null; };

  // ========== GESTIÓN DE PEDIDOS ==========
  // ✅ Debounce para evitar múltiples cargas simultáneas
  let cargandoPedidos = false;
  let pendienteRecarga = false;

  async function cargarPedidos() {
    // ✅ Si ya estamos cargando, marcar como pendiente y salir
    if (cargandoPedidos) {
      pendienteRecarga = true;
      return;
    }
    cargandoPedidos = true;

    try {
      // ✅ OPTIMIZACIÓN: Disponibilidad + pedidos + usuario EN PARALELO
      // (antes eran secuenciales: ~3 round-trips → ahora 1)
      const [dispResult, pedidosResult, usuario] = await Promise.all([
        window.apiRequest('/api/domiciliarios/domiciliario/estado-disponibilidad')
          .then(r => r.ok ? r.json() : { disponible: true })
          .catch(err => {
            console.warn('Error verificando disponibilidad:', err);
            return { disponible: true };
          }),
        window.apiRequest('/api/domiciliarios/pedidos-domiciliario-con-distancias')
          .then(async r => ({ ok: r.ok, data: await r.json() }))
          .catch(err => ({ ok: false, data: null, error: err })),
        cargarUsuario() // usa cache — solo hace request la primera vez
      ]);

      const disponible = dispResult.disponible !== false;
      // ✅ Actualizar límite dinámico desde el backend
      if (dispResult.max_pedidos) {
        maxPedidosGlobal = dispResult.max_pedidos;
        window._maxPedidosDomi = dispResult.max_pedidos; // Sincronizar con inicio_domi.html
      }
      const res = { ok: pedidosResult.ok };
      let pedidos = pedidosResult.data;

      if (!res.ok && pedidos?.error === 'bloqueado') {
        document.getElementById('listaPedidos').innerHTML = `
          <div class="bloqueado">
            <h3>⛔ Cuenta Bloqueada</h3>
            <p>${pedidos.mensaje}</p>
          </div>
        `;
        return;
      }

      if (!usuario) return;

      // ✅ Actualizar cache para que abrirDetallesPedido sea instantáneo
      _actualizarCache(pedidos, usuario.id);

      // 3. FILTRAR PEDIDOS
      let pedidosFiltrados = pedidos.filter(pedido => {
        if (['camino a tu casa', 'preparando pedido'].includes(pedido.estado?.toLowerCase()) && pedido.domiciliario_id === usuario.id) {
          return true;
        }
        return pedido.estado?.toLowerCase() === 'esperando repartidor';
      });
  
      const disponiblesArr = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'esperando repartidor');
      const misActivos = pedidosFiltrados.filter(p => ['camino a tu casa', 'preparando pedido'].includes(p.estado?.toLowerCase()));
      
      actualizarContadorPedidos(misActivos.length);

      // ✅ NUEVO: Evaluar alarma sonora EN BUCLE según pedidos pendientes.
      // Funciona dentro de la app (vía socket-mock que llama a cargarPedidos)
      // y con la app cerrada (vía FCM). Suena hasta que se tome el pedido,
      // se silencie ("Ver"/cerrar) o ya no queden pedidos disponibles.
      if (window.fcmNotificationService) {
        const puedeRecibir = disponible && misActivos.length < maxPedidosGlobal;
        window.fcmNotificationService.evaluarAlarma(
          disponiblesArr.map(p => p.id),
          puedeRecibir
        );
      }
  
      // ✅ Solo mostrar disponibles en esta sección; los activos van en su propio tab
      renderizarPedidos(disponiblesArr, misActivos, [], disponible);

    // ✅ OPTIMIZACIÓN: reusar los pedidos ya cargados para el tab Activos
    // (antes hacía 2 requests adicionales duplicados)
    renderizarPedidosActivosDesdeCache(misActivos);

    // ✅ NUEVO: Actualizar badges de navegación directamente (sin request extra)
    _actualizarBadgesNav(misActivos.length, disponiblesArr.length);

    } catch (err) {
      console.error('Error al cargar pedidos:', err);
      document.getElementById('listaPedidos').innerHTML = `
        <div class="error">
          <h3>⚠️ Error al cargar pedidos</h3>
          <p>No se pudieron cargar los pedidos. Por favor, recarga la página.</p>
          <button onclick="window.location.href='index.html'" class="btn-reload">Ir a Login</button>
        </div>
      `;
    } finally {
      cargandoPedidos = false;
      
      // ✅ Si hubo solicitud pendiente mientras cargaba, recargar
      if (pendienteRecarga) {
        pendienteRecarga = false;
        cargarPedidos();
      }
    }
  }

  function renderizarPedidos(pedidosDisponibles, misActivos, pedidosGeograficos, disponible) {
    const contenedor = document.getElementById('listaPedidos');
    
    if (!contenedor) {
      console.error('❌ Elemento listaPedidos no encontrado');
      return;
    }

    // ✅ ANTI-PARPADEO: si la lista no cambió, NO reconstruir el HTML.
    // Evita el flicker cada 5s, el salto de scroll y el reinicio de animaciones.
    // El hash incluye misActivos.length, disponible y el máximo porque las
    // alertas superiores dependen de esos valores.
    const hashActual = _calcHash(pedidosDisponibles || [])
      + `#a${misActivos.length}#d${disponible ? 1 : 0}#m${maxPedidosGlobal}`;
    if (hashActual === _lastDisponiblesHash && contenedor.children.length > 0) {
      return;
    }
    _lastDisponiblesHash = hashActual;
    
    if (!Array.isArray(pedidosDisponibles) || pedidosDisponibles.length === 0) {
      if (disponible) {
        contenedor.innerHTML = misActivos.length >= maxPedidosGlobal 
          ? `<div class="no-pedidos"><h3>🚛 Tienes el máximo de pedidos (${misActivos.length}/${maxPedidosGlobal})</h3><p>Completa una entrega para poder tomar nuevos pedidos.</p></div>`
          : '<div class="no-pedidos"><h3>🎯 No hay pedidos disponibles</h3><p>Actualmente no hay pedidos disponibles en tu ciudad. ¡Mantente atento!</p></div>';
      } else {
        contenedor.innerHTML = '<div class="no-pedidos"><h3>🔴 No Disponible</h3><p>No hay pedidos esperando repartidor en tu ciudad actualmente.</p><p><strong>Activa "Disponible"</strong> para empezar a recibir pedidos.</p></div>';
      }
      return;
    }
  
    let htmlContent = '';
  
    if (!disponible) {
      htmlContent += `
        <div class="alerta alerta-no-disponible">
          <h3>🔴 Modo Vista Previa - No Disponible</h3>
          <p>Estás viendo todos los pedidos de tu ciudad. <strong>Activa "Disponible"</strong> en el inicio para poder tomarlos.</p>
        </div>
      `;
    } else if (misActivos.length >= maxPedidosGlobal) {
      htmlContent += `<div class="alerta limite-alcanzado"><h3>🚛 Máximo de pedidos alcanzado (${misActivos.length}/${maxPedidosGlobal})</h3><p>Completa una entrega para poder tomar nuevos pedidos.</p></div>`;
    } else if (misActivos.length >= 1) {
      const restantes = maxPedidosGlobal - misActivos.length;
      htmlContent += `<div class="alerta advertencia-limite"><h3>⚠️ Puedes tomar ${restantes} pedido${restantes > 1 ? 's' : ''} más (${misActivos.length}/${maxPedidosGlobal})</h3><p>Tienes espacio para ${restantes > 1 ? 'pedidos adicionales' : 'un pedido adicional'}.</p></div>`;
    }
  
    const pedidosOrdenados = [...pedidosDisponibles].sort((a, b) => {
      // Pedidos liberados siempre primero
      const aLiberado = !!a.fecha_liberacion;
      const bLiberado = !!b.fecha_liberacion;
      if (aLiberado !== bLiberado) return aLiberado ? -1 : 1;
      // Dentro del mismo grupo, más antiguos primero
      return new Date(normalizarFechaUTC(a.fecha)) - new Date(normalizarFechaUTC(b.fecha));
    });
  
    htmlContent += '<div class="pedidos-grid">';
    pedidosOrdenados.forEach(p => {
      htmlContent += generarHtmlPedido(p, false, pedidosGeograficos, misActivos.length, disponible);
    });
    htmlContent += '</div>';
  
    contenedor.innerHTML = htmlContent;
  }

  // ========== UTILIDADES DE PROTECCIÓN DE DATOS ==========
  function ocultarTelefono(telefono) {
    if (!telefono) return 'N/A';
    const tel = telefono.toString();
    if (tel.length < 7) return tel;
    return tel.substring(0, 3) + '*'.repeat(9);
  }

  function ocultarDireccion(direccion) {
    return 'Toma el pedido para ver';
  }

  function generarHtmlPedido(p, esMiPedido, pedidosGeograficos, cantidadActivos, disponible) {
    const estadoClase = ESTADOS_CLASES[p.estado?.toLowerCase()] || 'pendiente';
    const totales     = calcularTotalesPedido(p);
    const horaStr     = new Date(normalizarFechaUTC(p.fecha)).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' });
    const cardClass   = esMiPedido ? 'mi-pedido' : 'disponible';
    const previewClass = (!disponible && !esMiPedido) ? ' pedido-preview' : '';
   
    // ✅ DETECTAR PEDIDO ESPECIAL
    const esEspecial = !!p.tipo_pedido_especial;
    const configEsp = esEspecial ? (TIPO_ESPECIAL_CONFIG[p.tipo_pedido_especial] || null) : null;
   
    // Badge de pedido especial
    const badgeEspecial = configEsp
      ? `<div class="badge-especial" style="background:${configEsp.bg}; color:${configEsp.color}; padding:2px 8px; border-radius:6px; font-size:0.7rem; font-weight:700; display:inline-flex; align-items:center; gap:3px; margin-bottom:6px; border:1px solid ${configEsp.color}30;">
           ${configEsp.icon} ${configEsp.label}
         </div>`
      : '';

    // ✅ DETECTAR PEDIDO LIBERADO
    const esLiberado = !esMiPedido && !!p.fecha_liberacion;
    const ICON_LIBERADO = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:11px;height:11px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>`;
    const badgeLiberado = esLiberado
      ? `<div class="badge-liberado"><span class="badge-lib-inner">${ICON_LIBERADO} Liberado</span></div>`
      : '';
   
    // Origen: para especiales usa origen_especial, para normales el restaurante
    const origenNombre = esEspecial
      ? (p.origen_especial || 'Origen especial')
      : (p.restaurantes?.nombre || 'Restaurante');
    const origenDir = esEspecial ? '' : (p.restaurantes?.direccion || '');
   
    // Descripción especial (solo para especiales, debajo del origen)
    const descEspecialHtml = esEspecial && p.descripcion_especial
      ? `<span class="punto-sub" style="color:${configEsp?.color || '#f59e0b'}; font-weight:600; font-size:0.75rem;">${p.descripcion_especial.substring(0, 80)}${p.descripcion_especial.length > 80 ? '...' : ''}</span>`
      : '';
   
    // Notas especiales
    const notasHtml = esEspecial && p.notas_especial
      ? `<span class="punto-sub" style="font-style:italic; opacity:0.8;">📝 ${p.notas_especial.substring(0, 60)}${p.notas_especial.length > 60 ? '...' : ''}</span>`
      : '';
   
    // Destino
    const destinoDir = esMiPedido
      ? (p.direccion || '') + (p.complemento ? ', ' + p.complemento : '')
      : 'Ver al tomar el pedido';
    const destinoBarrio = p.barrio || '';
    const destinoDotClass = esMiPedido ? 'destino-activo' : 'destino';
   
    // Distancia (solo para pedidos normales con restaurante)
    const distanciaStr = (!esMiPedido && !esEspecial && p.distancia_al_restaurante != null && disponible)
      ? `<span class="card-dist">${p.distancia_al_restaurante.toFixed(2)} km al restaurante</span>`
      : '';
   
    // Total y desglose
    const totalStr  = `$${totales.totalConDescuento.toLocaleString('es-CO')}`;
    const cuponHtml = totales.tieneCupon
      ? `<span class="card-cupon">Cupon -$${totales.descuentoCupon.toLocaleString('es-CO')}</span>`
      : '';
    
    const esPorKm = p.tipo_tarifa === 'por_km';
    const costoEnvioTotal = totales.costoDomicilio + totales.tarifaDomiPancho;
    const envioHtml = esPorKm && p.distancia_km
      ? `<span class="card-envio">Envío $${costoEnvioTotal.toLocaleString('es-CO')} (${p.distancia_km} km)</span>`
      : `<span class="card-envio">Envío $${costoEnvioTotal.toLocaleString('es-CO')}</span>`;
   
    const estadoTexto = esMiPedido 
      ? (p.pedido_listo_en 
          ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:10px;height:10px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> ¡Listo!` 
          : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:10px;height:10px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/></svg> En camino`) 
      : (p.pedido_listo_en 
          ? `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:10px;height:10px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg> Listo` 
          : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:10px;height:10px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg> Preparando`);
   
    // Botones
    const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:14px;height:14px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>`;
    const ICON_CLOCK = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:14px;height:14px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;
    const ICON_PICKUP = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:14px;height:14px;flex-shrink:0;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"/></svg>`;
    
    const esPreparando = p.estado?.toLowerCase() === 'preparando pedido';
    
    let bannerHtml = '';
    let accionesHtml = '';
    
    if (esPreparando) {
      // ✅ PREPARANDO PEDIDO: solo banner + botón recoger prominente + liberar
      bannerHtml = p.pedido_listo_en 
        ? `<div class="card-estado-banner card-estado-listo">${ICON_CHECK} ¡Listo para recoger!</div>` 
        : `<div class="card-estado-banner card-estado-preparando">${ICON_CLOCK} Restaurante preparando...</div>`;
      accionesHtml = `
        <div class="card-btns-acciones">
          <button class="cbtn cbtn-lib" onclick="abrirModalLiberar(${p.id})">Liberar</button>
          <button class="cbtn cbtn-recoger" onclick="recogerPedido(${p.id}, ${p.pedido_listo_en ? 'false' : 'true'})" style="background:#10b981;color:white;font-weight:700;flex:2;">${ICON_PICKUP} Ya recogí el pedido</button>
        </div>`;
    } else {
      // ✅ CAMINO A TU CASA: banner listo/preparando + acciones completas
      bannerHtml = p.pedido_listo_en 
        ? `<div class="card-estado-banner card-estado-listo">${ICON_CHECK} ¡Listo para recoger!</div>` 
        : `<div class="card-estado-banner card-estado-preparando">${ICON_CLOCK} Restaurante preparando...</div>`;
      accionesHtml = `
        <div class="card-btns-info">
          <button class="cbtn cbtn-det" onclick="abrirDetallesPedido(${p.id}, true)">Ver detalles</button>
          <button class="cbtn cbtn-mapa" onclick="abrirMapaDomiciliario(${p.id})">Ver mapa</button>
        </div>
        <div class="card-btns-acciones">
          <button class="cbtn cbtn-lib"  onclick="abrirModalLiberar(${p.id})">Liberar</button>
          <button class="cbtn cbtn-ok"   onclick="abrirModalPago(${p.id})">Entregar</button>
          <button class="cbtn cbtn-prob" onclick="abrirModalProblema(${p.id})">Problema</button>
        </div>`;
    }
    
    const botonesHtml = esMiPedido
      ? `<div class="card-btns mi-pedido-btns">
           ${bannerHtml}
           ${accionesHtml}
         </div>`
      : `<div class="card-btns">
           <button class="cbtn cbtn-det" onclick="abrirDetallesPedido(${p.id}, false)">Ver detalles</button>
           ${generarBotonesAccion(p, esMiPedido, cantidadActivos, disponible)}
         </div>`;
   
    // Border especial para pedidos especiales
    const borderStyle = configEsp
      ? `border-left: 3px solid ${configEsp.color};`
      : '';
    const liberadoClass = esLiberado ? ' pedido-liberado' : '';
   
    return `
      <div class="pedido-card ${cardClass}${previewClass}${liberadoClass}" data-pedido-id="${p.id}" style="${borderStyle}">
   
        ${badgeLiberado}
        ${badgeEspecial}
   
        <div class="card-top">
          <span class="card-id">#${p.id}</span>
          <span class="estado ${estadoClase}">${estadoTexto}</span>
          <span class="card-hora">${horaStr}</span>
        </div>
   
        <div class="card-ruta">
          <div class="card-punto">
            <span class="punto-dot origen"></span>
            <span class="punto-texto">
              <span class="punto-label">${esEspecial ? 'Recoger en' : 'Origen'}</span>
              <span class="punto-val">${origenNombre}</span>
              ${origenDir ? `<span class="punto-sub">${origenDir}</span>` : ''}
              ${descEspecialHtml}
              ${notasHtml}
            </span>
          </div>
          <div class="card-punto">
            <span class="punto-dot ${destinoDotClass}"></span>
            <span class="punto-texto">
              <span class="punto-label">Entregar en</span>
              <span class="punto-val">${destinoDir}</span>
              ${destinoBarrio ? `<span class="punto-sub">Barrio: ${destinoBarrio}</span>` : ''}
            </span>
          </div>
        </div>
   
        <div class="card-money">
          <span class="card-total${totales.tieneCupon ? ' con-cupon' : ''}">${totalStr}</span>
          ${envioHtml}
          ${cuponHtml}
          ${distanciaStr}
          ${esMiPedido && p.metodo_pago ? `<span class="card-metodo-pago" style="font-size:0.73rem;font-weight:600;padding:2px 8px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;margin-top:2px;${p.metodo_pago === 'efectivo' ? 'background:rgba(16,185,129,0.1);color:#10b981;' : p.metodo_pago === 'nequi' ? 'background:rgba(139,92,246,0.1);color:#8b5cf6;' : p.metodo_pago === 'daviplata' ? 'background:rgba(239,68,68,0.1);color:#ef4444;' : p.metodo_pago === 'transferencia' ? 'background:rgba(59,130,246,0.1);color:#3b82f6;' : p.metodo_pago === 'datafono' ? 'background:rgba(245,158,11,0.1);color:#f59e0b;' : 'background:rgba(100,116,139,0.1);color:#64748b;'}">${p.metodo_pago === 'efectivo' ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:11px;height:11px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>' : (p.metodo_pago === 'nequi' || p.metodo_pago === 'daviplata') ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:11px;height:11px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>' : p.metodo_pago === 'transferencia' ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:11px;height:11px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:11px;height:11px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>'} ${p.metodo_pago === 'pagado al restaurante' ? 'Pagado al rest.' : p.metodo_pago.charAt(0).toUpperCase() + p.metodo_pago.slice(1)}</span>` : ''}
        </div>
   
        ${botonesHtml}
   
      </div>
    `;
  }

  function generarBotonesAccion(pedido, esMiPedido, cantidadActivos, disponible) {
    // Solo se usa para pedidos disponibles (mi-pedido ya tiene sus botones arriba)
    if (pedido.estado === 'esperando repartidor') {
      if (!disponible) {
        return `<button class="cbtn cbtn-nd" disabled>No disponible</button>`;
      }
      const off = cantidadActivos >= maxPedidosGlobal;
      return `<button class="cbtn cbtn-tomar" onclick="tomarPedido(${pedido.id})" ${off ? 'disabled' : ''}>${off ? 'Limite alcanzado' : 'Tomar pedido'}</button>`;
    }
    return '';
  }

  // ========== ACCIONES DE PEDIDOS ==========
  async function tomarPedido(pedidoId) {
    // ✅ Silenciar alarma al tomar el pedido (marca pedidos actuales como atendidos)
    if (window.fcmNotificationService) {
      window.fcmNotificationService.silenciarAlarma();
    }
    
    try {
      const dispResponse = await window.apiRequest('/api/domiciliarios/domiciliario/estado-disponibilidad');
      if (dispResponse.ok) {
        const dispData = await dispResponse.json();
        if (!dispData.disponible) {
          mostrarMensaje('⚠️ Debes activar "Disponible" en el inicio para tomar pedidos', 'error');
          return;
        }
      }
    } catch (error) {
      console.error('Error verificando disponibilidad:', error);
    }
    
    if (pedidosActivosGlobal >= maxPedidosGlobal) {
      mostrarMensaje(`❌No puedes tomar más pedidos. Máximo ${maxPedidosGlobal} pedidos activos permitidos.`, 'error');
      return;
    }
  
    const tarjeta = document.querySelector(`[data-pedido-id="${pedidoId}"]`);
    const btnTomar = tarjeta?.querySelector('.btn-tomar');
    
    if (btnTomar) {
      btnTomar.disabled = true;
      btnTomar.textContent = '⏳ Tomando...';
    }
  
    try {
      const res = await window.apiRequest(`/api/pedidos/${pedidoId}/tomar`, { method: 'POST' });
      const result = await res.json();
  
      if (res.ok) {
        localStorage.setItem('domiciliario_pedido_activo', 'true');
        localStorage.setItem('domiciliario_pedido_id', pedidoId);
        
        if (window.unifiedGeoService) {
          await window.unifiedGeoService.startTracking();
        }
        
        mostrarMensaje(`Pedido asignado (${result.pedidosActivos || 1}/${result.maxPedidos || maxPedidosGlobal} activos)`);
        actualizarContadorPedidos(result.pedidosActivos || 1);
        // ✅ Recargar inmediatamente sin delay
        await cargarPedidos();
      } else {
        // ✅ Falló la toma. Si ya fue tomado por otro (409 / yaTomado) o ya no
        //    está disponible, refrescamos la lista para que la tarjeta desaparezca
        //    en vez de dejar el botón colgado y el pedido visible.
        const yaTomado = res.status === 409 || result.yaTomado === true;
        mostrarMensaje(
          yaTomado
            ? '⚠️ Ese pedido ya lo tomó otro domiciliario'
            : `❌ ${result.error || 'No se pudo tomar el pedido'}`,
          yaTomado ? 'info' : 'error'
        );
        // Recargar SIEMPRE: sincroniza con el estado real del servidor.
        // - Si ya fue tomado → desaparece de la lista.
        // - Si sigue disponible (ej. error transitorio) → vuelve a quedar tomable.
        await cargarPedidos();
      }
    } catch (error) {
      console.error('Error al tomar pedido:', error);
      if (btnTomar) {
        btnTomar.disabled = false;
        btnTomar.textContent = 'Tomar';
      }
      mostrarMensaje('❌ Error de conexión', 'error');
    }
  }

  // ========== RECOGER PEDIDO (preparando pedido → camino a tu casa) ==========
  async function recogerPedido(pedidoId, forzado = false) {
    // ✅ Flujo normal (restaurante ya marcó listo): un solo clic, sin confirmación.
    // Override (restaurante olvidó marcar listo): pedir confirmación consciente.
    if (forzado && !confirm('El restaurante todavía no marcó este pedido como LISTO. ¿Confirmas que ya lo tienes en mano y vas hacia el cliente?')) return;

    const tarjeta = document.querySelector(`[data-pedido-id="${pedidoId}"]`);
    const btnRecoger = tarjeta?.querySelector('.cbtn-recoger');
    
    if (btnRecoger) {
      btnRecoger.disabled = true;
      btnRecoger.innerHTML = '⏳ Actualizando...';
    }

    try {
      const res = await window.apiRequest(`/api/pedidos/${pedidoId}/recoger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forzado })
      });
      const result = await res.json();

      if (res.ok) {
        mostrarMensaje('✅ Pedido recogido — ahora estás en camino al cliente');
        await cargarPedidos();
      } else {
        if (btnRecoger) {
          btnRecoger.disabled = false;
          btnRecoger.innerHTML = 'Ya recogí el pedido';
        }
        mostrarMensaje(`❌ ${result.error || 'No se pudo actualizar'}`, 'error');
      }
    } catch (error) {
      console.error('Error al recoger pedido:', error);
      if (btnRecoger) {
        btnRecoger.disabled = false;
        btnRecoger.innerHTML = 'Ya recogí el pedido';
      }
      mostrarMensaje('❌ Error de conexión', 'error');
    }
  }

  // ========== MODALES ==========
  function abrirModalPago(pedidoId) {
    window.pedidoSeleccionado = pedidoId;
    
    const radios = document.querySelectorAll('input[name="metodo_pago"]');
    radios.forEach(radio => {
      radio.checked = false;
    });
    
    const btnConfirmar = document.getElementById('btnConfirmarEntrega');
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = 'Confirmar Entrega';
    
    // ✅ PRE-SELECCIONAR el método de pago que eligió el cliente
    const pedido = _cachePedidos.find(p => p.id === pedidoId);
    const infoClienteMetodo = document.getElementById('info-metodo-pago-cliente');

    if (pedido && pedido.metodo_pago) {
      const metodoCliente = pedido.metodo_pago;
      const nombresMetodo = {
        efectivo: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg> Efectivo',
        nequi: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg> Nequi',
        daviplata: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;vertical-align:middle;"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="11" r="3"/><path d="M9 18h6"/></svg> Daviplata',
        transferencia: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"/></svg> Transferencia bancaria',
        datafono: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;vertical-align:middle;"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg> Datáfono (tarjeta)',
        'pagado al restaurante': '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg> Pagado al restaurante'
      };
      
      // Mostrar banner con lo que eligió el cliente
      if (infoClienteMetodo) {
        infoClienteMetodo.style.display = 'block';
        infoClienteMetodo.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:1.1rem;">👤</span>
            <div>
              <div style="font-weight:700;font-size:0.82rem;color:#1e293b;">El cliente eligió: ${nombresMetodo[metodoCliente] || metodoCliente}</div>
              <div style="font-size:0.72rem;color:#94a3b8;">Puedes confirmar o cambiar si el cliente pagó diferente</div>
            </div>
          </div>
        `;
      }
      
      // ✅ Mapeo directo 1-a-1 — cada método del cliente corresponde al mismo en el domiciliario
      const mapeoMetodos = {
        efectivo: 'efectivo',
        nequi: 'nequi',
        daviplata: 'daviplata',
        transferencia: 'transferencia',
        datafono: 'datafono',
        app: 'nequi', // legado: "app" antiguo → nequi
        'pagado al restaurante': 'pagado al restaurante'
      };
      const valorPreseleccionar = mapeoMetodos[metodoCliente] || null;
      
      if (valorPreseleccionar) {
        const radioTarget = document.querySelector(`input[name="metodo_pago"][value="${valorPreseleccionar}"]`);
        if (radioTarget) {
          radioTarget.checked = true;
          btnConfirmar.disabled = false;
        }
      }
    } else {
      // Sin método de pago del cliente (pedido especial, ver_pedidos, etc.)
      if (infoClienteMetodo) {
        infoClienteMetodo.style.display = 'none';
      }
    }
    
    // ✅ FIX: Usar un único listener en el contenedor, no acumular por apertura
    const metodoContainer = document.querySelector('.metodos-pago');
    if (metodoContainer._radioHandler) {
      metodoContainer.removeEventListener('change', metodoContainer._radioHandler);
    }
    metodoContainer._radioHandler = function() {
      const checked = document.querySelector('input[name="metodo_pago"]:checked');
      document.getElementById('btnConfirmarEntrega').disabled = !checked;
    };
    metodoContainer.addEventListener('change', metodoContainer._radioHandler);
    
    document.getElementById('modalMetodoPago').style.display = 'flex';
  }

  function cerrarModalPago() {
    document.getElementById('modalMetodoPago').style.display = 'none';
    window.pedidoSeleccionado = null;
    
    // ✅ FIX: Limpiar radios y restaurar botón completamente
    const radios = document.querySelectorAll('input[name="metodo_pago"]');
    radios.forEach(radio => { radio.checked = false; });
    
    const btnConfirmar = document.getElementById('btnConfirmarEntrega');
    if (btnConfirmar) {
      btnConfirmar.disabled = true;
      btnConfirmar.innerHTML = 'Confirmar Entrega';
    }
    
    const metodoContainer = document.querySelector('.metodos-pago');
    if (metodoContainer && metodoContainer._radioHandler) {
      metodoContainer.removeEventListener('change', metodoContainer._radioHandler);
      metodoContainer._radioHandler = null;
    }
  }

  async function confirmarEntrega() {
    const metodo = document.querySelector('input[name="metodo_pago"]:checked');
    
    if (!metodo) {
      mostrarMensaje('⚠️ Selecciona un método de pago primero', 'error');
      return;
    }
  
    const btnConfirmar = document.getElementById('btnConfirmarEntrega');
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = '⏳ Confirmando...';
  
    try {
      const res = await window.apiRequest(`/api/pedidos/${window.pedidoSeleccionado}/estado-domiciliario`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'entregado', metodo_pago: metodo.value })
      });
      
      const result = await res.json();
      
      if (res.ok) {
        const textoMetodo = {
          efectivo: 'efectivo',
          nequi: 'Nequi',
          daviplata: 'Daviplata',
          transferencia: 'transferencia bancaria',
          datafono: 'datáfono',
          'pagado al restaurante': 'pagado al restaurante'
        };
        const metodoPagoTexto = textoMetodo[metodo.value] || metodo.value;
        mostrarMensaje(`✅ Pedido entregado exitosamente con ${metodoPagoTexto}`);
        
        // ✅ Verificar si hay más pedidos activos
        try {
          const usuarioResponse = await window.apiRequest('/api/usuario-actual');
          const usuarioData = await usuarioResponse.json();
          const pedidosActivosResponse = await window.apiRequest(`/api/pedidos-activos-domiciliario/${usuarioData.id}`);
          const pedidosActivosData = await pedidosActivosResponse.json();
          const pedidosActivos = pedidosActivosData.pedidos || [];
          
          if (!pedidosActivos || pedidosActivos.length === 0) {
            localStorage.removeItem('domiciliario_pedido_activo');
            localStorage.removeItem('domiciliario_pedido_id');
            if (window.unifiedGeoService) await window.unifiedGeoService.stopTracking();
          }
        } catch (e) { console.warn('Error verificando pedidos activos post-entrega:', e); }
        
        cerrarModalPago();
        await cargarPedidos();
      } else {
        mostrarMensaje('❌ Error al marcar como entregado', 'error');
      }
    } catch (err) {
      console.error('Error:', err);
      mostrarMensaje('❌ Error de conexión', 'error');
    } finally {
      // ✅ FIX CRÍTICO: Siempre restaurar el botón en finally, pase lo que pase
      const btn = document.getElementById('btnConfirmarEntrega');
      if (btn) {
        btn.innerHTML = 'Confirmar Entrega';
        // Solo re-habilitar si hay un método seleccionado (modal todavía visible)
        const checked = document.querySelector('input[name="metodo_pago"]:checked');
        btn.disabled = !checked;
      }
    }
  }

  function abrirModalProblema(id) {
    pedidoProblemaId = id;
    limpiarFormularioProblema();
    document.getElementById('modalProblema').style.display = 'flex';
  }

  function cerrarModalProblema() {
    document.getElementById('modalProblema').style.display = 'none';
    limpiarFormularioProblema();
    pedidoProblemaId = null;
  }

  function limpiarFormularioProblema() {
    document.getElementById('motivo').value = '';
    document.getElementById('detalle_motivo').value = '';
    document.getElementById('campoOtro').style.display = 'none';
    document.getElementById('accion_pedido').value = '';
    document.getElementById('explicacion_no_devolvi').value = '';
    document.getElementById('campoExplicacionNoDevolvi').style.display = 'none';
    
    const radioButtons = document.querySelectorAll('input[name="llamo_restaurante"]');
    radioButtons.forEach(radio => radio.checked = false);
  }

  function mostrarOtroCampo(valor) {
    document.getElementById('campoOtro').style.display = valor === 'otro' ? 'block' : 'none';
  }

  function mostrarCampoExplicacion(valor) {
    document.getElementById('campoExplicacionNoDevolvi').style.display = valor === 'no lo devolví' ? 'block' : 'none';
  }

  async function confirmarNoEntregado() {
    if (!pedidoProblemaId) {
      mostrarMensaje('Error: No se ha seleccionado un pedido', 'error');
      return;
    }
  
    const motivo = document.getElementById('motivo').value;
    const detalleMotivo = document.getElementById('detalle_motivo').value;
    const llamoRestaurante = document.querySelector('input[name="llamo_restaurante"]:checked')?.value;
    const accion = document.getElementById('accion_pedido').value;
    const explicacionNoDevolvi = document.getElementById('explicacion_no_devolvi')?.value || '';
  
    if (!motivo || (motivo === 'otro' && !detalleMotivo.trim()) || !llamoRestaurante || !accion || (accion === 'no lo devolví' && !explicacionNoDevolvi.trim())) {
      mostrarMensaje('⚠️ Completa todos los campos requeridos', 'error');
      return;
    }
  
    let comentario = 'REPORTE DE PROBLEMA:\n';
    comentario += `Motivo: ${motivo}\n`;
    if (motivo === 'otro' && detalleMotivo.trim()) {
      comentario += `Detalle del motivo: ${detalleMotivo.trim()}\n`;
    }
    comentario += `¿Llamó al restaurante?: ${llamoRestaurante}\n`;
    comentario += `Acción tomada con el pedido: ${accion}\n`;
    if (accion === 'no lo devolví' && explicacionNoDevolvi.trim()) {
      comentario += `Explicación de por qué no lo devolvió: ${explicacionNoDevolvi.trim()}`;
    }
  
    if (!confirm('¿Estás seguro de marcar este pedido como NO ENTREGADO? Esta acción no se puede deshacer.')) {
      return;
    }
  
    const btnConfirmar = document.querySelector('.modal-contenido button[onclick="confirmarNoEntregado()"]');
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = '⏳ Enviando reporte...';
  
    try {
      const res = await window.apiRequest(`/api/pedidos/${pedidoProblemaId}/estado-domiciliario`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          estado: 'cancelado',
          comentario_domiciliario: comentario
        })
      });
  
      const result = await res.json();
  
      if (res.ok) {
        mostrarMensaje('✅ Pedido marcado como no entregado - Reporte enviado exitosamente');
        
        try {
          const usuarioResponse = await window.apiRequest('/api/usuario-actual');
          const usuarioData = await usuarioResponse.json();
          const pedidosActivosResponse = await window.apiRequest(`/api/pedidos-activos-domiciliario/${usuarioData.id}`);
          const pedidosActivosData = await pedidosActivosResponse.json();
          const pedidosActivos = pedidosActivosData.pedidos || [];
          
          if (!pedidosActivos || pedidosActivos.length === 0) {
            localStorage.removeItem('domiciliario_pedido_activo');
            localStorage.removeItem('domiciliario_pedido_id');
            if (window.unifiedGeoService) await window.unifiedGeoService.stopTracking();
          }
        } catch (e) { console.warn('Error verificando pedidos activos post-cancelación:', e); }
        
        cerrarModalProblema();
        await cargarPedidos();
      } else {
        mostrarMensaje(`❌ Error: ${result.error || 'No se pudo actualizar el estado del pedido'}`, 'error');
      }
    } catch (error) {
      console.error('Error al marcar como no entregado:', error);
      mostrarMensaje('❌ Error de conexión. Por favor intenta nuevamente.', 'error');
    } finally {
      // ✅ FIX CRÍTICO: Siempre restaurar el botón en finally
      const btn = document.querySelector('.modal-contenido button[onclick="confirmarNoEntregado()"]');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = 'Confirmar No Entregado';
      }
    }
  }

  function abrirModalLiberar(pedidoId) {
    pedidoALiberarId = pedidoId;
    document.getElementById('modalLiberarPedido').style.display = 'flex';
    document.getElementById('motivo_liberacion').value = '';
    document.getElementById('detalle_motivo_liberacion').value = '';
    document.getElementById('campoDetalleMotivo').style.display = 'none';
  }

  function cerrarModalLiberar() {
    document.getElementById('modalLiberarPedido').style.display = 'none';
    pedidoALiberarId = null;
  }

  function mostrarDetalleMotivo(valor) {
    document.getElementById('campoDetalleMotivo').style.display = (valor === 'otro') ? 'block' : 'none';
  }

  async function confirmarLiberarPedido() {
    if (!pedidoALiberarId) return;

    const motivo = document.getElementById('motivo_liberacion').value;
    const detalle = document.getElementById('detalle_motivo_liberacion').value;

    if (!motivo) {
      mostrarMensaje('⚠️ Debes seleccionar un motivo', 'error');
      return;
    }

    if (motivo === 'otro' && !detalle.trim()) {
      mostrarMensaje('⚠️ Debes explicar el motivo', 'error');
      return;
    }

    try {
      const res = await window.apiRequest(`/api/pedidos/${pedidoALiberarId}/liberar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          motivo_liberacion: motivo,
          detalle_motivo: detalle
        })
      });
      
      const result = await res.json();
      
      if (res.ok) {
        mostrarMensaje('✅ Pedido liberado exitosamente');
        cerrarModalLiberar();
        // ✅ Recargar sin delay
        await cargarPedidos();
      } else {
        mostrarMensaje(`❌ ${result.error || 'Error al liberar pedido'}`, 'error');
      }
    } catch (error) {
      console.error('Error al liberar pedido:', error);
      mostrarMensaje('❌ Error de conexión', 'error');
    }
  }

  // ── Cache de pedidos para que el modal abra INSTANTÁNEAMENTE ──
  let _cachePedidos   = [];
  let _cacheUsuarioId = null;

  // Se llama desde cargarPedidos y cargarPedidosActivos para mantener cache fresco
  function _actualizarCache(pedidos, usuarioId) {
    _cachePedidos   = pedidos   || _cachePedidos;
    _cacheUsuarioId = usuarioId ?? _cacheUsuarioId;
  }

  function abrirDetallesPedido(pedidoId, esMiPedido = false) {
    // ✅ Silenciar alarma al ver detalles (marca pedidos actuales como atendidos)
    if (window.fcmNotificationService) {
      window.fcmNotificationService.silenciarAlarma();
    }
    
    // ✅ INSTANTÁNEO: buscar en cache (ya cargado al renderizar)
    const pedido = _cachePedidos.find(p => p.id === pedidoId);

    if (!pedido) {
      mostrarMensaje('No se encontró el pedido', 'error');
      return;
    }

    const esPedidoActivo = esMiPedido ||
      (pedido.domiciliario_id === _cacheUsuarioId && pedido.estado?.toLowerCase() === 'camino a tu casa');

    const telefonoMostrar = esPedidoActivo ? (pedido.telefono || 'N/A') : ocultarTelefono(pedido.telefono);

    // Dirección completa siempre que sea mi pedido
    const direccionCompleta = esPedidoActivo
      ? (pedido.direccion || '') + (pedido.complemento ? ', ' + pedido.complemento : '')
      : 'Disponible al tomar el pedido';

    const mensajeProteccion = !esPedidoActivo
      ? '<div class="alerta-proteccion">Toma el pedido para ver los datos completos del cliente</div>'
      : '';

    const productosHtml = Array.isArray(pedido.productos) && pedido.productos.length
      ? pedido.productos.map(pr => {
          const sub = pr.precio * pr.cantidad;
          return `
            <div class="producto-detalle-item">
              <div class="producto-nombre-detalle">${pr.nombre}</div>
              <div class="producto-detalles">
                ${pr.cantidad} x $${pr.precio.toLocaleString('es-CO')} = <strong>$${sub.toLocaleString('es-CO')}</strong>
              </div>
            </div>`;
        }).join('')
      : '<p style="color:var(--text-muted);font-size:0.85rem;">Sin productos disponibles</p>';

    const totales = calcularTotalesPedido(pedido);

    const fechaStr = new Date(normalizarFechaUTC(pedido.fecha)).toLocaleString('es-CO', {
      timeZone: 'America/Bogota', year: 'numeric', month: 'long',
      day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true
    });

    const modalHTML = `
      <div class="modal-detalles-contenido">
        <h2>Pedido #${pedido.id}</h2>

        ${mensajeProteccion}

        <div class="detalle-section">
          <h4>Cliente</h4>
          <p><strong>Nombre:</strong> ${pedido.nombre} ${pedido.apellido}</p>
          <p><strong>Telefono:</strong> ${telefonoMostrar}</p>
          <p><strong>Estado:</strong> ${pedido.estado}</p>
        </div>

        <div class="detalle-section">
          <h4>Origen — ${pedido.tipo_pedido_especial ? (pedido.origen_especial || 'Origen especial') : (pedido.restaurantes?.nombre || 'Restaurante')}</h4>
          <p>${pedido.tipo_pedido_especial ? (pedido.origen_especial || 'Sin dirección') : (pedido.restaurantes?.direccion || 'Sin direccion registrada')}</p>
          ${pedido.tipo_pedido_especial && pedido.telefono_origen_especial ? `<p><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;vertical-align:middle;color:#f59e0b;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg> Tel: <a href="tel:${pedido.telefono_origen_especial}" style="color:#f59e0b;text-decoration:none;">${pedido.telefono_origen_especial}</a></p>` : ''}
          ${!pedido.tipo_pedido_especial && pedido.restaurantes?.telefono ? `<p>Tel: ${pedido.restaurantes.telefono}</p>` : ''}
          ${pedido.tipo_pedido_especial && pedido.descripcion_especial ? `<p style="margin-top:6px;color:#94a3b8;font-size:0.85rem;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg> ${pedido.descripcion_especial}</p>` : ''}
          ${pedido.tipo_pedido_especial && pedido.notas_especial ? `<p style="font-style:italic;color:#64748b;font-size:0.82rem;"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:12px;height:12px;vertical-align:middle;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg> ${pedido.notas_especial}</p>` : ''}
        </div>

        <div class="detalle-section">
          <h4>Destino</h4>
          <p><strong>${direccionCompleta || 'Sin direccion'}</strong></p>
          ${pedido.barrio ? `<p>Barrio: ${pedido.barrio}</p>` : ''}
        </div>

        <div class="detalle-section">
          <h4>Productos</h4>
          ${productosHtml}
        </div>

        <div class="detalle-section">
          <h4>Resumen de pago</h4>
          ${pedido.metodo_pago ? `<p><strong>Método de pago:</strong> <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:8px;font-size:0.85rem;font-weight:600;background:${pedido.metodo_pago === 'efectivo' ? 'rgba(16,185,129,0.1);color:#10b981' : pedido.metodo_pago === 'nequi' ? 'rgba(139,92,246,0.1);color:#8b5cf6' : pedido.metodo_pago === 'daviplata' ? 'rgba(239,68,68,0.1);color:#ef4444' : pedido.metodo_pago === 'transferencia' ? 'rgba(59,130,246,0.1);color:#3b82f6' : pedido.metodo_pago === 'datafono' ? 'rgba(245,158,11,0.1);color:#f59e0b' : 'rgba(100,116,139,0.1);color:#64748b'};">${pedido.metodo_pago === 'efectivo' ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/></svg>' : (pedido.metodo_pago === 'nequi' || pedido.metodo_pago === 'daviplata') ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>' : pedido.metodo_pago === 'transferencia' ? '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:13px;height:13px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>'} ${pedido.metodo_pago === 'pagado al restaurante' ? 'Pagado al restaurante' : pedido.metodo_pago.charAt(0).toUpperCase() + pedido.metodo_pago.slice(1)}</span></p>` : '<p><strong>Método de pago:</strong> <span style="color:#94a3b8;font-size:0.85rem;">No especificado</span></p>'}
          <p>Subtotal productos: $${totales.subtotalProductos.toLocaleString('es-CO')}</p>
          ${generarDesgloseEnvio(pedido, totales)}
          ${totales.tieneCupon ? `
            <p>Subtotal sin descuento: $${totales.totalSinDescuento.toLocaleString('es-CO')}</p>
            <p>Descuento cupon: -$${totales.descuentoCupon.toLocaleString('es-CO')}</p>` : ''}
          <p class="total-destacado" style="${totales.tieneCupon ? 'color:#10b981;' : ''}">
            <strong>Total a cobrar: $${totales.totalConDescuento.toLocaleString('es-CO')}</strong>
          </p>
        </div>

        <div class="detalle-section">
          <h4>Fecha del pedido</h4>
          <p>${fechaStr}</p>
        </div>

        <button class="btn-cerrar-modal" onclick="cerrarDetallesPedido()">Cerrar</button>
      </div>`;

    // Eliminar modal anterior si existe
    const existing = document.getElementById('modalDetalles');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'modalDetalles';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex'; // ✅ visible de inmediato, sin fetch
    modal.innerHTML = modalHTML;
    document.body.appendChild(modal);

    modal.addEventListener('click', e => {
      if (e.target === modal) cerrarDetallesPedido();
    });
  }

  function cerrarDetallesPedido() {
    const modal = document.getElementById('modalDetalles');
    if (modal) modal.remove();
  }

  // ========== SOCKET.IO ==========
  function configurarSocket(usuario) {
    if (typeof io === 'undefined') {
      console.error('Socket.IO no disponible');
      return;
    }

    socketInstance = io();
    
    socketInstance.on('connect', () => {
      console.log('Socket conectado');
      socketInstance.emit('join-domiciliario', usuario.id);
      // ✅ Sin delay - cargarPedidos ya se llamó en inicializar()
    });
    
    socketInstance.on('nuevo-pedido', async (data) => {
      console.log('⚡ Nuevo pedido disponible:', data.pedidoId);
      // ✅ Recargar INMEDIATAMENTE sin delay.
      // cargarPedidos() llama a evaluarAlarma(), que activa el sonido en bucle
      // y el banner flotante — también cuando estás DENTRO de la app.
      cargarPedidos();
    });
    
    socketInstance.on('pedido-removido', (data) => {
      const pedidoCard = document.querySelector(`[data-pedido-id="${data.pedidoId}"]`);
      if (pedidoCard) {
        pedidoCard.style.transition = 'all 0.3s ease';
        pedidoCard.style.opacity = '0';
        pedidoCard.style.transform = 'scale(0.8)';
        setTimeout(() => pedidoCard.remove(), 300);
      }
    });

    socketInstance.on('estado-pedido-actualizado', (data) => {
      console.log(`🔄 Estado pedido #${data.pedidoId} cambió a '${data.nuevoEstado}' — recargando`);
      // ✅ FIX: Siempre recargar la lista completa para evitar que pedidos
      // activos desaparezcan por race conditions al remover tarjetas del DOM manualmente
      cargarPedidos();
    });

    socketInstance.on('pedido-liberado', () => {
      cargarPedidos();
    });

    // ✅ NUEVO: Pedido marcado como listo por restaurante
    socketInstance.on('pedido-listo-domiciliario', (data) => {
      console.log('✅ Pedido LISTO:', data);
      cargarPedidos();
      mostrarMensaje(`✅ ¡Pedido #${data.pedidoId} de ${data.restaurante || 'Restaurante'} está LISTO para recoger!`);
    });
  }

  // ========== INICIALIZACIÓN ==========
  async function inicializar() {
    const usuario = await cargarUsuario();
    if (!usuario) return;
    
    // ✅ Cargar pedidos (renderiza disponibles Y activos desde la misma request)
    await cargarPedidos();
    
    console.log('✅ Sistema FCM disponible desde fcm-notifications.js');
    
    configurarSocket(usuario);
    
    console.log('✅ Sistema de notificaciones activo');
  }

  // ========== EVENT LISTENERS ==========
  document.addEventListener('DOMContentLoaded', inicializar);

  document.addEventListener('click', (e) => {
    const modalPago = document.getElementById('modalMetodoPago');
    if (e.target === modalPago) cerrarModalPago();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cerrarDetallesPedido();
      const modalPago = document.getElementById('modalMetodoPago');
      if (modalPago && modalPago.style.display === 'flex') {
        cerrarModalPago();
      }
    }
  });

  const accionPedidoSelect = document.getElementById('accion_pedido');
  if (accionPedidoSelect) {
    accionPedidoSelect.addEventListener('change', function() {
      mostrarCampoExplicacion(this.value);
    });
  }

  // ========== CARGAR PEDIDOS ACTIVOS (tab Activos) ==========

  // ✅ Helper: renderizar activos directamente (sin hacer requests)
  // Se usa cuando cargarPedidos() ya trajo los datos
  // ✅ Anti-parpadeo: solo re-renderizar si los datos cambiaron
  let _lastActivosHash = null; // null = nunca renderizado, fuerza primera renderización
  let _lastDisponiblesHash = '';

  function _calcHash(pedidos) {
    return pedidos.map(p => `${p.id}:${p.estado}:${p.pedido_listo_en || ''}`).join('|');
  }

  function renderizarPedidosActivosDesdeCache(activos) {
    const destino = document.getElementById('listaPedidosActivos');
    if (!destino) return;

    const hash = _calcHash(activos);
    if (hash === _lastActivosHash) return; // ✅ No cambió, no re-renderizar
    _lastActivosHash = hash;

    if (!activos || activos.length === 0) {
      destino.innerHTML = `
        <div class="no-pedidos">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:48px;height:48px;margin:0 auto 16px;display:block;color:var(--text-muted)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/></svg>
          <h3>Sin pedidos activos</h3>
          <p>Tus pedidos en camino aparecerán aquí</p>
        </div>`;
      return;
    }

    // ✅ Ordenar: el pedido que se tomó primero va arriba
    const activosOrdenados = [...activos].sort((a, b) => new Date(normalizarFechaUTC(a.fecha)) - new Date(normalizarFechaUTC(b.fecha)));

    let html = '<div class="pedidos-grid">';
    activosOrdenados.forEach(p => {
      html += generarHtmlPedido(p, true, [], activos.length, true);
    });
    html += '</div>';
    destino.innerHTML = html;
  }

  async function cargarPedidosActivos() {
    const destino = document.getElementById('listaPedidosActivos');
    if (!destino) return;

    // ✅ OPTIMIZACIÓN: Si ya hay cache de pedidos (de cargarPedidos), usarlo directamente
    if (_cachePedidos.length > 0 && _cacheUsuarioId) {
      const activos = _cachePedidos.filter(p =>
        ['camino a tu casa', 'preparando pedido'].includes(p.estado?.toLowerCase()) && p.domiciliario_id === _cacheUsuarioId
      );
      renderizarPedidosActivosDesdeCache(activos);
      return;
    }

    // Solo hacer request si no hay cache (primera vez o datos perdidos)
    try {
      const [usuario, resPedidos] = await Promise.all([
        cargarUsuario(),
        window.apiRequest('/api/domiciliarios/pedidos-domiciliario-con-distancias')
      ]);

      if (!usuario || !resPedidos.ok) throw new Error('Error de API');

      const pedidos = await resPedidos.json();
      _actualizarCache(pedidos, usuario.id);

      const activos = pedidos.filter(p =>
        ['camino a tu casa', 'preparando pedido'].includes(p.estado?.toLowerCase()) && p.domiciliario_id === usuario.id
      );

      renderizarPedidosActivosDesdeCache(activos);
    } catch (err) {
      console.error('Error cargando pedidos activos:', err);
      destino.innerHTML = `<div class="no-pedidos"><h3>Error al cargar</h3><p>Toca aquí para recargar</p></div>`;
    }
  }

  // Sobreescribir cargarPedidos para que también actualice activos
  const _cargarPedidosOriginal = cargarPedidos;
  window.cargarPedidosActivos = cargarPedidosActivos;

  // ========== MAPA DOMICILIARIO ==========
  let mapaDomiActivo = null;
  let intervaloMapaDomi = null;       // Intervalo para API call (datos externos)
  let intervaloPosicionLocal = null;  // ✅ Intervalo rápido para posición local
  let watchIdMapa = null;             // ✅ watchPosition mientras el mapa está abierto
  let markerDomi = null;
  let markerClienteDomi = null;
  let markerRestauranteDomi = null;
  let rutaPolylineDomi = null;
  let coordsClienteMapa = null;
  let coordsRestauranteMapa = null;
  let rutaDestino = 'restaurante';
  let mapaCentrado = false;
  let _pedidoMapaId = null;
  let _mapaSessionId = 0;            // ✅ ID único por apertura de mapa para evitar race conditions
  let _ultimaLatRuta = null;          // ✅ Para detectar movimiento significativo
  let _ultimaLonRuta = null;
  let _rutaRecalculando = false;      // ✅ Evitar recálculos simultáneos
  let _cacheRutas = { restaurante: null, cliente: null }; // ✅ Cache de rutas OSRM

  const iconoDomiMapa = () => L.divIcon({
    className: 'domiciliario-marker-container',
    html: `
      <div class="location-pin">
        <div class="pin-image">
          <img src="img/logo.png" alt="Domiciliario">
        </div>
        <div class="pin-point"></div>
      </div>
    `,
    iconSize: [50, 60],
    iconAnchor: [25, 60],
    popupAnchor: [0, -60]
  });

  const iconoClienteMapa = () => L.divIcon({
    className: 'destino-marker-container',
    html: `
      <div class="location-pin destino">
        <div class="pin-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
          </svg>
        </div>
        <div class="pin-point"></div>
      </div>
    `,
    iconSize: [40, 50],
    iconAnchor: [20, 50],
    popupAnchor: [0, -50]
  });

  const iconoRestauranteMapa = () => L.divIcon({
    className: 'restaurante-marker-container',
    html: `
      <div class="location-pin restaurante">
        <div class="pin-circle">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/>
          </svg>
        </div>
        <div class="pin-point"></div>
      </div>
    `,
    iconSize: [40, 50],
    iconAnchor: [20, 50],
    popupAnchor: [0, -50]
  });

  async function calcularRutaRealDomi(latOrigen, lonOrigen, latDestino, lonDestino) {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${lonOrigen},${latOrigen};${lonDestino},${latDestino}?overview=full&geometries=geojson`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const coordinates = route.geometry.coordinates;
        const latLngs = coordinates.map(coord => [coord[1], coord[0]]);
        const distanciaKm = (route.distance / 1000).toFixed(2);
        const duracionMin = Math.round(route.duration / 60);
        return { latLngs, distancia: distanciaKm, duracion: duracionMin };
      }
      return null;
    } catch (error) {
      console.error('Error calculando ruta:', error);
      return null;
    }
  }

  function calcularDistanciaEntrePuntosDomi(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function limpiarMapaDomi() {
    if (intervaloMapaDomi) {
      clearInterval(intervaloMapaDomi);
      intervaloMapaDomi = null;
    }
    // ✅ Limpiar intervalo de posición local rápida
    if (intervaloPosicionLocal) {
      clearInterval(intervaloPosicionLocal);
      intervaloPosicionLocal = null;
    }
    // ✅ Limpiar watchPosition del mapa
    if (watchIdMapa !== null) {
      navigator.geolocation.clearWatch(watchIdMapa);
      watchIdMapa = null;
    }
    if (mapaDomiActivo) {
      try { mapaDomiActivo.remove(); } catch (e) {}
      mapaDomiActivo = null;
    }
    markerDomi = null;
    markerClienteDomi = null;
    markerRestauranteDomi = null;
    rutaPolylineDomi = null;
    coordsClienteMapa = null;
    coordsRestauranteMapa = null;
    rutaDestino = 'restaurante';
    mapaCentrado = false;
    _pedidoMapaId = null;
    _mapaSessionId++;  // ✅ Invalidar cualquier operación async pendiente del mapa anterior
    _ultimaLatRuta = null;
    _ultimaLonRuta = null;
    _rutaRecalculando = false;
    _cacheRutas = { restaurante: null, cliente: null };
    const container = document.getElementById('mapaContainerDomi');
    if (container) container.innerHTML = '';
    // Ocultar toggle
    const toggle = document.getElementById('mapaRutaToggle');
    if (toggle) toggle.style.display = 'none';
    // ✅ Resetear texto de distancia al spinner de "calculando"
    const distEl = document.getElementById('distanciaMapaDomi');
    if (distEl) distEl.innerHTML = '<div class="spinner-mini"></div> Calculando ruta...';
    // ✅ Ocultar botón de navegación
    const btnNav = document.getElementById('btnNavegarExterno');
    if (btnNav) btnNav.style.display = 'none';
  }

  async function abrirMapaDomiciliario(pedidoId) {
    const modal = document.getElementById('modalMapaDomiciliario');
    if (!modal) return;

    modal.style.display = 'block';
    limpiarMapaDomi();
    _pedidoMapaId = pedidoId;
    const sesionMapa = ++_mapaSessionId; // ✅ ID único para esta apertura

    // Esperar que el DOM se actualice
    await new Promise(r => setTimeout(r, 100));

    const mapaEl = document.getElementById('mapaContainerDomi');
    if (!mapaEl) return;

    // Crear mapa fullscreen con OSM tiles (como mapa_admin)
    mapaDomiActivo = L.map('mapaContainerDomi', {
      attributionControl: false,
      zoomControl: false,
      // ✅ Rotación tipo Google Maps (gesto de 2 dedos)
      rotate: true,
      touchRotate: true,
      rotateMarkers: false,  // los iconos NO rotan, solo el mapa
      bearing: 0
    }).setView([5.0689, -73.8217], 13);

    // ✅ Zoom con dedos (pinch-to-zoom) — botones eliminados en móvil

    // ✅ Tile OSM detallado (mismo que mapa_admin)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      crossOrigin: true
    }).addTo(mapaDomiActivo);

    // ✅ HELPER: Obtener posición local del domiciliario (sin API call)
    function obtenerPosicionLocal() {
      if (window.unifiedGeoService && window.unifiedGeoService.lastPosition) {
        return {
          lat: window.unifiedGeoService.lastPosition.latitude,
          lon: window.unifiedGeoService.lastPosition.longitude
        };
      }
      return null;
    }

    // ✅ HELPER: Verificar si se movió más de X metros desde último cálculo de ruta
    function seMovioSignificativamente(lat, lon, umbralMetros = 50) {
      if (_ultimaLatRuta === null || _ultimaLonRuta === null) return true;
      const distancia = calcularDistanciaEntrePuntosDomi(lat, lon, _ultimaLatRuta, _ultimaLonRuta);
      return distancia * 1000 > umbralMetros; // convertir km a metros
    }

    // ✅ FUNCIÓN RÁPIDA: Solo actualizar marcador del domiciliario (sin API, sin ruta)
    function actualizarMarcadorLocal() {
      const pos = obtenerPosicionLocal();
      if (!pos || !mapaDomiActivo) return;

      if (markerDomi) {
        markerDomi.setLatLng([pos.lat, pos.lon]);
      } else {
        markerDomi = L.marker([pos.lat, pos.lon], {
          icon: iconoDomiMapa(),
          rotation: 0,
          rotateWithView: false  // ✅ no rota con el mapa
        }).addTo(mapaDomiActivo);
        markerDomi.bindPopup('Tu posicion');
      }
    }

    // ✅ FUNCIÓN: Dibujar la ruta del destino activo desde cache
    function dibujarRutaDesdeCache(latDomi, lonDomi) {
      if (!mapaDomiActivo) return;

      // Siempre limpiar polyline anterior
      if (rutaPolylineDomi) {
        mapaDomiActivo.removeLayer(rutaPolylineDomi);
        rutaPolylineDomi = null;
      }

      const label = rutaDestino;
      const colorRuta = label === 'restaurante' ? '#f59e0b' : '#3b82f6';
      const iconRuta = label === 'restaurante' ? '🍔' : '🏠';
      const cached = _cacheRutas[label];

      if (cached && cached.latLngs) {
        // ✅ Ruta OSRM cacheada — dibujar instantáneamente
        rutaPolylineDomi = L.polyline(cached.latLngs, {
          color: colorRuta, weight: 5, opacity: 0.8
        }).addTo(mapaDomiActivo);

        const distEl = document.getElementById('distanciaMapaDomi');
        if (distEl) distEl.textContent = `${iconRuta} A ${cached.distancia} km del ${label} (~${cached.duracion} min)`;
      } else {
        // Sin cache aún — mostrar spinner "Calculando..."
        const distEl = document.getElementById('distanciaMapaDomi');
        if (distEl) distEl.innerHTML = `<div class="spinner-mini"></div> Calculando ruta al ${label}...`;
      }
    }

    // ✅ FUNCIÓN: Calcular ruta OSRM para un destino y cachear
    async function calcularYCachearRuta(label, latDomi, lonDomi, coordsDestino) {
      try {
        const rutaData = await calcularRutaRealDomi(latDomi, lonDomi, coordsDestino.lat, coordsDestino.lon);
        // ✅ Guard: si el mapa cambió mientras OSRM respondía, descartar resultado
        if (_mapaSessionId !== sesionMapa) return null;
        if (rutaData) {
          _cacheRutas[label] = rutaData;
          console.log(`✅ Ruta ${label} cacheada: ${rutaData.distancia} km`);
        } else {
          // Fallback: no hay ruta OSRM, cachear distancia haversine
          const dist = calcularDistanciaEntrePuntosDomi(latDomi, lonDomi, coordsDestino.lat, coordsDestino.lon);
          _cacheRutas[label] = {
            latLngs: [[latDomi, lonDomi], [coordsDestino.lat, coordsDestino.lon]],
            distancia: dist.toFixed(2),
            duracion: Math.round(dist * 3), // estimado ~3 min/km
            esFallback: true
          };
        }
        return _cacheRutas[label];
      } catch (err) {
        console.error(`Error calculando ruta ${label}:`, err);
        return null;
      }
    }

    // ✅ FUNCIÓN: Precalcular AMBAS rutas en paralelo + dibujar la activa
    async function precalcularRutas(latDomi, lonDomi) {
      if (_rutaRecalculando) return;
      _rutaRecalculando = true;

      try {
        const promesas = [];

        if (coordsRestauranteMapa) {
          promesas.push(calcularYCachearRuta('restaurante', latDomi, lonDomi, coordsRestauranteMapa));
        }
        if (coordsClienteMapa) {
          promesas.push(calcularYCachearRuta('cliente', latDomi, lonDomi, coordsClienteMapa));
        }

        // ✅ Ambas rutas en PARALELO — no espera una para empezar la otra
        await Promise.all(promesas);

        // ✅ Guard: si el mapa cambió mientras calculaba, no dibujar
        if (_mapaSessionId !== sesionMapa) return;

        _ultimaLatRuta = latDomi;
        _ultimaLonRuta = lonDomi;

        // Dibujar la ruta del destino activo
        dibujarRutaDesdeCache(latDomi, lonDomi);
      } catch (error) {
        console.error('Error precalculando rutas:', error);
      } finally {
        _rutaRecalculando = false;
      }
    }

    // ✅ FUNCIÓN: Recalcular rutas solo si se movió significativamente
    async function recalcularRutaSiNecesario(latDomi, lonDomi) {
      if (_rutaRecalculando) return;
      if (!seMovioSignificativamente(latDomi, lonDomi, 50)) return;
      await precalcularRutas(latDomi, lonDomi);
    }

    // ✅ FUNCIÓN COMPLETA: Obtener datos del servidor (restaurante, cliente) + centrar mapa inicial
    async function actualizarDatosExternos() {
      // ✅ Guard: si el mapa cambió de sesión, no hacer nada
      if (!mapaDomiActivo || _mapaSessionId !== sesionMapa) return;

      try {
        const response = await window.apiRequest(`/api/pedido/${pedidoId}/ubicacion-domiciliario`);
        if (!response.ok) return;
        // Re-check después del await
        if (!mapaDomiActivo || _mapaSessionId !== sesionMapa) return;

        const data = await response.json();

        // Marcador del restaurante (solo una vez por apertura de mapa)
        if (!markerRestauranteDomi && data.ubicacion_restaurante) {
          const latR = parseFloat(data.ubicacion_restaurante.latitud);
          const lonR = parseFloat(data.ubicacion_restaurante.longitud);
          if (latR && lonR && !isNaN(latR) && !isNaN(lonR) && Math.abs(latR) <= 90 && Math.abs(lonR) <= 180) {
            coordsRestauranteMapa = { lat: latR, lon: lonR };
            markerRestauranteDomi = L.marker([latR, lonR], {
              icon: iconoRestauranteMapa(),
              rotation: 0,
              rotateWithView: false  // ✅ no rota con el mapa
            }).addTo(mapaDomiActivo);
            markerRestauranteDomi.bindPopup(data.nombre_restaurante || 'Restaurante');
          } else {
            // Marcar como intentado para no reintentar
            markerRestauranteDomi = 'sin_gps';
          }
        }

        // ✅ Marcador del cliente — SOLO si tiene coordenadas GPS válidas
        // Pedidos especiales (pedido_especial.html) NO tienen latitud_cliente/longitud_cliente
        if (!markerClienteDomi) {
          const latC = data.direccion_cliente ? parseFloat(data.direccion_cliente.latitud) : NaN;
          const lonC = data.direccion_cliente ? parseFloat(data.direccion_cliente.longitud) : NaN;

          if (latC && lonC && !isNaN(latC) && !isNaN(lonC) && Math.abs(latC) <= 90 && Math.abs(lonC) <= 180) {
            coordsClienteMapa = { lat: latC, lon: lonC };
            markerClienteDomi = L.marker([latC, lonC], {
              icon: iconoClienteMapa(),
              rotation: 0,
              rotateWithView: false  // ✅ no rota con el mapa
            }).addTo(mapaDomiActivo);
            markerClienteDomi.bindPopup('Destino del cliente');
          } else {
            // ✅ NO hay coords de cliente (pedido especial o por_zona)
            // Marcar como intentado para no confundir con coords de otro pedido
            markerClienteDomi = 'sin_gps';
            coordsClienteMapa = null;
          }
        }

        // Mostrar toggle si hay coordenadas del restaurante
        const toggle = document.getElementById('mapaRutaToggle');
        if (toggle && coordsRestauranteMapa) {
          toggle.style.display = 'flex';
          const btnCliente = document.getElementById('btnRutaCliente');
          if (btnCliente) {
            // ✅ Ocultar botón "Cliente" si no hay coordenadas GPS
            btnCliente.style.display = coordsClienteMapa ? '' : 'none';
          }
          // ✅ Si el toggle está en "cliente" pero no hay coords, forzar a "restaurante"
          if (!coordsClienteMapa && rutaDestino === 'cliente') {
            rutaDestino = 'restaurante';
            const btnRest = document.getElementById('btnRutaRestaurante');
            if (btnRest) btnRest.classList.add('active');
            if (btnCliente) btnCliente.classList.remove('active');
          }
        }

        // ✅ Actualizar botón de navegación externa
        actualizarBotonNavegacion();

        // ✅ Actualizar marcador domiciliario (con fallback al servidor si no hay local)
        let latDomi = null, lonDomi = null;
        const posLocal = obtenerPosicionLocal();
        if (posLocal) {
          latDomi = posLocal.lat;
          lonDomi = posLocal.lon;
        } else if (data.ubicacion_domiciliario) {
          latDomi = parseFloat(data.ubicacion_domiciliario.latitud);
          lonDomi = parseFloat(data.ubicacion_domiciliario.longitud);
          // ✅ Guardar en unifiedGeoService como fallback
          if (window.unifiedGeoService && latDomi && lonDomi) {
            window.unifiedGeoService.lastPosition = { latitude: latDomi, longitude: lonDomi };
          }
        }

        if (latDomi && lonDomi && !isNaN(latDomi) && !isNaN(lonDomi)) {
          if (markerDomi) {
            markerDomi.setLatLng([latDomi, lonDomi]);
          } else {
            markerDomi = L.marker([latDomi, lonDomi], {
              icon: iconoDomiMapa(),
              rotation: 0,
              rotateWithView: false  // ✅ no rota con el mapa
            }).addTo(mapaDomiActivo);
            markerDomi.bindPopup('Tu posicion');
          }
        }

        // Centrar mapa en la primera carga con todos los puntos visibles
        if (!mapaCentrado) {
          const puntos = [];
          if (latDomi && lonDomi) puntos.push([latDomi, lonDomi]);
          if (coordsClienteMapa) puntos.push([coordsClienteMapa.lat, coordsClienteMapa.lon]);
          if (coordsRestauranteMapa) puntos.push([coordsRestauranteMapa.lat, coordsRestauranteMapa.lon]);

          if (puntos.length > 1) {
            mapaDomiActivo.fitBounds(L.latLngBounds(puntos), { padding: [50, 50] });
            mapaCentrado = true;
          } else if (puntos.length === 1) {
            mapaDomiActivo.setView(puntos[0], 15);
            mapaCentrado = true;
          }
        }

        // ✅ Calcular rutas: en primera carga forzar precálculo de AMBAS rutas en paralelo
        if (latDomi && lonDomi) {
          if (!mapaCentrado || !_cacheRutas.restaurante) {
            // Primera vez — precalcular AMBAS rutas en paralelo
            await precalcularRutas(latDomi, lonDomi);
          } else {
            // Posteriores — solo recalcular si se movió significativamente
            await recalcularRutaSiNecesario(latDomi, lonDomi);
          }
        }

      } catch (error) {
        console.error('Error actualizando datos externos del mapa:', error);
      }
    }

    // ✅ INICIAR watchPosition LOCAL mientras el mapa está abierto (posición ultra-fresca)
    try {
      if (navigator.geolocation) {
        watchIdMapa = navigator.geolocation.watchPosition(
          (position) => {
            if (_mapaSessionId !== sesionMapa) return;
            if (window.unifiedGeoService) {
              window.unifiedGeoService.lastPosition = {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
              };
            }
            // Actualizar marcador inmediatamente
            actualizarMarcadorLocal();
          },
          (error) => console.warn('watchPosition mapa error:', error.message),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 2000 }
        );
        console.log('✅ watchPosition activo para el mapa');
      }
    } catch (e) {
      console.warn('No se pudo iniciar watchPosition para mapa:', e);
    }

    // ✅ Primera actualización completa inmediata
    await actualizarDatosExternos();

    // ✅ Actualización RÁPIDA del marcador local cada 3 segundos
    intervaloPosicionLocal = setInterval(() => {
      if (!mapaDomiActivo || _mapaSessionId !== sesionMapa) return;
      actualizarMarcadorLocal();
      
      // Recalcular ruta cada 3 ciclos (~9 seg) si se movió bastante
      const pos = obtenerPosicionLocal();
      if (pos && seMovioSignificativamente(pos.lat, pos.lon, 50)) {
        recalcularRutaSiNecesario(pos.lat, pos.lon);
      }
    }, 3000);

    // ✅ Actualización de datos EXTERNOS (restaurante, cliente) cada 15 segundos
    intervaloMapaDomi = setInterval(actualizarDatosExternos, 15000);
  }

  function cambiarRutaMapa(destino) {
    rutaDestino = destino;

    // Actualizar toggle visual
    const btnRest = document.getElementById('btnRutaRestaurante');
    const btnCli = document.getElementById('btnRutaCliente');
    if (btnRest) btnRest.classList.toggle('active', destino === 'restaurante');
    if (btnCli) btnCli.classList.toggle('active', destino === 'cliente');

    // ✅ Actualizar botón de navegación externa
    actualizarBotonNavegacion();

    // ✅ Limpiar polyline anterior
    if (rutaPolylineDomi && mapaDomiActivo) {
      mapaDomiActivo.removeLayer(rutaPolylineDomi);
      rutaPolylineDomi = null;
    }

    // ✅ Obtener posición del domiciliario
    let latDomi = null, lonDomi = null;
    if (window.unifiedGeoService && window.unifiedGeoService.lastPosition) {
      latDomi = window.unifiedGeoService.lastPosition.latitude;
      lonDomi = window.unifiedGeoService.lastPosition.longitude;
    }
    if ((!latDomi || !lonDomi) && markerDomi) {
      const pos = markerDomi.getLatLng();
      latDomi = pos.lat;
      lonDomi = pos.lng;
    }

    // ✅ USAR CACHE — si ya se precalculó, dibujar instantáneamente sin API
    const cached = _cacheRutas[destino];
    const colorRuta = destino === 'restaurante' ? '#f59e0b' : '#3b82f6';
    const iconRuta = destino === 'restaurante' ? '🍔' : '🏠';

    if (cached && cached.latLngs && mapaDomiActivo) {
      rutaPolylineDomi = L.polyline(cached.latLngs, {
        color: colorRuta,
        weight: cached.esFallback ? 4 : 5,
        opacity: cached.esFallback ? 0.7 : 0.8,
        dashArray: cached.esFallback ? '10, 10' : null
      }).addTo(mapaDomiActivo);

      const distEl = document.getElementById('distanciaMapaDomi');
      if (distEl) {
        distEl.textContent = `${iconRuta} A ${cached.distancia} km del ${destino} (~${cached.duracion} min)`;
      }
    } else if (latDomi && lonDomi) {
      // ✅ No hay cache — calcular ahora (solo para este destino)
      let coordsDestino = null;
      if (destino === 'restaurante' && coordsRestauranteMapa) coordsDestino = coordsRestauranteMapa;
      else if (destino === 'cliente' && coordsClienteMapa) coordsDestino = coordsClienteMapa;

      if (coordsDestino) {
        const distEl = document.getElementById('distanciaMapaDomi');
        if (distEl) distEl.innerHTML = `<div class="spinner-mini"></div> Calculando ruta al ${destino}...`;

        // Calcular asíncronamente y dibujar cuando esté listo
        (async () => {
          const rutaData = await calcularRutaRealDomi(latDomi, lonDomi, coordsDestino.lat, coordsDestino.lon);
          if (rutaData) {
            _cacheRutas[destino] = rutaData;
          } else {
            const dist = calcularDistanciaEntrePuntosDomi(latDomi, lonDomi, coordsDestino.lat, coordsDestino.lon);
            _cacheRutas[destino] = {
              latLngs: [[latDomi, lonDomi], [coordsDestino.lat, coordsDestino.lon]],
              distancia: dist.toFixed(2),
              duracion: Math.round(dist * 3),
              esFallback: true
            };
          }
          // Solo dibujar si el toggle sigue en este destino
          if (rutaDestino === destino && mapaDomiActivo) {
            if (rutaPolylineDomi) mapaDomiActivo.removeLayer(rutaPolylineDomi);
            const c = _cacheRutas[destino];
            rutaPolylineDomi = L.polyline(c.latLngs, {
              color: colorRuta,
              weight: c.esFallback ? 4 : 5,
              opacity: c.esFallback ? 0.7 : 0.8,
              dashArray: c.esFallback ? '10, 10' : null
            }).addTo(mapaDomiActivo);
            if (distEl) distEl.textContent = `${iconRuta} A ${c.distancia} km del ${destino} (~${c.duracion} min)`;
          }
        })();
      }
    }
  }

  function cerrarMapaDomiciliario() {
    limpiarMapaDomi();
    const modal = document.getElementById('modalMapaDomiciliario');
    if (modal) modal.style.display = 'none';
  }

  // ✅ NUEVO: Abrir navegación externa (Google Maps / Waze) para la ruta seleccionada
  function abrirNavegacionExterna() {
    let coordsDestino = null;

    if (rutaDestino === 'restaurante' && coordsRestauranteMapa) {
      coordsDestino = coordsRestauranteMapa;
    } else if (rutaDestino === 'cliente' && coordsClienteMapa) {
      coordsDestino = coordsClienteMapa;
    } else if (coordsRestauranteMapa) {
      coordsDestino = coordsRestauranteMapa;
    } else if (coordsClienteMapa) {
      coordsDestino = coordsClienteMapa;
    }

    if (!coordsDestino) {
      if (typeof mostrarMensaje === 'function') mostrarMensaje('No hay coordenadas del destino', 'error');
      return;
    }

    const lat = coordsDestino.lat;
    const lon = coordsDestino.lon;

    // En Capacitor (APK), intentar abrir Google Maps app directamente
    const isCapacitor = !!window.Capacitor;

    if (isCapacitor) {
      // Intent para Google Maps en Android
      const googleMapsUrl = `google.navigation:q=${lat},${lon}&mode=d`;
      const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;

      try {
        // Intentar abrir con App Launcher plugin si existe
        if (window.Capacitor?.Plugins?.AppLauncher) {
          window.Capacitor.Plugins.AppLauncher.openUrl({ url: `geo:${lat},${lon}?q=${lat},${lon}` })
            .catch(() => {
              // Fallback: abrir en navegador interno
              window.open(fallbackUrl, '_system');
            });
        } else {
          // Fallback: usar window.open con intent scheme
          window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`, '_system');
        }
      } catch (e) {
        window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`, '_system');
      }
    } else {
      // En web, abrir Google Maps en nueva pestaña
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`, '_blank');
    }
  }

  // ✅ Mostrar/ocultar botón de navegación según si hay coordenadas de destino
  function actualizarBotonNavegacion() {
    const btn = document.getElementById('btnNavegarExterno');
    if (!btn) return;

    let hayDestino = false;
    if (rutaDestino === 'restaurante' && coordsRestauranteMapa) hayDestino = true;
    else if (rutaDestino === 'cliente' && coordsClienteMapa) hayDestino = true;
    else if (coordsRestauranteMapa || coordsClienteMapa) hayDestino = true;

    btn.style.display = hayDestino ? 'flex' : 'none';

    // Actualizar texto del botón con el destino actual
    if (hayDestino) {
      const label = rutaDestino === 'cliente' ? 'Navegar al Cliente' : 'Navegar al Restaurante';
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:18px;height:18px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg> ${label}`;
    }
  }

  // ========== EXPORTAR FUNCIONES GLOBALES ==========
  window.logout = logout;
  window.tomarPedido = tomarPedido;
  window.recogerPedido = recogerPedido;
  window.abrirModalPago = abrirModalPago;
  window.cerrarModalPago = cerrarModalPago;
  window.confirmarEntrega = confirmarEntrega;
  window.abrirModalProblema = abrirModalProblema;
  window.cerrarModalProblema = cerrarModalProblema;
  window.mostrarOtroCampo = mostrarOtroCampo;
  window.mostrarCampoExplicacion = mostrarCampoExplicacion;
  window.confirmarNoEntregado = confirmarNoEntregado;
  window.abrirModalLiberar = abrirModalLiberar;
  window.cerrarModalLiberar = cerrarModalLiberar;
  window.mostrarDetalleMotivo = mostrarDetalleMotivo;
  window.confirmarLiberarPedido = confirmarLiberarPedido;
  window.abrirDetallesPedido = abrirDetallesPedido;
  window.cerrarDetallesPedido = cerrarDetallesPedido;
  window.abrirMapaDomiciliario = abrirMapaDomiciliario;
  window.cerrarMapaDomiciliario = cerrarMapaDomiciliario;
  window.cambiarRutaMapa = cambiarRutaMapa;
  window.abrirNavegacionExterna = abrirNavegacionExterna;
  window.cargarPedidos = cargarPedidos;

})();