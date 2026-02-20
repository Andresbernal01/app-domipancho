// domiciliario.js - Versión Optimizada: Sin delays, recarga instantánea
(function() {
  'use strict';

  // ========== VARIABLES GLOBALES ==========
  let pedidosActivosGlobal = 0;
  let pedidoProblemaId = null;
  let pedidoALiberarId = null;
  let socketInstance = null;
  let mobileNotif = null;

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
    'camino a tu casa': 'camino',
    'entregado': 'entregado',
    'cancelado': 'cancelado'
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
      contadorContainer.className = 'pedidos-activos-contador';
      if (cantidad >= 2) contadorContainer.classList.add('limite-alcanzado');
      else if (cantidad === 1) contadorContainer.classList.add('limite-cerca');
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

  // ========== AUTENTICACIÓN ==========
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

  async function cargarUsuario() {
    try {
      const response = await window.apiRequest('/api/usuario-actual');
      if (response.ok) {
        const usuario = await response.json();
        const userEl = document.getElementById('restaurantName');
        if (userEl) {
          userEl.textContent = `${usuario.usuario || 'Usuario'}`;
        }
        return usuario;
      }
    } catch (error) {
      console.error('Error al cargar usuario:', error);
    }
    return null;
  }

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
      // 1. VERIFICAR ESTADO DE DISPONIBILIDAD
      let disponible = true;
      try {
        const dispResponse = await window.apiRequest('/api/domiciliarios/domiciliario/estado-disponibilidad');
        if (dispResponse.ok) {
          const dispData = await dispResponse.json();
          disponible = dispData.disponible !== false;
        }
      } catch (error) {
        console.warn('Error verificando disponibilidad:', error);
      }
  
      // 2. OBTENER PEDIDOS
      const res = await window.apiRequest('/api/domiciliarios/pedidos-domiciliario-con-distancias');
      let pedidos = await res.json();
      
      if (!res.ok && pedidos?.error === 'bloqueado') {
        document.getElementById('listaPedidos').innerHTML = `
          <div class="bloqueado">
            <h3>⛔ Cuenta Bloqueada</h3>
            <p>${pedidos.mensaje}</p>
          </div>
        `;
        return;
      }
  
      const usuario = await cargarUsuario();
      if (!usuario) return;

      // ✅ Actualizar cache para que abrirDetallesPedido sea instantáneo
      _actualizarCache(pedidos, usuario.id);

      // 3. FILTRAR PEDIDOS
      let pedidosFiltrados = pedidos.filter(pedido => {
        if (pedido.estado?.toLowerCase() === 'camino a tu casa' && pedido.domiciliario_id === usuario.id) {
          return true;
        }
        return pedido.estado?.toLowerCase() === 'esperando repartidor';
      });
  
      const disponiblesArr = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'esperando repartidor');
      const misActivos = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'camino a tu casa');
      
      actualizarContadorPedidos(misActivos.length);
  
      // ✅ Solo mostrar disponibles en esta sección; los activos van en su propio tab
      renderizarPedidos(disponiblesArr, misActivos, [], disponible);

    // ✅ Actualizar tab de Activos también
    cargarPedidosActivos();

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
    
    if (!Array.isArray(pedidosDisponibles) || pedidosDisponibles.length === 0) {
      if (disponible) {
        contenedor.innerHTML = misActivos.length >= 2 
          ? '<div class="no-pedidos"><h3>🚛 Tienes el máximo de pedidos (2/2)</h3><p>Completa una entrega para poder tomar nuevos pedidos.</p></div>'
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
    } else if (misActivos.length >= 2) {
      htmlContent += '<div class="alerta limite-alcanzado"><h3>🚛 Máximo de pedidos alcanzado (2/2)</h3><p>Completa una entrega para poder tomar nuevos pedidos.</p></div>';
    } else if (misActivos.length === 1) {
      htmlContent += '<div class="alerta advertencia-limite"><h3>⚠️ Puedes tomar 1 pedido más (1/2)</h3><p>Tienes espacio para un pedido adicional.</p></div>';
    }
  
    const pedidosOrdenados = [...pedidosDisponibles].sort((a, b) =>
      new Date(a.fecha) - new Date(b.fecha)
    );
  
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
    const horaStr     = new Date(p.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const cardClass   = esMiPedido ? 'mi-pedido' : 'disponible';
    const previewClass = (!disponible && !esMiPedido) ? ' pedido-preview' : '';

    // Origen: nombre restaurante + direccion
    const origenNombre = p.restaurantes?.nombre || 'Restaurante';
    const origenDir    = p.restaurantes?.direccion || '';

    // Destino: completo si es mi pedido, oculto si no
    const destinoDir    = esMiPedido
      ? (p.direccion || '') + (p.complemento ? ', ' + p.complemento : '')
      : 'Ver al tomar el pedido';
    const destinoBarrio = p.barrio || '';
    const destinoDotClass = esMiPedido ? 'destino-activo' : 'destino';

    // Distancia
    const distanciaStr = (!esMiPedido && p.distancia_al_restaurante != null && disponible)
      ? `<span class="card-dist">${p.distancia_al_restaurante.toFixed(2)} km al restaurante</span>`
      : '';

    // Total
    const totalStr  = `$${totales.totalConDescuento.toLocaleString('es-CO')}`;
    const cuponHtml = totales.tieneCupon
      ? `<span class="card-cupon">Cupon -$${totales.descuentoCupon.toLocaleString('es-CO')}</span>`
      : '';

    // Estado texto limpio
    const estadoTexto = esMiPedido ? 'En camino' : 'Disponible';

    // Botones: layout diferente para mi pedido vs disponible
    const botonesHtml = esMiPedido
      ? `<div class="card-btns mi-pedido-btns">
           <button class="cbtn cbtn-det" onclick="abrirDetallesPedido(${p.id}, true)">Ver detalles</button>
           <div class="card-btns-acciones">
             <button class="cbtn cbtn-lib"  onclick="abrirModalLiberar(${p.id})">Liberar</button>
             <button class="cbtn cbtn-ok"   onclick="abrirModalPago(${p.id})">Entregar</button>
             <button class="cbtn cbtn-prob" onclick="abrirModalProblema(${p.id})">Problema</button>
           </div>
         </div>`
      : `<div class="card-btns">
           <button class="cbtn cbtn-det" onclick="abrirDetallesPedido(${p.id}, false)">Ver detalles</button>
           ${generarBotonesAccion(p, esMiPedido, cantidadActivos, disponible)}
         </div>`;

    return `
      <div class="pedido-card ${cardClass}${previewClass}" data-pedido-id="${p.id}">

        <div class="card-top">
          <span class="card-id">#${p.id}</span>
          <span class="estado ${estadoClase}">${estadoTexto}</span>
          <span class="card-hora">${horaStr}</span>
        </div>

        <div class="card-ruta">
          <div class="card-punto">
            <span class="punto-dot origen"></span>
            <span class="punto-texto">
              <span class="punto-label">Origen</span>
              <span class="punto-val">${origenNombre}</span>
              ${origenDir ? `<span class="punto-sub">${origenDir}</span>` : ''}
            </span>
          </div>
          <div class="card-punto">
            <span class="punto-dot ${destinoDotClass}"></span>
            <span class="punto-texto">
              <span class="punto-label">Destino</span>
              <span class="punto-val">${destinoDir}</span>
              ${destinoBarrio ? `<span class="punto-sub">Barrio: ${destinoBarrio}</span>` : ''}
            </span>
          </div>
        </div>

        <div class="card-money">
          <span class="card-total${totales.tieneCupon ? ' con-cupon' : ''}">${totalStr}</span>
          ${cuponHtml}
          ${distanciaStr}
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
      const off = cantidadActivos >= 2;
      return `<button class="cbtn cbtn-tomar" onclick="tomarPedido(${pedido.id})" ${off ? 'disabled' : ''}>${off ? 'Limite alcanzado' : 'Tomar pedido'}</button>`;
    }
    return '';
  }

  // ========== ACCIONES DE PEDIDOS ==========
  async function tomarPedido(pedidoId) {
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
    
    if (pedidosActivosGlobal >= 2) {
      mostrarMensaje('❌No puedes tomar más pedidos. Máximo 2 pedidos activos permitidos.', 'error');
      return;
    }
  
    if (!confirm('¿Quieres tomar este pedido?')) return;
  
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
        
        mostrarMensaje(`Pedido asignado (${result.pedidosActivos || 1}/2 activos)`);
        actualizarContadorPedidos(result.pedidosActivos || 1);
        // ✅ Recargar inmediatamente sin delay
        await cargarPedidos();
      } else {
        if (btnTomar) {
          btnTomar.disabled = false;
          btnTomar.textContent = 'Tomar';
        }
        mostrarMensaje(`❌ ${result.error || 'No se pudo tomar el pedido'}`, 'error');
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

  // ========== MODALES ==========
  function abrirModalPago(pedidoId) {
    window.pedidoSeleccionado = pedidoId;
    
    const radios = document.querySelectorAll('input[name="metodo_pago"]');
    radios.forEach(radio => {
      radio.checked = false;
      radio.addEventListener('change', habilitarBotonConfirmar);
    });
    
    const btnConfirmar = document.getElementById('btnConfirmarEntrega');
    btnConfirmar.disabled = true;
    
    document.getElementById('modalMetodoPago').style.display = 'flex';
  }

  function habilitarBotonConfirmar() {
    const radioSeleccionado = document.querySelector('input[name="metodo_pago"]:checked');
    const btnConfirmar = document.getElementById('btnConfirmarEntrega');
    btnConfirmar.disabled = !radioSeleccionado;
  }

  function cerrarModalPago() {
    document.getElementById('modalMetodoPago').style.display = 'none';
    window.pedidoSeleccionado = null;
    
    const radios = document.querySelectorAll('input[name="metodo_pago"]');
    radios.forEach(radio => radio.removeEventListener('change', habilitarBotonConfirmar));
  }

  async function confirmarEntrega() {
    const metodo = document.querySelector('input[name="metodo_pago"]:checked');
    
    if (!metodo) {
      mostrarMensaje('⚠️ Selecciona un método de pago primero', 'error');
      return;
    }
  
    const btnConfirmar = document.getElementById('btnConfirmarEntrega');
    const textoOriginal = btnConfirmar.innerHTML;
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
        const metodoPagoTexto = metodo.value === 'efectivo' ? 'efectivo' : 'pago por App';
        mostrarMensaje(`✅ Pedido entregado exitosamente con ${metodoPagoTexto}`);
        
        // ✅ VERIFICAR SI HAY MÁS PEDIDOS ACTIVOS
        const usuarioResponse = await window.apiRequest('/api/usuario-actual');
        const usuarioData = await usuarioResponse.json();

        const pedidosActivosResponse = await window.apiRequest(
          `/api/pedidos-activos-domiciliario/${usuarioData.id}`
        );
        const pedidosActivosData = await pedidosActivosResponse.json();
        const pedidosActivos = pedidosActivosData.pedidos || [];
        
        if (!pedidosActivos || pedidosActivos.length === 0) {
          console.log('🛑 No hay más pedidos activos - deteniendo servicio');
          localStorage.removeItem('domiciliario_pedido_activo');
          localStorage.removeItem('domiciliario_pedido_id');
          
          if (window.unifiedGeoService) {
            await window.unifiedGeoService.stopTracking();
          }
        } else {
          console.log(`✅ Aún hay ${pedidosActivos.length} pedidos activos - manteniendo servicio`);
        }
        
        cerrarModalPago();
        // ✅ Recargar sin delay
        await cargarPedidos();
      } else {
        mostrarMensaje('❌ Error al marcar como entregado', 'error');
        btnConfirmar.disabled = false;
        btnConfirmar.innerHTML = textoOriginal;
      }
    } catch (err) {
      console.error('Error:', err);
      mostrarMensaje('❌ Error de conexión', 'error');
      btnConfirmar.disabled = false;
      btnConfirmar.innerHTML = textoOriginal;
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
    const textoOriginal = btnConfirmar.innerHTML;
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
        
        const usuarioResponse = await window.apiRequest('/api/usuario-actual');
        const usuarioData = await usuarioResponse.json();

        const pedidosActivosResponse = await window.apiRequest(
          `/api/pedidos-activos-domiciliario/${usuarioData.id}`
        );
        const pedidosActivosData = await pedidosActivosResponse.json();
        const pedidosActivos = pedidosActivosData.pedidos || [];
        
        if (!pedidosActivos || pedidosActivos.length === 0) {
          console.log('🛑 No hay más pedidos activos - deteniendo servicio');
          localStorage.removeItem('domiciliario_pedido_activo');
          localStorage.removeItem('domiciliario_pedido_id');
          
          if (window.unifiedGeoService) {
            await window.unifiedGeoService.stopTracking();
          }
        }
        
        cerrarModalProblema();
        // ✅ Recargar sin delay
        await cargarPedidos();
      } else {
        mostrarMensaje(`❌ Error: ${result.error || 'No se pudo actualizar el estado del pedido'}`, 'error');
        btnConfirmar.disabled = false;
        btnConfirmar.innerHTML = textoOriginal;
      }
    } catch (error) {
      console.error('Error al marcar como no entregado:', error);
      mostrarMensaje('❌ Error de conexión. Por favor intenta nuevamente.', 'error');
      btnConfirmar.disabled = false;
      btnConfirmar.innerHTML = textoOriginal;
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

    const fechaStr = new Date(pedido.fecha).toLocaleString('es-CO', {
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
          <h4>Origen — ${pedido.restaurantes?.nombre || 'Restaurante'}</h4>
          <p>${pedido.restaurantes?.direccion || 'Sin direccion registrada'}</p>
          ${pedido.restaurantes?.telefono ? `<p>Tel: ${pedido.restaurantes.telefono}</p>` : ''}
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
          <p>Subtotal productos: $${totales.subtotalProductos.toLocaleString('es-CO')}</p>
          <p>Domicilio: $${totales.costoDomicilio.toLocaleString('es-CO')}</p>
          ${totales.tarifaDomiPancho > 0 ? `<p>Tarifa DomiPancho: $${totales.tarifaDomiPancho.toLocaleString('es-CO')}</p>` : ''}
          ${pedido.tipo_tarifa === 'por_km' && pedido.distancia_km ? `<p>Tarifa por km: ${pedido.distancia_km} km</p>` : ''}
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
      // ✅ Recargar INMEDIATAMENTE sin delay
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
      if (data.nuevoEstado !== 'esperando repartidor') {
        const pedidoCard = document.querySelector(`[data-pedido-id="${data.pedidoId}"]`);
        if (pedidoCard && !pedidoCard.classList.contains('mi-pedido')) {
          setTimeout(() => pedidoCard.remove(), 500);
        }
      }
    });

    socketInstance.on('pedido-liberado', () => {
      // ✅ Sin delay
      cargarPedidos();
    });
  }

  // ========== INICIALIZACIÓN ==========
  async function inicializar() {
    const usuario = await cargarUsuario();
    if (!usuario) return;
    
    // ✅ Cargar activos Y disponibles en paralelo para máxima velocidad
    await Promise.all([
      cargarPedidos(),
      cargarPedidosActivos()
    ]);
    
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
  async function cargarPedidosActivos() {
    const destino = document.getElementById('listaPedidosActivos');
    if (!destino) return;

    try {
      const [resUser, resPedidos] = await Promise.all([
        window.apiRequest('/api/usuario-actual'),
        window.apiRequest('/api/domiciliarios/pedidos-domiciliario-con-distancias')
      ]);

      if (!resUser.ok || !resPedidos.ok) throw new Error('Error de API');

      const [usuario, pedidos] = await Promise.all([resUser.json(), resPedidos.json()]);

      // ✅ Actualizar cache para modal instantáneo
      _actualizarCache(pedidos, usuario.id);

      const activos = pedidos.filter(p =>
        p.estado?.toLowerCase() === 'camino a tu casa' && p.domiciliario_id === usuario.id
      );

      if (activos.length === 0) {
        destino.innerHTML = `
          <div class="no-pedidos">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width:48px;height:48px;margin:0 auto 16px;display:block;color:var(--text-muted)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"/></svg>
            <h3>Sin pedidos activos</h3>
            <p>Tus pedidos en camino aparecerán aquí</p>
          </div>`;
      } else {
        let html = '<div class="pedidos-grid">';
        activos.forEach(p => {
          html += generarHtmlPedido(p, true, [], activos.length, true);
        });
        html += '</div>';
        destino.innerHTML = html;
      }
    } catch (err) {
      console.error('Error cargando pedidos activos:', err);
      destino.innerHTML = `<div class="no-pedidos"><h3>Error al cargar</h3><p>Toca aquí para recargar</p></div>`;
    }
  }

  // Sobreescribir cargarPedidos para que también actualice activos
  const _cargarPedidosOriginal = cargarPedidos;
  window.cargarPedidosActivos = cargarPedidosActivos;

  // ========== EXPORTAR FUNCIONES GLOBALES ==========
  window.logout = logout;
  window.tomarPedido = tomarPedido;
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
  window.cargarPedidos = cargarPedidos;

})();