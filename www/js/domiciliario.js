// domiciliario.js - Versión Optimizada para Producción
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
          userEl.textContent = `👤 ${usuario.usuario || 'Usuario'}`;
        }
        return usuario;
      }
    } catch (error) {
      console.error('Error al cargar usuario:', error);
    }
    return null;
  }

  // ========== GESTIÓN DE PEDIDOS ==========
  async function cargarPedidos() {
    try {
      const res = await window.apiRequest('/api/pedidos-domiciliario-con-distancias');
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

      const asignacionesRes = await window.apiRequest('/api/mis-asignaciones-geograficas');
      let pedidosGeograficos = [];
      
      if (asignacionesRes.ok) {
        const asignaciones = await asignacionesRes.json();
        pedidosGeograficos = asignaciones.map(a => a.pedido_id);
      }

      const pedidosFiltrados = pedidos.filter(pedido => {
        if (pedido.estado?.toLowerCase() === 'camino a tu casa' && pedido.domiciliario_id === usuario.id) {
          return true;
        }
        if (pedido.estado?.toLowerCase() === 'esperando repartidor') {
          return pedidosGeograficos.includes(pedido.id);
        }
        return false;
      });

      const disponibles = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'esperando repartidor');
      const misActivos = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'camino a tu casa');
      
      actualizarContadorPedidos(misActivos.length);

      const pedidosAMostrar = misActivos.length >= 2 ? misActivos : [...misActivos, ...disponibles];

      renderizarPedidos(pedidosAMostrar, misActivos, pedidosGeograficos);

    } catch (err) {
      console.error('Error al cargar pedidos:', err);
      document.getElementById('listaPedidos').innerHTML = `
        <div class="error">
          <h3>⚠️ Error al cargar pedidos</h3>
          <p>No se pudieron cargar los pedidos. Por favor, recarga la página.</p>
          <button onclick="window.location.href='index.html'" class="btn-reload">Ir a Login</button>
        </div>
      `;
    }
  }

  function renderizarPedidos(pedidosAMostrar, misActivos, pedidosGeograficos) {
    const contenedor = document.getElementById('listaPedidos');
    
    if (!Array.isArray(pedidosAMostrar) || pedidosAMostrar.length === 0) {
      contenedor.innerHTML = misActivos.length >= 2 
        ? '<div class="no-pedidos"><h3>🚛 Tienes el máximo de pedidos (2/2)</h3><p>Completa una entrega para poder tomar nuevos pedidos.</p></div>'
        : '<div class="no-pedidos"><h3>🎯 No hay pedidos disponibles en tu área</h3><p>Actualmente no hay pedidos disponibles en tu radio de cobertura. ¡Mantente atento!</p></div>';
      return;
    }

    const pedidosOrdenados = pedidosAMostrar.sort((a, b) => {
      if (a.estado === 'camino a tu casa' && b.estado !== 'camino a tu casa') return -1;
      if (b.estado === 'camino a tu casa' && a.estado !== 'camino a tu casa') return 1;
      return new Date(a.fecha) - new Date(b.fecha);
    });

    let htmlContent = '';

    if (misActivos.length >= 2) {
      htmlContent += '<div class="alerta limite-alcanzado"><h3>🚛 Máximo de pedidos alcanzado (2/2)</h3><p>Completa una entrega para poder tomar nuevos pedidos.</p></div>';
    } else if (misActivos.length === 1) {
      htmlContent += '<div class="alerta advertencia-limite"><h3>⚠️ Puedes tomar 1 pedido más (1/2)</h3><p>Tienes espacio para un pedido adicional.</p></div>';
    }

    const misPedidosHtml = [];
    const pedidosDisponiblesHtml = [];

    pedidosOrdenados.forEach(p => {
      const esMiPedido = p.estado === 'camino a tu casa';
      const html = generarHtmlPedido(p, esMiPedido, pedidosGeograficos, misActivos.length);
      
      if (esMiPedido) {
        misPedidosHtml.push(html);
      } else {
        pedidosDisponiblesHtml.push(html);
      }
    });

    htmlContent += '<div class="pedidos-grid">';
    htmlContent += misPedidosHtml.join('');
    htmlContent += '</div>';

    if (misPedidosHtml.length > 0 && pedidosDisponiblesHtml.length > 0) {
      htmlContent += '<div class="separador-pedidos"><span>📋 Más Pedidos Disponibles en tu Área</span></div>';
    }

    if (pedidosDisponiblesHtml.length > 0) {
      htmlContent += '<div class="pedidos-grid">';
      htmlContent += pedidosDisponiblesHtml.join('');
      htmlContent += '</div>';
    }

    contenedor.innerHTML = htmlContent;
  }

  function generarHtmlPedido(p, esMiPedido, pedidosGeograficos, cantidadActivos) {
    const estadoClase = ESTADOS_CLASES[p.estado?.toLowerCase()] || 'pendiente';
    const subtotalProductos = Array.isArray(p.productos) 
      ? p.productos.reduce((sum, pr) => sum + (pr.precio * pr.cantidad), 0) 
      : 0;
    const costoDomicilio = obtenerCostoDomicilio(p);
    const total = subtotalProductos + costoDomicilio;
    const esGeografico = pedidosGeograficos.includes(p.id);
    const mostrarDistancia = !esMiPedido && p.distancia_al_restaurante !== null;

    const badges = [];
    if (esMiPedido) badges.push('<div class="badge-mi-pedido">🚛 Mi Pedido</div>');
    if (p.envio_manual_domiciliario) badges.push('<div class="badge-manual">📤 Envío Manual</div>');
    if (esGeografico && !esMiPedido) badges.push('<div class="badge-geografico">📍 Pedido Cercano</div>');

    const productosHtml = Array.isArray(p.productos) 
      ? p.productos.map(pr => `
          <div class="producto-item">
            <span>${pr.nombre}</span>
            <span>${pr.cantidad} × $${pr.precio.toLocaleString('es-CO')}</span>
          </div>
        `).join('')
      : '<p>No hay productos</p>';

    return `
      <div class="pedido-card ${esMiPedido ? 'mi-pedido color-mi-pedido' : 'color-disponible'}" data-pedido-id="${p.id}">
        ${badges.join('')}
        
        <div class="pedido-header">
          <div class="cliente-info">
            <h3>${p.nombre} ${p.apellido}</h3>
            <div class="telefono">📞 ${p.telefono}</div>
          </div>
          <div class="estado ${estadoClase}">${p.estado}</div>
        </div>

        ${mostrarDistancia ? `<div class="distancia-info"><strong>📍 Dist restaurante: ${p.distancia_al_restaurante.toFixed(3)}km</strong></div>` : ''}

        <div class="info-grid">
          <div class="info-section">
            <h4>🏬 Origen</h4>
            <p class="nombre-negocio">${p.restaurantes?.nombre || 'Restaurante'}</p>
            <p class="direccion-small">📍 ${p.restaurantes?.direccion || 'Sin dirección'}</p>
            <p class="telefono-small">📞 ${p.restaurantes?.telefono || 'Sin teléfono'}</p>
          </div>

          <div class="info-section">
            <h4>🏠 Destino</h4>
            <p class="direccion-cliente">${p.direccion}${p.complemento ? ' ' + p.complemento : ''}</p>
            <p class="barrio"><em>${p.barrio}</em></p>
          </div>
        </div>

        <div class="total-section">
          <div class="total-amount">$${total.toLocaleString('es-CO')}</div>
          <small>(Incluye domicilio: $${costoDomicilio.toLocaleString('es-CO')})</small>
          ${p.tipo_tarifa === 'por_km' && p.distancia_km ? `<small class="km-info">(${p.distancia_km} km)</small>` : ''}
        </div>

        <div class="botones-pedido">
          <button class="btn-ver-detalles" onclick="abrirDetallesPedido(${p.id})">👁️ Detalles</button>
          ${generarBotonesAccion(p, esMiPedido, cantidadActivos)}
        </div>

        <div class="pedido-footer">
          <small>📅 ${new Date(p.fecha).toLocaleDateString('es-CO')} - ${new Date(p.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</small>
        </div>
      </div>
    `;
  }

  function generarBotonesAccion(pedido, esMiPedido, cantidadActivos) {
    if (pedido.estado === 'esperando repartidor') {
      const deshabilitado = cantidadActivos >= 2;
      return `<button class="btn-tomar" onclick="tomarPedido(${pedido.id})" ${deshabilitado ? 'disabled' : ''}>${deshabilitado ? '🚫 Límite' : '📦 Tomar'}</button>`;
    }
    
    if (esMiPedido) {
      return `
        <button class="btn-liberar" onclick="abrirModalLiberar(${pedido.id})">🔄 Liberar</button>
        <button class="btn-entregado" onclick="abrirModalPago(${pedido.id})">✅ Entregado</button>
        <button class="btn-problema" onclick="abrirModalProblema(${pedido.id})">❌ Problema</button>
      `;
    }
    
    return '';
  }

  async function mostrarPedidoGeografico(data) {
    try {
      const pedido = data.pedido;
      const distanciaReportada = data.distancia;
      const esConexionInicial = data.conexion_inicial || false;
      
      const contenedor = document.getElementById('listaPedidos');
      if (!contenedor) return;
      
      let grid = contenedor.querySelector('.pedidos-grid');
      
      if (contenedor.querySelector('.no-pedidos')) {
        contenedor.innerHTML = '<div class="pedidos-grid"></div>';
        grid = contenedor.querySelector('.pedidos-grid');
      }
      
      if (!grid) {
        contenedor.innerHTML = '<div class="pedidos-grid"></div>';
        grid = contenedor.querySelector('.pedidos-grid');
      }

      if (grid.querySelector(`[data-pedido-id="${pedido.id}"]`)) {
        console.log(`Pedido ${pedido.id} ya existe`);
        return;
      }

      const subtotalProductos = Array.isArray(pedido.productos) 
        ? pedido.productos.reduce((sum, pr) => sum + (pr.precio * pr.cantidad), 0) 
        : 0;
      const costoDomicilio = obtenerCostoDomicilio(pedido);
      const total = subtotalProductos + costoDomicilio;

      const badgeClass = esConexionInicial ? 'badge-conexion' : 'badge-nuevo';
      const badgeTexto = esConexionInicial ? '🔔 Pedido Encontrado' : '📍 Nuevo Pedido Cercano';

      const pedidoHtml = `
        <div class="pedido-card color-disponible nuevo-geografico ${esConexionInicial ? 'conexion-inicial' : ''}" data-pedido-id="${pedido.id}">
          <div class="${badgeClass}">${badgeTexto}</div>
          
          <div class="pedido-header">
            <div class="cliente-info">
              <h3>${pedido.nombre} ${pedido.apellido}</h3>
              <div class="telefono">📞 ${pedido.telefono}</div>
            </div>
            <div class="estado esperando-repartidor">esperando repartidor</div>
          </div>

          <div class="distancia-info"><strong>📍 Dist restaurante: ${distanciaReportada.toFixed(3)}km</strong></div>

          <div class="info-grid">
            <div class="info-section">
              <h4>🏬 Origen</h4>
              <p class="nombre-negocio">${pedido.restaurantes?.nombre || 'Restaurante'}</p>
              <p class="direccion-small">📍 ${pedido.restaurantes?.direccion || 'Sin dirección'}</p>
            </div>
            <div class="info-section">
              <h4>🏠 Destino</h4>
              <p class="direccion-cliente">${pedido.direccion}${pedido.complemento ? ' ' + pedido.complemento : ''}</p>
              <p class="barrio"><em>${pedido.barrio}</em></p>
            </div>
          </div>

          <div class="total-section">
            <div class="total-amount">$${total.toLocaleString('es-CO')}</div>
            <small>(Incluye domicilio: $${costoDomicilio.toLocaleString('es-CO')})</small>
          </div>

          <div class="botones-pedido">
            <button class="btn-ver-detalles" onclick="abrirDetallesPedido(${pedido.id})">👁️ Detalles</button>
            <button class="btn-tomar btn-destacado" onclick="tomarPedido(${pedido.id})">📦 Tomar</button>
          </div>

          <div class="pedido-footer">
            <small>📅 ${new Date(pedido.fecha).toLocaleDateString('es-CO')} - ${new Date(pedido.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
        </div>
      `;

      grid.insertAdjacentHTML('afterbegin', pedidoHtml);
      
      const nuevaTarjeta = grid.querySelector(`[data-pedido-id="${pedido.id}"]`);
      if (nuevaTarjeta) {
        nuevaTarjeta.style.opacity = '0';
        nuevaTarjeta.style.transform = 'scale(0.9)';
        
        setTimeout(() => {
          nuevaTarjeta.style.transition = 'all 0.3s ease';
          nuevaTarjeta.style.opacity = '1';
          nuevaTarjeta.style.transform = 'scale(1)';
        }, 100);
      }
      
    } catch (error) {
      console.error('Error al mostrar pedido geográfico:', error);
    }
  }

  function removerPedidoFueraRadio(data) {
    const pedidoCard = document.querySelector(`[data-pedido-id="${data.pedidoId}"]`);
    if (pedidoCard) {
      pedidoCard.style.transition = 'all 0.5s ease';
      pedidoCard.style.opacity = '0';
      pedidoCard.style.transform = 'scale(0.8)';
      
      setTimeout(() => {
        pedidoCard.remove();
        
        const contenedor = document.getElementById('listaPedidos');
        const pedidosRestantes = contenedor.querySelectorAll('[data-pedido-id]');
        
        if (pedidosRestantes.length === 0) {
          contenedor.innerHTML = '<div class="no-pedidos"><h3>📍 Te has alejado del área de cobertura</h3><p>No hay pedidos disponibles en tu ubicación actual.</p></div>';
        }
      }, 500);
      
      mostrarMensaje(`📍 Te alejaste del área del pedido #${data.pedidoId}`, 'error');
    }
  }

  // ========== ACCIONES DE PEDIDOS ==========
  async function tomarPedido(pedidoId) {
    if (pedidosActivosGlobal >= 2) {
      mostrarMensaje('❌ No puedes tomar más pedidos. Máximo 2 pedidos activos permitidos.', 'error');
      return;
    }
  
    if (!confirm('¿Quieres tomar este pedido?')) return;
  
    const tarjeta = document.querySelector(`[data-pedido-id="${pedidoId}"]`);
    if (tarjeta) {
      tarjeta.style.opacity = '0.5';
      tarjeta.style.pointerEvents = 'none';
    }

    try {
      const res = await window.apiRequest(`/api/pedidos/${pedidoId}/tomar`, { method: 'POST' });
      const result = await res.json();

      if (res.ok) {
        mostrarMensaje(`✅ Pedido asignado (${result.pedidosActivos || 1}/2 activos)`);
        
        if (tarjeta) {
          actualizarTarjetaPedidoTomado(tarjeta, pedidoId);
          actualizarContadorPedidos(result.pedidosActivos || 1);
        }
        
        setTimeout(() => cargarPedidos(), 2000);
      } else {
        if (tarjeta) {
          tarjeta.style.opacity = '1';
          tarjeta.style.pointerEvents = 'auto';
        }
        mostrarMensaje(`❌ ${result.error || 'No se pudo tomar el pedido'}`, 'error');
      }
    } catch (error) {
      console.error('Error al tomar pedido:', error);
      if (tarjeta) {
        tarjeta.style.opacity = '1';
        tarjeta.style.pointerEvents = 'auto';
      }
      mostrarMensaje('❌ Error de conexión', 'error');
    }
  }

  function actualizarTarjetaPedidoTomado(tarjeta, pedidoId) {
    tarjeta.classList.add('mi-pedido', 'color-mi-pedido');
    tarjeta.classList.remove('color-disponible', 'nuevo-geografico', 'conexion-inicial');
    
    const badges = tarjeta.querySelectorAll('.badge-geografico, .badge-nuevo, .badge-conexion');
    badges.forEach(b => b.remove());
    
    if (!tarjeta.querySelector('.badge-mi-pedido')) {
      tarjeta.insertAdjacentHTML('afterbegin', '<div class="badge-mi-pedido">🚛 Mi Pedido</div>');
    }
    
    const botonesContainer = tarjeta.querySelector('.botones-pedido');
    if (botonesContainer) {
      botonesContainer.innerHTML = `
        <button class="btn-liberar" onclick="abrirModalLiberar(${pedidoId})">🔄 Liberar</button>
        <button class="btn-entregado" onclick="abrirModalPago(${pedidoId})">✅ Entregado</button>
        <button class="btn-problema" onclick="abrirModalProblema(${pedidoId})">❌ Problema</button>
      `;
    }
    
    const estadoElement = tarjeta.querySelector('.estado');
    if (estadoElement) {
      estadoElement.textContent = 'camino a tu casa';
      estadoElement.className = 'estado camino';
    }
    
    const distanciaInfo = tarjeta.querySelector('.distancia-info');
    if (distanciaInfo) distanciaInfo.remove();
    
    tarjeta.style.opacity = '1';
    tarjeta.style.pointerEvents = 'auto';
    
    const grid = tarjeta.parentElement;
    if (grid) grid.insertBefore(tarjeta, grid.firstChild);
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
        cerrarModalPago();
        setTimeout(() => location.reload(), 1500);
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

    if (!motivo) {
      mostrarMensaje('⚠️ Debes seleccionar un motivo para el problema', 'error');
      return;
    }

    if (motivo === 'otro' && !detalleMotivo.trim()) {
      mostrarMensaje('⚠️ Debes explicar el motivo cuando seleccionas "Otro"', 'error');
      return;
    }

    if (!llamoRestaurante) {
      mostrarMensaje('⚠️ Debes indicar si llamaste al restaurante', 'error');
      return;
    }

    if (!accion) {
      mostrarMensaje('⚠️ Debes indicar qué hiciste con el pedido', 'error');
      return;
    }

    if (accion === 'no lo devolví' && !explicacionNoDevolvi.trim()) {
      mostrarMensaje('⚠️ Debes explicar por qué no devolviste el pedido', 'error');
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
        cerrarModalProblema();
        setTimeout(() => cargarPedidos(), 1000);
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
        setTimeout(() => cargarPedidos(), 1000);
      } else {
        mostrarMensaje(`❌ ${result.error || 'Error al liberar pedido'}`, 'error');
      }
    } catch (error) {
      console.error('Error al liberar pedido:', error);
      mostrarMensaje('❌ Error de conexión', 'error');
    }
  }

  async function abrirDetallesPedido(pedidoId) {
    try {
      const response = await window.apiRequest('/api/pedidos-domiciliario');
      const pedidos = await response.json();
      const pedido = pedidos.find(p => p.id === pedidoId);
      
      if (!pedido) {
        mostrarMensaje('No se pudo encontrar el pedido', 'error');
        return;
      }

      const productosHtml = Array.isArray(pedido.productos) 
        ? pedido.productos.map(pr => {
            const subtotal = pr.precio * pr.cantidad;
            return `
              <div class="producto-detalle-item">
                <div class="producto-nombre-detalle">${pr.nombre}</div>
                <div class="producto-detalles">
                  Cantidad: ${pr.cantidad} × ${pr.precio.toLocaleString('es-CO')} = ${subtotal.toLocaleString('es-CO')}
                </div>
              </div>
            `;
          }).join('') 
        : '<p>No hay productos disponibles</p>';

      const subtotalProductos = Array.isArray(pedido.productos) 
        ? pedido.productos.reduce((sum, pr) => sum + (pr.precio * pr.cantidad), 0) 
        : 0;
      const costoDomicilio = obtenerCostoDomicilio(pedido);
      const total = subtotalProductos + costoDomicilio;

      const modalHTML = `
        <div class="modal-detalles-contenido">
          <h2>📋 Detalles del Pedido #${pedido.id}</h2>
          
          <div class="detalle-section">
            <h4>👤 Información del Cliente</h4>
            <p><strong>Nombre:</strong> ${pedido.nombre} ${pedido.apellido}</p>
            <p><strong>Teléfono:</strong> ${pedido.telefono}</p>
            <p><strong>Estado:</strong> ${pedido.estado}</p>
          </div>

          <div class="detalle-section">
            <h4>📍 Dirección Completa de Entrega</h4>
            <p><strong>${pedido.direccion}</strong></p>
            ${pedido.complemento ? `<p><strong>Complemento:</strong> ${pedido.complemento}</p>` : ''}
            <p><strong>Barrio:</strong> ${pedido.barrio}</p>
          </div>

          <div class="detalle-section">
            <h4>🏬 Información del Negocio</h4>
            <p><strong>Nombre:</strong> ${pedido.restaurantes?.nombre || 'Desconocido'}</p>
            <p><strong>Dirección:</strong> ${pedido.restaurantes?.direccion || 'No disponible'}</p>
            <p><strong>Teléfono:</strong> ${pedido.restaurantes?.telefono || 'No disponible'}</p>
          </div>

          <div class="detalle-section">
            <h4>🛒 Productos del Pedido</h4>
            <div class="productos-detalle">
              ${productosHtml}
            </div>
          </div>

          <div class="detalle-section">
            <h4>💰 Resumen de Pago</h4>
            <p><strong>Subtotal productos:</strong> ${subtotalProductos.toLocaleString('es-CO')}</p>
            <p><strong>Domicilio:</strong> ${costoDomicilio.toLocaleString('es-CO')}</p>
            ${pedido.tipo_tarifa === 'por_km' && pedido.distancia_km ? 
              `<p class="info-km"><em>(Tarifa por km: ${pedido.distancia_km} km recorridos)</em></p>` : ''}
            <p class="total-destacado"><strong>Total a cobrar: ${total.toLocaleString('es-CO')}</strong></p>
          </div>

          <div class="detalle-section">
            <h4>📅 Información del Pedido</h4>
            <p><strong>Fecha:</strong> ${new Date(pedido.fecha).toLocaleString('es-CO', {
              timeZone: 'America/Bogota',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })}</p>
            <p><strong>ID del pedido:</strong> #${pedido.id}</p>
          </div>

          <button class="btn-cerrar-modal" onclick="cerrarDetallesPedido()">❌ Cerrar Detalles</button>
        </div>
      `;

      const modal = document.createElement('div');
      modal.id = 'modalDetalles';
      modal.className = 'modal-overlay';
      modal.innerHTML = modalHTML;
      
      document.body.appendChild(modal);

      modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarDetallesPedido();
      });

    } catch (err) {
      console.error('Error al cargar detalles:', err);
      mostrarMensaje('Error al cargar los detalles del pedido', 'error');
    }
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
      setTimeout(() => cargarPedidos(), 2000);
    });
    
    socketInstance.on('nuevo-pedido-geografico', async (data) => {
      console.log('Nuevo pedido geográfico:', data.pedido?.id);
      

      
      const contenedor = document.getElementById('listaPedidos');
      if (!contenedor) return;
      
      const pedidoExistente = contenedor.querySelector(`[data-pedido-id="${data.pedido.id}"]`);
      if (pedidoExistente) return;
      
      try {
        if (typeof window.mostrarPedidoGeografico === 'function') {
          await window.mostrarPedidoGeografico(data);
        } else {
          setTimeout(() => cargarPedidos(), 1000);
        }
      } catch (error) {
        console.error('Error al mostrar pedido:', error);
        setTimeout(() => cargarPedidos(), 1000);
      }
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

    socketInstance.on('pedido-fuera-radio', (data) => {
      if (typeof window.removerPedidoFueraRadio === 'function') {
        window.removerPedidoFueraRadio(data);
      }
    });

    socketInstance.on('pedido-liberado', () => {
      setTimeout(() => cargarPedidos(), 1000);
    });
  }

  // ========== INICIALIZACIÓN ==========
  async function inicializar() {
    const usuario = await cargarUsuario();
    if (!usuario) return;
    
    await cargarPedidos();
    
    console.log('✅ Sistema FCM disponible desde fcm-notifications.js');

    
    configurarSocket(usuario);
    
    // Inicializar sistema de notificaciones
    try {
      const notiDomi = new NotificationSystem(true);
      notiDomi.requestPermission();
      
      const originalMostrar = notiDomi.mostrarNotificacion;
      notiDomi.mostrarNotificacion = function(data) {
        originalMostrar.call(this, data);
        setTimeout(() => cargarPedidos(), 1000);
      };
    } catch (error) {
      console.warn('No se pudo inicializar NotificationSystem:', error);
    }
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
  window.mostrarPedidoGeografico = mostrarPedidoGeografico;
  window.removerPedidoFueraRadio = removerPedidoFueraRadio;
  window.cargarPedidos = cargarPedidos;

})();