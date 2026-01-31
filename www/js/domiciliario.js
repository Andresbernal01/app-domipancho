// domiciliario.js - Versión Optimizada para Producción (CORREGIDA)
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

  // ✅ NUEVA FUNCIÓN: Calcular totales con información de cupón
  function calcularTotalesPedido(pedido) {
    const productosArray = Array.isArray(pedido.productos) ? pedido.productos : [];
    const subtotalProductos = productosArray.reduce((sum, pr) => sum + (pr.precio * pr.cantidad), 0);
    const costoDomicilio = obtenerCostoDomicilio(pedido);
    
    // Si el pedido tiene información de cupón en la base de datos
    if (pedido.descuento_cupon && pedido.total_con_descuento) {
      return {
        subtotalProductos,
        costoDomicilio,
        descuentoCupon: pedido.descuento_cupon,
        totalSinDescuento: pedido.total_sin_descuento || (subtotalProductos + costoDomicilio),
        totalConDescuento: pedido.total_con_descuento,
        tieneCupon: true
      };
    }
    
    // Si no hay cupón
    const total = subtotalProductos + costoDomicilio;
    return {
      subtotalProductos,
      costoDomicilio,
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
      // ✅ 1. VERIFICAR ESTADO DE DISPONIBILIDAD
      let disponible = true;
      try {
        const dispResponse = await window.apiRequest('/api/domiciliario/estado-disponibilidad');
        if (dispResponse.ok) {
          const dispData = await dispResponse.json();
          disponible = dispData.disponible !== false;
        }
      } catch (error) {
        console.warn('Error verificando disponibilidad:', error);
      }
  
      // ✅ 2. OBTENER PEDIDOS SEGÚN DISPONIBILIDAD
      let pedidos;
      let pedidosGeograficos = [];
  
      if (disponible) {
        // 🟢 DISPONIBLE: Obtener pedidos con distancias (solo en radio)
        const res = await window.apiRequest('/api/pedidos-domiciliario-con-distancias');
        pedidos = await res.json();
        
        if (!res.ok && pedidos?.error === 'bloqueado') {
          document.getElementById('listaPedidos').innerHTML = `
            <div class="bloqueado">
              <h3>⛔ Cuenta Bloqueada</h3>
              <p>${pedidos.mensaje}</p>
            </div>
          `;
          return;
        }
  
        // Obtener asignaciones geográficas
        const asignacionesRes = await window.apiRequest('/api/mis-asignaciones-geograficas');
        if (asignacionesRes.ok) {
          const asignaciones = await asignacionesRes.json();
          pedidosGeograficos = asignaciones.map(a => a.pedido_id);
        }
  
      } else {
        // 🔴 NO DISPONIBLE: Obtener TODOS los pedidos de la ciudad
        const res = await window.apiRequest('/api/pedidos-domiciliario');
        pedidos = await res.json();
        
        if (!res.ok && pedidos?.error === 'bloqueado') {
          document.getElementById('listaPedidos').innerHTML = `
            <div class="bloqueado">
              <h3>⛔ Cuenta Bloqueada</h3>
              <p>${pedidos.mensaje}</p>
            </div>
          `;
          return;
        }
      }
  
      const usuario = await cargarUsuario();
      if (!usuario) return;
  
      // ✅ 3. FILTRAR PEDIDOS SEGÚN DISPONIBILIDAD
      let pedidosFiltrados;
  
      if (disponible) {
        // 🟢 DISPONIBLE: Solo pedidos en radio o asignados a mí
        pedidosFiltrados = pedidos.filter(pedido => {
          if (pedido.estado?.toLowerCase() === 'camino a tu casa' && pedido.domiciliario_id === usuario.id) {
            return true;
          }
          if (pedido.estado?.toLowerCase() === 'esperando repartidor') {
            return pedidosGeograficos.includes(pedido.id);
          }
          return false;
        });
      } else {
        // 🔴 NO DISPONIBLE: Todos los "esperando repartidor" + mis activos
        pedidosFiltrados = pedidos.filter(pedido => {
          if (pedido.estado?.toLowerCase() === 'camino a tu casa' && pedido.domiciliario_id === usuario.id) {
            return true;
          }
          return pedido.estado?.toLowerCase() === 'esperando repartidor';
        });
      }
  
      const disponibles = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'esperando repartidor');
      const misActivos = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'camino a tu casa');
      
      actualizarContadorPedidos(misActivos.length);
  
      const pedidosAMostrar = misActivos.length >= 2 ? misActivos : [...misActivos, ...disponibles];
  
      renderizarPedidos(pedidosAMostrar, misActivos, pedidosGeograficos, disponible);
  
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

  function renderizarPedidos(pedidosAMostrar, misActivos, pedidosGeograficos, disponible) {
    // ✅ CORRECCIÓN: Usar 'listaPedidos' en lugar de 'pedidosContainer'
    const contenedor = document.getElementById('listaPedidos');
    
    if (!contenedor) {
      console.error('❌ Elemento listaPedidos no encontrado');
      return;
    }
    
    if (!Array.isArray(pedidosAMostrar) || pedidosAMostrar.length === 0) {
      if (disponible) {
        contenedor.innerHTML = misActivos.length >= 2 
          ? '<div class="no-pedidos"><h3>🚛 Tienes el máximo de pedidos (2/2)</h3><p>Completa una entrega para poder tomar nuevos pedidos.</p></div>'
          : '<div class="no-pedidos"><h3>🎯 No hay pedidos disponibles en tu área</h3><p>Actualmente no hay pedidos disponibles en tu radio de cobertura. ¡Mantente atento!</p></div>';
      } else {
        contenedor.innerHTML = '<div class="no-pedidos"><h3>🔴 No Disponible</h3><p>No hay pedidos esperando repartidor en tu ciudad actualmente.</p><p><strong>Activa "Disponible"</strong> para empezar a recibir pedidos cercanos.</p></div>';
      }
      return;
    }
  
    let htmlContent = '';
  
    // ✅ BANNER DIFERENTE SEGÚN DISPONIBILIDAD
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
  
    // Separar y ordenar pedidos
    const pedidosOrdenados = pedidosAMostrar.sort((a, b) => {
      const aEsMio = a.estado?.toLowerCase() === 'camino a tu casa';
      const bEsMio = b.estado?.toLowerCase() === 'camino a tu casa';
      
      if (aEsMio && !bEsMio) return -1;
      if (!aEsMio && bEsMio) return 1;
      
      return new Date(a.fecha) - new Date(b.fecha);
    });
  
    const misPedidosHtml = [];
    const pedidosDisponiblesHtml = [];
  
    pedidosOrdenados.forEach(p => {
      const esMiPedido = p.estado?.toLowerCase() === 'camino a tu casa';
      const html = generarHtmlPedido(p, esMiPedido, pedidosGeograficos, misActivos.length, disponible);
      
      if (esMiPedido) {
        misPedidosHtml.push(html);
      } else {
        pedidosDisponiblesHtml.push(html);
      }
    });
  
    // Mostrar mis pedidos primero
    if (misPedidosHtml.length > 0) {
      htmlContent += '<div class="pedidos-grid">';
      htmlContent += misPedidosHtml.join('');
      htmlContent += '</div>';
    }
  
    // Separador si hay ambos tipos
    if (misPedidosHtml.length > 0 && pedidosDisponiblesHtml.length > 0) {
      const tituloSeccion = disponible ? 
        '📋 Más Pedidos Disponibles en tu Área' : 
        '📋 Pedidos Esperando Repartidor en tu Ciudad';
      htmlContent += `<div class="separador-pedidos"><span>${tituloSeccion}</span></div>`;
    }
  
    // Mostrar pedidos disponibles
    if (pedidosDisponiblesHtml.length > 0) {
      htmlContent += '<div class="pedidos-grid">';
      htmlContent += pedidosDisponiblesHtml.join('');
      htmlContent += '</div>';
    }
  
    contenedor.innerHTML = htmlContent;
  }

  // ========== UTILIDADES DE PROTECCIÓN DE DATOS ==========
function ocultarTelefono(telefono) {
  if (!telefono) return 'N/A';
  const tel = telefono.toString();
  if (tel.length < 7) return tel;
  // Muestra los primeros 3 dígitos: 310*********
  return tel.substring(0, 3) + '*'.repeat(9);
}

function ocultarDireccion(direccion) {
  // Solo muestra un mensaje genérico
  return 'Toma el pedido para ver';
}

function generarHtmlPedido(p, esMiPedido, pedidosGeograficos, cantidadActivos, disponible) {
  const estadoClase = ESTADOS_CLASES[p.estado?.toLowerCase()] || 'pendiente';
  const totales = calcularTotalesPedido(p);
  const esGeografico = pedidosGeograficos.includes(p.id);
  const mostrarDistancia = !esMiPedido && p.distancia_al_restaurante !== null && disponible;

  // ✅ PROTECCIÓN: Ocultar datos si no es mi pedido
  const telefonoMostrar = esMiPedido ? p.telefono : ocultarTelefono(p.telefono);
  const direccionMostrar = esMiPedido ? p.direccion : ocultarDireccion(p.direccion);
  const complementoMostrar = esMiPedido ? (p.complemento ? ' ' + p.complemento : '') : '';

  const badges = [];
  if (esMiPedido) badges.push('<div class="badge-mi-pedido">🚛 Mi Pedido</div>');
  if (p.envio_manual_domiciliario) badges.push('<div class="badge-manual">📤 Envío Manual</div>');
  if (esGeografico && !esMiPedido && disponible) badges.push('<div class="badge-geografico">📍 Pedido Cercano</div>');

  return `
    <div class="pedido-card ${esMiPedido ? 'mi-pedido color-mi-pedido' : 'color-disponible'} ${!disponible && !esMiPedido ? 'pedido-preview' : ''}" data-pedido-id="${p.id}">
      ${badges.join('')}
      
      <div class="pedido-header">
        <div class="cliente-info">
          <h3>${p.nombre} ${p.apellido}</h3>
          <div class="telefono">📞 ${telefonoMostrar}</div>
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
          <p class="direccion-cliente">${direccionMostrar}${complementoMostrar}</p>
          <p class="barrio"><em>${p.barrio}</em></p>
        </div>
      </div>

      <div class="total-section">
      ${totales.tieneCupon ? `
        <div class="total-original" style="text-decoration: line-through; color: #9ca3af; font-size: 0.9em;">
          $${totales.totalSinDescuento.toLocaleString('es-CO')}
        </div>
        <div class="descuento-badge" style="background: #dcfce7; color: #16a34a; padding: 4px 8px; border-radius: 4px; font-size: 0.85em; margin: 4px 0;">
          🎟️ -$${totales.descuentoCupon.toLocaleString('es-CO')}
        </div>
      ` : ''}
      <div class="total-amount" style="${totales.tieneCupon ? 'color: #16a34a;' : ''}">
        $${totales.totalConDescuento.toLocaleString('es-CO')}
      </div>
      <small>(Incluye domicilio: $${totales.costoDomicilio.toLocaleString('es-CO')})</small>
      ${p.tipo_tarifa === 'por_km' && p.distancia_km ? `<small class="km-info">(${p.distancia_km} km)</small>` : ''}
    </div>

      <div class="botones-pedido">
        <button class="btn-ver-detalles" onclick="abrirDetallesPedido(${p.id}, ${esMiPedido})">👁️ Detalles</button>
        ${generarBotonesAccion(p, esMiPedido, cantidadActivos, disponible)}
      </div>

      <div class="pedido-footer">
        <small>📅 ${new Date(p.fecha).toLocaleDateString('es-CO')} - ${new Date(p.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</small>
      </div>
    </div>
  `;
}
  function generarBotonesAccion(pedido, esMiPedido, cantidadActivos, disponible) {
    if (pedido.estado === 'esperando repartidor') {
      if (!disponible) {
        // 🔴 NO DISPONIBLE: Botón bloqueado
        return `
          <button class="btn-tomar btn-no-disponible" disabled title="Activa 'Disponible' para tomar pedidos">
            🔴 Activate
          </button>
        `;
      } else {
        // 🟢 DISPONIBLE: Botón normal
        const deshabilitado = cantidadActivos >= 2;
        return `<button class="btn-tomar" onclick="tomarPedido(${pedido.id})" ${deshabilitado ? 'disabled' : ''}>${deshabilitado ? '🚫 Límite' : '📦 Tomar'}</button>`;
      }
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
      if (!contenedor) {
        console.error('❌ Elemento listaPedidos no encontrado');
        return;
      }
  
      if (contenedor.querySelector(`[data-pedido-id="${pedido.id}"]`)) {
        console.log(`Pedido ${pedido.id} ya existe`);
        return;
      }
  
      let grids = contenedor.querySelectorAll('.pedidos-grid');
      let gridDisponibles = grids.length > 1 ? grids[1] : grids[0];
      
      if (contenedor.querySelector('.no-pedidos')) {
        contenedor.innerHTML = '<div class="pedidos-grid"></div>';
        gridDisponibles = contenedor.querySelector('.pedidos-grid');
      }
      
      if (!gridDisponibles) {
        const alertas = contenedor.querySelectorAll('.alerta');
        let htmlInicio = '';
        alertas.forEach(alerta => {
          htmlInicio += alerta.outerHTML;
        });
        contenedor.innerHTML = htmlInicio + '<div class="pedidos-grid"></div>';
        gridDisponibles = contenedor.querySelector('.pedidos-grid');
      }
  
// ✅ USAR LA FUNCIÓN PARA CALCULAR TOTALES CON CUPÓN
const totales = calcularTotalesPedido(pedido);
  
      // ✅ PROTECCIÓN: Ocultar datos en pedidos geográficos
      const telefonoOculto = ocultarTelefono(pedido.telefono);
      const direccionOculta = ocultarDireccion(pedido.direccion);
  
      const badgeClass = esConexionInicial ? 'badge-conexion' : 'badge-nuevo';
      const badgeTexto = esConexionInicial ? '🔔 Pedido Encontrado' : '📍 Nuevo Pedido Cercano';
  
      const pedidoHtml = `
        <div class="pedido-card color-disponible nuevo-geografico ${esConexionInicial ? 'conexion-inicial' : ''}" data-pedido-id="${pedido.id}">
          <div class="${badgeClass}">${badgeTexto}</div>
          
          <div class="pedido-header">
            <div class="cliente-info">
              <h3>${pedido.nombre} ${pedido.apellido}</h3>
              <div class="telefono">📞 ${telefonoOculto}</div>
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
              <p class="direccion-cliente">${direccionOculta}</p>
              <p class="barrio"><em>${pedido.barrio}</em></p>
            </div>
          </div>
  
          <div class="total-section">
            <div class="total-amount">$${totales.totalConDescuento.toLocaleString('es-CO')}</div>
            <small>(Incluye domicilio: $${totales.costoDomicilio.toLocaleString('es-CO')})</small>
          </div>
  
          <div class="botones-pedido">
            <button class="btn-ver-detalles" onclick="abrirDetallesPedido(${pedido.id}, false)">👁️ Detalles</button>
            <button class="btn-tomar btn-destacado" onclick="tomarPedido(${pedido.id})">📦 Tomar</button>
          </div>
  
          <div class="pedido-footer">
            <small>📅 ${new Date(pedido.fecha).toLocaleDateString('es-CO')} - ${new Date(pedido.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</small>
          </div>
        </div>
      `;
  
      gridDisponibles.insertAdjacentHTML('beforeend', pedidoHtml);
      
      const nuevaTarjeta = gridDisponibles.querySelector(`[data-pedido-id="${pedido.id}"]`);
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
        
        // ✅ CORRECCIÓN: Usar 'listaPedidos'
        const contenedor = document.getElementById('listaPedidos');
        if (!contenedor) return;
        
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
    // ✅ VERIFICAR DISPONIBILIDAD PRIMERO
    try {
      const dispResponse = await window.apiRequest('/api/domiciliario/estado-disponibilidad');
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
      mostrarMensaje('❌ No puedes tomar más pedidos. Máximo 2 pedidos activos permitidos.', 'error');
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
        // ✅ MARCAR PEDIDO COMO ACTIVO
        localStorage.setItem('domiciliario_pedido_activo', 'true');
        localStorage.setItem('domiciliario_pedido_id', pedidoId);
        
        // ✅ INICIAR SERVICIO DE TRACKING
        if (window.unifiedGeoService) {
          await window.unifiedGeoService.startTracking();
        }
        
        mostrarMensaje(`✅ Pedido asignado (${result.pedidosActivos || 1}/2 activos)`);
        actualizarContadorPedidos(result.pedidosActivos || 1);
        await cargarPedidos();
      } else {
        if (btnTomar) {
          btnTomar.disabled = false;
          btnTomar.textContent = '📦 Tomar';
        }
        mostrarMensaje(`❌ ${result.error || 'No se pudo tomar el pedido'}`, 'error');
      }
    } catch (error) {
      console.error('Error al tomar pedido:', error);
      if (btnTomar) {
        btnTomar.disabled = false;
        btnTomar.textContent = '📦 Tomar';
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

// ✅ USAR API REQUEST EN LUGAR DE SUPABASE
const pedidosActivosResponse = await window.apiRequest(
  `/api/pedidos-activos-domiciliario/${usuarioData.id}`
);
const pedidosActivosData = await pedidosActivosResponse.json();
const pedidosActivos = pedidosActivosData.pedidos || [];
        
        if (!pedidosActivos || pedidosActivos.length === 0) {
          // ✅ NO HAY MÁS PEDIDOS - DETENER TRACKING
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
        }
        
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

  async function abrirDetallesPedido(pedidoId, esMiPedido = false) {
    try {
      const response = await window.apiRequest('/api/pedidos-domiciliario-con-distancias');
      const pedidos = await response.json();
      const pedido = pedidos.find(p => p.id === pedidoId);
      
      if (!pedido) {
        mostrarMensaje('No se pudo encontrar el pedido', 'error');
        return;
      }
  
      // ✅ VERIFICAR si es mi pedido activo
      const usuario = await cargarUsuario();
      const esPedidoActivo = pedido.domiciliario_id === usuario?.id && pedido.estado?.toLowerCase() === 'camino a tu casa';
  
      // ✅ PROTECCIÓN: Ocultar datos si no es mi pedido
      const telefonoMostrar = esPedidoActivo ? pedido.telefono : ocultarTelefono(pedido.telefono);
      const direccionMostrar = esPedidoActivo ? pedido.direccion : 'Toma el pedido para ver la dirección completa';
      const complementoMostrar = esPedidoActivo && pedido.complemento ? `<p><strong>Complemento:</strong> ${pedido.complemento}</p>` : '';
      const mensajeProteccion = !esPedidoActivo ? '<div class="alerta-proteccion">🔒 Toma el pedido para ver los datos completos del cliente</div>' : '';
  
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
  
// ✅ USAR LA FUNCIÓN PARA CALCULAR TOTALES CON CUPÓN
const totales = calcularTotalesPedido(pedido);
  
      const modalHTML = `
        <div class="modal-detalles-contenido">
          <h2>📋 Detalles del Pedido #${pedido.id}</h2>
          
          ${mensajeProteccion}
          
          <div class="detalle-section">
            <h4>👤 Información del Cliente</h4>
            <p><strong>Nombre:</strong> ${pedido.nombre} ${pedido.apellido}</p>
            <p><strong>Teléfono:</strong> ${telefonoMostrar}</p>
            <p><strong>Estado:</strong> ${pedido.estado}</p>
          </div>
  
          <div class="detalle-section">
            <h4>📍 Dirección de Entrega</h4>
            <p><strong>${direccionMostrar}</strong></p>
            ${complementoMostrar}
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
          <p><strong>Subtotal productos:</strong> $${totales.subtotalProductos.toLocaleString('es-CO')}</p>
          <p><strong>Domicilio:</strong> $${totales.costoDomicilio.toLocaleString('es-CO')}</p>
          ${pedido.tipo_tarifa === 'por_km' && pedido.distancia_km ? 
            `<p class="info-km"><em>(Tarifa por km: ${pedido.distancia_km} km recorridos)</em></p>` : ''}
          ${totales.tieneCupon ? `
            <p style="color: #6b7280; margin-top: 8px;"><strong>Subtotal:</strong> <span style="text-decoration: line-through;">$${totales.totalSinDescuento.toLocaleString('es-CO')}</span></p>
            <p style="color: #10b981; font-size: 1.05em; margin: 8px 0;"><strong>🎟️ Descuento cupón:</strong> -$${totales.descuentoCupon.toLocaleString('es-CO')}</p>
          ` : ''}
          <p class="total-destacado" style="${totales.tieneCupon ? 'color: #10b981;' : ''}"><strong>Total a cobrar: $${totales.totalConDescuento.toLocaleString('es-CO')}</strong></p>
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
    
    console.log('✅ Sistema de notificaciones FCM activo');
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