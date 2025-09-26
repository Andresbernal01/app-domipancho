  // Variables globales
// Variables globales
let pedidosActivosGlobal = 0;

// ✅ FUNCIÓN MEJORADA CON VALIDACIÓN
function obtenerCostoDomicilio(pedido) {
  // Si el pedido tiene costo_domicilio guardado, usarlo
  if (pedido.costo_domicilio) {
    console.log(`💰 Usando costo guardado: $${pedido.costo_domicilio}`);
    return pedido.costo_domicilio;
  }
  
  // ✅ VERIFICAR QUE TENEMOS LOS DATOS NECESARIOS
  if (!pedido.restaurantes || !pedido.restaurantes.ciudad) {
    console.warn(`⚠️ No hay datos de restaurante para pedido ${pedido.id}, usando $5000`);
    return 5000;
  }
  
  // ✅ Mapeo de tarifas por ciudad (para pedidos antiguos)
  const TARIFAS_POR_CIUDAD = {
    'chiquinquira': 4000,
    'tunja': 5000,
    'cajica': 3000,
    'zipaquira': 4500
  };
  
  // Obtener ciudad y normalizarla
  let ciudadRestaurante = pedido.restaurantes.ciudad
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Eliminar tildes
  
  if (TARIFAS_POR_CIUDAD[ciudadRestaurante]) {
    console.log(`💰 Usando tarifa inferida para ${ciudadRestaurante}: $${TARIFAS_POR_CIUDAD[ciudadRestaurante]}`);
    return TARIFAS_POR_CIUDAD[ciudadRestaurante];
  }
  
  // Fallback final
  console.warn(`⚠️ Ciudad "${ciudadRestaurante}" no encontrada en tarifas, usando $5000`);
  return 5000;
}
  // Función para logout
  async function logout() {
    try {
      const response = await window.apiRequest('/api/logout', { method: 'POST' });
      if (response.ok) window.location.href = '/login.html';
      else alert('Error al cerrar sesión');
    } catch (error) {
      console.error('Error en logout:', error);
      window.location.href = '/login.html';
    }
  }

  // Cargar información del usuario
  async function cargarUsuario() {
    try {
      const response = await window.apiRequest('/api/usuario-actual');
      if (response.ok) {
        const usuario = await response.json();
        document.getElementById('restaurantName').textContent = `👤 ${usuario.usuario || 'Usuario'}`;
      }
    } catch (error) {
      console.error('Error al cargar usuario:', error);
      document.getElementById('restaurantName').textContent = '👤 Usuario';
    }
  }

  function actualizarContadorPedidos(cantidad) {
    pedidosActivosGlobal = cantidad;
    document.getElementById('numPedidosActivos').textContent = cantidad;
    
    // Cambiar estilo según la cantidad
    const contador = document.getElementById('contadorPedidos');
    contador.className = 'pedidos-activos-contador'; // Reset classes
    
    if (cantidad >= 2) {
      contador.classList.add('limite-alcanzado');
    } else if (cantidad === 1) {
      contador.classList.add('limite-cerca');
    }
  }
// En domiciliarios.html - Conexión de socket corregida
// En domiciliarios.html - Conexión de socket corregida

// En domiciliario.js - REEMPLAZAR la sección de socket connection:

// En domiciliarios.html - Conexión de socket corregida
document.addEventListener('DOMContentLoaded', async () => {
  await cargarUsuario();
  await cargarPedidos();
  
  // Conectar socket para notificaciones
  if (typeof io !== 'undefined') {
    const socket = io();
    
    socket.on('connect', async () => {
      console.log('🔌 Socket conectado');
      
      try {
        const response = await window.apiRequest('/api/usuario-actual');
        if (response.ok) {
          const usuario = await response.json();
          console.log(`👤 Usuario domiciliario: ${usuario.id}`);
          
          // ✅ UNIRSE SOLO A SALA ESPECÍFICA POR ID DOMICILIARIO
          socket.emit('join-domiciliario', usuario.id);
          console.log(`🏠 Unido a sala: domiciliario-${usuario.id}`);
          console.log(`🔍 Solo usando notificaciones geográficas específicas`);
        }
      } catch (error) {
        console.error('❌ Error al conectar socket:', error);
      }
    });
    
    // ✅ ESCUCHAR NOTIFICACIONES GEOGRÁFICAS ESPECÍFICAS - CORREGIDO
    socket.on('nuevo-pedido-geografico', (data) => {
      console.log('📍 Nuevo pedido geográfico recibido:', data);
      
      // ✅ VERIFICAR QUE mostrarPedidoGeografico EXISTE ANTES DE EJECUTAR
      if (typeof mostrarPedidoGeografico === 'function') {
        // Mostrar notificación
        if (window.NotificationSystem) {
          window.NotificationSystem.showNotification(
            `Nuevo pedido a ${data.distancia}km`,
            {
              body: `Pedido #${data.pedido.id} - ${data.pedido.nombre} ${data.pedido.apellido}`,
              icon: '/img/logo.png'
            }
          );
        }
        
        // ✅ EJECUTAR LA FUNCIÓN PARA MOSTRAR EL PEDIDO
        mostrarPedidoGeografico(data);
      } else {
        console.error('❌ Función mostrarPedidoGeografico no disponible');
        
        // ✅ FALLBACK: Recargar pedidos si la función no está disponible
        setTimeout(() => {
          console.log('🔄 Recargando pedidos como fallback...');
          cargarPedidos();
        }, 1000);
      }
    });
    
    socket.on('pedido-removido', (data) => {
      console.log('🗑️ Pedido removido:', data);
      // Remover pedido específico del DOM
      const pedidoCard = document.querySelector(`[data-pedido-id="${data.pedidoId}"]`);
      if (pedidoCard) {
        pedidoCard.remove();
      }
    });


    socket.on('pedido-fuera-radio', (data) => {
      console.log('🚫 Pedido fuera de radio:', data);
      removerPedidoFueraRadio(data);
    });

    
  }
});




// domiciliario.js - FunciÃ³n cargarPedidos CORREGIDA CON DISTANCIAS
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

    // Obtener información del usuario actual
    const response = await window.apiRequest('/api/usuario-actual');
    const usuario = await response.json();
    const miId = usuario.id;

    // Obtener asignaciones geográficas que incluyen a este domiciliario
    const asignacionesRes = await window.apiRequest(`/api/mis-asignaciones-geograficas`);
    let pedidosGeograficos = [];
    
    if (asignacionesRes.ok) {
      const asignaciones = await asignacionesRes.json();
      pedidosGeograficos = asignaciones.map(a => a.pedido_id);
      console.log(`🎯 Pedidos geográficos asignados a mí: [${pedidosGeograficos.join(', ')}]`);
    }

    const pedidosFiltrados = pedidos.filter(pedido => {
      // ✅ Incluir si es mi pedido asignado
      if (pedido.estado?.toLowerCase() === 'camino a tu casa' && pedido.domiciliario_id === miId) {
        console.log(`✅ Incluyendo mi pedido asignado: #${pedido.id}`);
        return true;
      }

      // ✅ Para pedidos "esperando repartidor"
      if (pedido.estado?.toLowerCase() === 'esperando repartidor') {
        // ✅ IMPORTANTE: TANTO AUTOMÁTICOS COMO MANUALES DEBEN USAR SISTEMA GEOGRÁFICO
        // Solo incluir si está en mis asignaciones geográficas
        if (pedidosGeograficos.includes(pedido.id)) {
          if (pedido.envio_manual_domiciliario === true) {
            console.log(`✅ Incluyendo pedido de envío manual geográfico: #${pedido.id}`);
          } else {
            console.log(`✅ Incluyendo pedido automático geográfico: #${pedido.id}`);
          }
          return true;
        }
        
        console.log(`❌ Excluyendo pedido #${pedido.id} - no está en mi rango geográfico (manual: ${pedido.envio_manual_domiciliario || false})`);
        return false;
      }

      return false;
    });

    // Separar pedidos disponibles y mis pedidos activos
    const disponibles = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'esperando repartidor');
    const misActivos = pedidosFiltrados.filter(p => p.estado?.toLowerCase() === 'camino a tu casa');
    
    // Actualizar contador
    actualizarContadorPedidos(misActivos.length);

    // Si tengo 2 pedidos activos, solo mostrar mis pedidos
    let pedidosAMostrar;
    if (misActivos.length >= 2) {
      pedidosAMostrar = misActivos;
    } else {
      // Mostrar mis pedidos activos + pedidos disponibles
      pedidosAMostrar = [...misActivos, ...disponibles];
    }

    const contenedor = document.getElementById('listaPedidos');
    if (!Array.isArray(pedidosAMostrar) || pedidosAMostrar.length === 0) {
      let mensaje = '';
      if (misActivos.length >= 2) {
        mensaje = `
          <div class="no-pedidos">
            <h3>🚛 Tienes el máximo de pedidos (2/2)</h3>
            <p>Completa una entrega para poder tomar nuevos pedidos.</p>
          </div>
        `;
      } else {
        mensaje = `
          <div class="no-pedidos">
            <h3>🎯 No hay pedidos disponibles en tu área</h3>
            <p>Actualmente no hay pedidos disponibles en tu radio de cobertura. ¡Mantente atento!</p>
          </div>
        `;
      }
      contenedor.innerHTML = mensaje;
      return;
    }

    const pedidosOrdenados = pedidosAMostrar.sort((a, b) => {
      // Primero mis pedidos activos, luego disponibles
      if (a.estado === 'camino a tu casa' && b.estado !== 'camino a tu casa') return -1;
      if (b.estado === 'camino a tu casa' && a.estado !== 'camino a tu casa') return 1;
      return new Date(a.fecha) - new Date(b.fecha);
    });

    let htmlContent = '';

    // Agregar alertas si aplica
    if (misActivos.length >= 2) {
      htmlContent += `
        <div class="limite-alcanzado" style="background: linear-gradient(135deg, #fee2e2, #fecaca); border: 2px solid #dc2626; border-radius: 12px; padding: 15px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #dc2626; margin: 0 0 10px 0;">🚛 Máximo de pedidos alcanzado (${misActivos.length}/2)</h3>
          <p style="color: #991b1b; margin: 0;">Completa una entrega para poder tomar nuevos pedidos.</p>
        </div>
      `;
    } else if (misActivos.length === 1) {
      htmlContent += `
        <div class="advertencia-limite" style="background: linear-gradient(135deg, #fef3c7, #fde68a); border: 2px solid #f59e0b; border-radius: 12px; padding: 15px; margin-bottom: 20px; text-align: center;">
          <h3 style="color: #d97706; margin: 0 0 10px 0;">⚠️ Puedes tomar 1 pedido más (${misActivos.length}/2)</h3>
          <p style="color: #92400e; margin: 0;">Tienes espacio para un pedido adicional.</p>
        </div>
      `;
    }

    // Separar mis pedidos de los disponibles en el HTML
    const misPedidosHtml = [];
    const pedidosDisponiblesHtml = [];

    pedidosOrdenados.forEach((p, index) => {
      const estadoClase = {
        'pendiente': 'pendiente',
        'en preparacion': 'en-preparacion',
        'esperando repartidor': 'esperando-repartidor',
        'camino a tu casa': 'camino',
        'entregado': 'entregado',
        'cancelado': 'cancelado'
      }[p.estado?.toLowerCase()] || 'pendiente';

// ✅ Calcular subtotal y costo real
const subtotalProductos = Array.isArray(p.productos) ? 
  p.productos.reduce((sum, pr) => sum + (pr.precio * pr.cantidad), 0) : 0;

const costoDomicilio = obtenerCostoDomicilio(p);
const total = subtotalProductos + costoDomicilio;

      const esMiPedido = p.estado === 'camino a tu casa';
      const esGeografico = pedidosGeograficos.includes(p.id);
      const colorClass = esMiPedido ? 'color-mi-pedido' : 'color-disponible';

      // ✅ MOSTRAR DISTANCIA SOLO PARA PEDIDOS DISPONIBLES
      const mostrarDistancia = !esMiPedido && p.distancia_al_restaurante !== null;

      // VERSIÓN COMPACTA DEL PEDIDO CON DISTANCIA
      const pedidoHtml = `
        <div class="pedido-card ${colorClass} ${esMiPedido ? 'mi-pedido' : ''}" 
             style="cursor: pointer; padding: 15px;" 
             onclick="abrirDetallesPedido(${p.id})"
             data-pedido-id="${p.id}">
          ${esMiPedido ? '<div class="badge-mi-pedido">🚛 Mi Pedido</div>' : ''}
          ${p.envio_manual_domiciliario ? '<div class="badge-manual">📤 Envío Manual</div>' : ''}
          ${esGeografico && !esMiPedido ? '<div class="badge-geografico">📍 Pedido Cercano</div>' : ''}
          
          <div class="pedido-header" style="margin-bottom: 12px; padding: 12px;">
            <div class="cliente-info">
              <h3 style="font-size: 1.1em;">${p.nombre} ${p.apellido}</h3>
              <div class="telefono" style="font-size: 0.85em;">📞 ${p.telefono}</div>
            </div>
            <div class="estado ${estadoClase}">${p.estado}</div>
          </div>

          ${mostrarDistancia ? `
            <div class="distancia-info" style="text-align: center; background: linear-gradient(135deg, #dcfce7, #bbf7d0); padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #10b981;">
            <strong style="color: #059669;">📍 Dist restaurante: ${p.distancia_al_restaurante.toFixed(3)}km</strong>
            </div>
          ` : ''}

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div class="info-section" style="padding: 10px; font-size: 0.85em;">
              <h4 style="font-size: 0.8em; margin-bottom: 5px;">🏬 Origen</h4>
              <p style="margin: 0; font-weight: bold;">${p.restaurantes?.nombre || 'Restaurante'}</p>
              <p style="margin: 0; font-size: 0.75em; color: #999;">📍 ${p.restaurantes?.direccion || 'Sin dirección'}</p>
              <p style="margin: 0; font-size: 0.75em; color: #999;">📞 ${p.restaurantes?.telefono || 'Sin teléfono'}</p>
            </div>

            <div class="info-section" style="padding: 10px; font-size: 0.85em;">
              <h4 style="font-size: 0.8em; margin-bottom: 5px;">🏠 Destino</h4>
              <p style="margin: 0; font-weight: bold;">${p.direccion}${p.complemento ? ' ' + p.complemento : ''}</p>
              <p style="margin: 0; font-size: 0.75em; color: #999;"><em>${p.barrio}</em></p>
            </div>
          </div>

          <div class="total-section" style="text-align: center; padding: 8px; margin: 10px 0;">
          <div class="total-amount" style="font-size: 1.1em;">$${total.toLocaleString('es-CO')}</div>
          <small style="font-size: 0.7em;">(Incluye domicilio: $${costoDomicilio.toLocaleString('es-CO')})</small>
          ${p.tipo_tarifa === 'por_km' && p.distancia_km ? 
            `<small style="display: block; font-size: 0.65em; color: #666;">(${p.distancia_km} km)</small>` : 
            ''}
        </div>

          <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 12px;">
            <button class="btn-ver-detalles"
                    onclick="event.stopPropagation(); abrirDetallesPedido(${p.id})"
                    style="flex: 1 1 100px; min-width: 100px; max-width: 120px; text-align: center;">
              👁️ Detalles
            </button>

            ${p.estado === 'esperando repartidor' ? `
              <button class="btn-tomar"
                      onclick="event.stopPropagation(); tomarPedido(${p.id})"
                      ${misActivos.length >= 2 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : ''}
                      style="flex: 1 1 100px; min-width: 100px; max-width: 120px; text-align: center;">
                ${misActivos.length >= 2 ? '🚫 Límite' : '📦 Tomar'}
              </button>
            ` : p.estado === 'camino a tu casa' ? `
            <button class="btn-liberar"
      onclick="event.stopPropagation(); abrirModalLiberar(${p.id})"
      style="flex: 1 1 100px; min-width: 100px; max-width: 120px; text-align: center; background-color: #f59e0b;">
🔄 Liberar
</button>
              <button class="btn-entregado"
                      onclick="event.stopPropagation(); abrirModalPago(${p.id})"
                      style="flex: 1 1 100px; min-width: 100px; max-width: 120px; text-align: center;">
                ✅ Entregado
              </button>
              <button class="btn-problema"
                      onclick="event.stopPropagation(); abrirModalProblema(${p.id})"
                      style="flex: 1 1 100px; min-width: 100px; max-width: 120px; text-align: center;">
                ❌ Problema
              </button>
            ` : ''}
          </div>

          <div style="text-align: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid #333;">
            <small style="color: black; font-size: 0.7em;">
              📅 ${new Date(p.fecha).toLocaleDateString('es-CO')} - 
              ${new Date(p.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
            </small>
          </div>
        </div>
      `;

      if (esMiPedido) {
        misPedidosHtml.push(pedidoHtml);
      } else {
        pedidosDisponiblesHtml.push(pedidoHtml);
      }
    });

    // Construir el HTML final
    htmlContent += '<div class="pedidos-grid">';

    // Primero mis pedidos
    if (misPedidosHtml.length > 0) {
      htmlContent += misPedidosHtml.join('');
    }

    // Separador solo si hay mis pedidos Y pedidos disponibles
    if (misPedidosHtml.length > 0 && pedidosDisponiblesHtml.length > 0) {
      htmlContent += '</div>'; // Cerrar grid de mis pedidos
      htmlContent += `
        <div class="separador-pedidos">
          <span>📋 Más Pedidos Disponibles en tu Área</span>
        </div>
      `;
      htmlContent += '<div class="pedidos-grid">'; // Abrir nuevo grid
    }

    // Luego pedidos disponibles
    if (pedidosDisponiblesHtml.length > 0) {
      htmlContent += pedidosDisponiblesHtml.join('');
    }

    htmlContent += '</div>'; // Cerrar último grid

    contenedor.innerHTML = htmlContent;
  } catch (err) {
    console.error('Error al cargar pedidos:', err);
    document.getElementById('listaPedidos').innerHTML = `
<div class="error" style="text-align: center;">
<h3>⚠️ Error al cargar pedidos</h3>
<p>No se pudieron cargar los pedidos. Por favor, recarga la página.</p>
<button onclick="window.location.href='login.html'" style="
  margin-top: 8px;
  padding: 6px 12px;
  background-color: #007bff;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
">
  Ir a Login
</button>
</div>
`;

  }
}



// Función para mostrar pedido geográfico recibido por socket - CORREGIDA
// En domiciliario.js - REEMPLAZAR la sección de socket connection:

// En domiciliarios.html - Conexión de socket corregida
document.addEventListener('DOMContentLoaded', async () => {
  await cargarUsuario();
  await cargarPedidos();
  
  // Conectar socket para notificaciones
  if (typeof io !== 'undefined') {
    const socket = io();
    
    socket.on('connect', async () => {
      console.log('🔌 Socket conectado');
      
      try {
        const response = await window.apiRequest('/api/usuario-actual');
        if (response.ok) {
          const usuario = await response.json();
          console.log(`👤 Usuario domiciliario: ${usuario.id}`);
          
          // ✅ UNIRSE SOLO A SALA ESPECÍFICA POR ID DOMICILIARIO
          socket.emit('join-domiciliario', usuario.id);
          console.log(`🏠 Unido a sala: domiciliario-${usuario.id}`);
          console.log(`🔍 Solo usando notificaciones geográficas específicas`);
        }
      } catch (error) {
        console.error('❌ Error al conectar socket:', error);
      }
    });
    
    // ✅ ESCUCHAR NOTIFICACIONES GEOGRÁFICAS ESPECÍFICAS - CORREGIDO
    socket.on('nuevo-pedido-geografico', (data) => {
      console.log('📍 Nuevo pedido geográfico recibido:', data);
      
      // ✅ VERIFICAR QUE mostrarPedidoGeografico EXISTE ANTES DE EJECUTAR
      if (typeof mostrarPedidoGeografico === 'function') {
        // Mostrar notificación
        if (window.NotificationSystem) {
          window.NotificationSystem.showNotification(
            `Nuevo pedido a ${data.distancia}km`,
            {
              body: `Pedido #${data.pedido.id} - ${data.pedido.nombre} ${data.pedido.apellido}`,
              icon: '/img/logo.png'
            }
          );
        }
        
        // ✅ EJECUTAR LA FUNCIÓN PARA MOSTRAR EL PEDIDO
        mostrarPedidoGeografico(data);
      } else {
        console.error('❌ Función mostrarPedidoGeografico no disponible');
        
        // ✅ FALLBACK: Recargar pedidos si la función no está disponible
        setTimeout(() => {
          console.log('🔄 Recargando pedidos como fallback...');
          cargarPedidos();
        }, 1000);
      }
    });
    
    socket.on('pedido-removido', (data) => {
      console.log('🗑️ Pedido removido:', data);
      // Remover pedido específico del DOM
      const pedidoCard = document.querySelector(`[data-pedido-id="${data.pedidoId}"]`);
      if (pedidoCard) {
        pedidoCard.remove();
      }
    });
  }
});

// ✅ ASEGURAR QUE LA FUNCIÓN mostrarPedidoGeografico ESTÉ DISPONIBLE GLOBALMENTE
// Función completa para mostrar pedido geográfico - MEJORADA
// FunciÃ³n completa para mostrar pedido geogrÃ¡fico - MEJORADA CON DISTANCIA
function mostrarPedidoGeografico(data) {
  try {
    console.log('📍 Mostrando pedido geográfico:', data);
    
    const pedido = data.pedido;
    const distancia = data.distancia;
    const esConexionInicial = data.conexion_inicial || false;
    
    // Si es de conexión inicial, mostrar mensaje especial
    if (esConexionInicial) {
      console.log('🔔 Pedido encontrado al conectarse:', pedido.id);
      
      // Mostrar notificación especial
      if (window.NotificationSystem) {
        window.NotificationSystem.showNotification(
          `🎯 Pedido cercano encontrado`,
          {
            body: `Pedido #${pedido.id} a ${distancia}km - ${pedido.nombre} ${pedido.apellido}`,
            icon: '/img/logo.png'
          }
        );
      }
    }
    
    // ✅ VERIFICAR QUE EL CONTENEDOR EXISTE
    const contenedor = document.getElementById('listaPedidos');
    if (!contenedor) {
      console.error('❌ Contenedor listaPedidos no encontrado');
      return;
    }
    
    // Si el contenedor está vacío o tiene mensaje de "no hay pedidos"
    if (contenedor.querySelector('.no-pedidos')) {
      contenedor.innerHTML = '<div class="pedidos-grid"></div>';
    }
    
    let grid = contenedor.querySelector('.pedidos-grid');
    if (!grid) {
      contenedor.innerHTML = '<div class="pedidos-grid"></div>';
      grid = contenedor.querySelector('.pedidos-grid');
    }

    // ✅ VERIFICAR QUE EL PEDIDO NO ESTÉ YA MOSTRADO
    const pedidoExistente = grid.querySelector(`[data-pedido-id="${pedido.id}"]`);
    if (pedidoExistente) {
      console.log(`⚠️ Pedido ${pedido.id} ya está mostrado, no duplicar`);
      return;
    }

// ✅ Calcular subtotal y costo real
const subtotalProductos = Array.isArray(pedido.productos) ? 
  pedido.productos.reduce((sum, pr) => sum + (pr.precio * pr.cantidad), 0) : 0;

const costoDomicilio = obtenerCostoDomicilio(pedido);
const total = subtotalProductos + costoDomicilio;

    const badgeTexto = esConexionInicial ? '🔔 Pedido Encontrado' : '📍 Nuevo Pedido Cercano';
    const borderColor = esConexionInicial ? '#3b82f6' : '#10b981'; // Azul para conexión inicial, verde para nuevos
    const boxShadowColor = esConexionInicial ? 'rgba(59, 130, 246, 0.5)' : 'rgba(16, 185, 129, 0.5)';

    const pedidoHtml = `
      <div class="pedido-card color-disponible nuevo-geografico ${esConexionInicial ? 'conexion-inicial' : ''}" 
           style="cursor: pointer; padding: 15px; border: 3px solid ${borderColor}; box-shadow: 0 0 15px ${boxShadowColor};" 
           onclick="abrirDetallesPedido(${pedido.id})"
           data-pedido-id="${pedido.id}">
        <div class="badge-geografico" style="background: linear-gradient(135deg, ${borderColor}, ${esConexionInicial ? '#1d4ed8' : '#059669'}); color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.75em; position: absolute; top: 10px; left: 10px; z-index: 10;">${badgeTexto}</div>
        
        <div class="pedido-header" style="margin-bottom: 12px; padding: 12px; margin-top: 15px;">
          <div class="cliente-info">
            <h3 style="font-size: 1.1em;">${pedido.nombre} ${pedido.apellido}</h3>
            <div class="telefono" style="font-size: 0.85em;">📞 ${pedido.telefono}</div>
          </div>
          <div class="estado esperando-repartidor">esperando repartidor</div>
        </div>

        <div class="distancia-info" style="text-align: center; background: linear-gradient(135deg, #dcfce7, #bbf7d0); padding: 10px; border-radius: 8px; margin-bottom: 12px; border: 1px solid #10b981;">
        <strong style="color: #059669;">📍 Dist restaurante: ${distancia.toFixed(3)}km</strong>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
          <div class="info-section" style="padding: 10px; font-size: 0.85em;">
            <h4 style="font-size: 0.8em; margin-bottom: 5px;">🏬 Origen</h4>
            <p style="margin: 0; font-weight: bold;">${pedido.restaurantes?.nombre || 'Restaurante'}</p>
            <p style="margin: 0; font-size: 0.75em; color: #999;">📍 ${pedido.restaurantes?.direccion || 'Sin dirección'}</p>
            <p style="margin: 0; font-size: 0.75em; color: #999;">📞 ${pedido.restaurantes?.telefono || 'Sin teléfono'}</p>
          </div>

          <div class="info-section" style="padding: 10px; font-size: 0.85em;">
            <h4 style="font-size: 0.8em; margin-bottom: 5px;">🏠 Destino</h4>
            <p style="margin: 0; font-weight: bold;">${pedido.direccion}${pedido.complemento ? ' ' + pedido.complemento : ''}</p>
            <p style="margin: 0; font-size: 0.75em; color: #999;"><em>${pedido.barrio}</em></p>
          </div>
        </div>

        <div class="total-section" style="text-align: center; padding: 8px; margin: 10px 0;">
        <div class="total-amount" style="font-size: 1.1em;">$${total.toLocaleString('es-CO')}</div>
        <small style="font-size: 0.7em;">(Incluye domicilio: $${costoDomicilio.toLocaleString('es-CO')})</small>
        ${pedido.tipo_tarifa === 'por_km' && pedido.distancia_km ? 
          `<small style="display: block; font-size: 0.65em; color: #666;">(${pedido.distancia_km} km)</small>` : 
          ''}
      </div>

        <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; margin-top: 12px;">
          <button class="btn-ver-detalles"
                  onclick="event.stopPropagation(); abrirDetallesPedido(${pedido.id})"
                  style="flex: 1 1 100px; min-width: 100px; max-width: 120px; text-align: center;">
            👁️ Detalles
          </button>

          <button class="btn-tomar"
                  onclick="event.stopPropagation(); tomarPedido(${pedido.id})"
                  style="flex: 1 1 100px; min-width: 100px; max-width: 120px; text-align: center; background: linear-gradient(135deg, ${borderColor}, ${esConexionInicial ? '#1d4ed8' : '#059669'}); border: none; color: white; font-weight: bold;">
            📦 Tomar
          </button>
        </div>

        <div style="text-align: center; margin-top: 8px; padding-top: 8px; border-top: 1px solid #333;">
          <small style="color: black; font-size: 0.7em;">
            📅 ${new Date(pedido.fecha).toLocaleDateString('es-CO')} - 
            ${new Date(pedido.fecha).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
          </small>
        </div>
      </div>
    `;

    // Insertar al inicio del grid
    grid.insertAdjacentHTML('afterbegin', pedidoHtml);
    
    // Agregar efecto de animación
    const nuevaTarjeta = grid.querySelector(`[data-pedido-id="${pedido.id}"]`);
    if (nuevaTarjeta) {
      nuevaTarjeta.style.opacity = '0';
      nuevaTarjeta.style.transform = 'scale(0.9)';
      
      setTimeout(() => {
        nuevaTarjeta.style.transition = 'all 0.3s ease';
        nuevaTarjeta.style.opacity = '1';
        nuevaTarjeta.style.transform = 'scale(1)';
      }, 100);

      // Si es conexión inicial, añadir efecto especial
      if (esConexionInicial) {
        setTimeout(() => {
          nuevaTarjeta.style.animation = 'pulse 2s ease-in-out 3';
        }, 500);
      }
    }
    
    console.log(`✅ Pedido ${pedido.id} mostrado correctamente con distancia: ${distancia}km`);
    
  } catch (error) {
    console.error('❌ Error al mostrar pedido geográfico:', error);
  }
}

// Función para remover pedido que salió de radio
function removerPedidoFueraRadio(data) {
  console.log('🚫 Pedido fuera de radio recibido:', data);
  
  // Buscar y remover la tarjeta del pedido
  const pedidoCard = document.querySelector(`[data-pedido-id="${data.pedidoId}"]`);
  if (pedidoCard) {
    // Animar salida
    pedidoCard.style.transition = 'all 0.5s ease';
    pedidoCard.style.opacity = '0';
    pedidoCard.style.transform = 'scale(0.8)';
    
    // Remover después de la animación
    setTimeout(() => {
      pedidoCard.remove();
      console.log(`✅ Pedido ${data.pedidoId} removido del DOM`);
      
      // Verificar si no hay más pedidos disponibles
      const contenedor = document.getElementById('listaPedidos');
      const pedidosRestantes = contenedor.querySelectorAll('[data-pedido-id]');
      
      if (pedidosRestantes.length === 0) {
        contenedor.innerHTML = `
          <div class="no-pedidos">
            <h3>📍 Te has alejado del área de cobertura</h3>
            <p>No hay pedidos disponibles en tu ubicación actual. Acércate a las zonas con pedidos activos.</p>
          </div>
        `;
      }
    }, 500);
    
    // Mostrar notificación
    mostrarMensaje(`📍 Te alejaste del área del pedido #${data.pedidoId} (${data.distancia_actual.toFixed(2)}km > ${data.radio_limite}km)`, 'error');
  }
}

// ✅ HACER LA FUNCIÓN DISPONIBLE GLOBALMENTE

  document.addEventListener('DOMContentLoaded', () => {
    const notiDomi = new NotificationSystem(true); // true = domiciliario
    notiDomi.requestPermission();

    // Sobreescribir mostrarNotificacion para recargar pedidos
    const originalMostrar = notiDomi.mostrarNotificacion;
    notiDomi.mostrarNotificacion = function (data) {
      originalMostrar.call(this, data);

      // Esperar un segundo y recargar la lista de pedidos
      setTimeout(() => {
        cargarPedidos();
      }, 1000);
    };
  });

  async function tomarPedido(pedidoId) {
    if (pedidosActivosGlobal >= 2) {
      mostrarMensaje('❌ No puedes tomar más pedidos. Máximo 2 pedidos activos permitidos.', 'error');
      return;
    }

    if (!confirm('¿Quieres tomar este pedido?')) return;

    try {
      const res = await window.apiRequest(`/api/pedidos/${pedidoId}/tomar`, {
        method: 'POST'
      });
      const result = await res.json();

      if (res.ok) {
        mostrarMensaje(`✅ Pedido asignado. ¡Prepárate para la entrega! (${result.pedidosActivos || 1}/2 activos)`);
        setTimeout(() => {
          cargarPedidos();
        }, 1000);
      } else {
        mostrarMensaje(`❌ ${result.error || 'No se pudo tomar el pedido'}`, 'error');
      }
    } catch (error) {
      console.error('Error al tomar pedido:', error);
      mostrarMensaje('❌ Ocurrió un error de conexión', 'error');
    }
  }

  async function marcarEntregado(pedidoId) {
    if (!confirm('¿Marcar este pedido como entregado?')) return;

    try {
      const res = await window.apiRequest(`/api/pedidos/${pedidoId}/estado-domiciliario`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: 'entregado' })
      });
      const result = await res.json();

      if (res.ok) {
        mostrarMensaje('✅ Pedido entregado exitosamente');
        setTimeout(() => {
          cargarPedidos();
        }, 1000);
      } else {
        alert(result.error || 'No se pudo actualizar el estado');
      }
    } catch (error) {
      console.error('Error al marcar entregado:', error);
      alert('Error interno');
    }
  }

  function mostrarMensaje(texto, tipo = 'success') {
    const box = document.getElementById('mensajeSistema');
    box.textContent = texto;

    if (tipo === 'success') {
      box.style.background = 'linear-gradient(90deg, #10b981, #059669)';
    } else if (tipo === 'error') {
      box.style.background = 'linear-gradient(90deg, #ef4444, #b91c1c)';
    }

    box.style.display = 'block';

    setTimeout(() => {
      box.style.display = 'none';
    }, 4000);
  }

  let pedidoProblemaId = null;

  function abrirModalProblema(id) {
    pedidoProblemaId = id;
    document.getElementById('modalProblema').style.display = 'flex';
  }

  function cerrarModal() {
    document.getElementById('modalProblema').style.display = 'none';
    pedidoProblemaId = null;
  }

  function mostrarOtroCampo(valor) {
    document.getElementById('campoOtro').style.display = valor === 'otro' ? 'block' : 'none';
  }

  function mostrarCampoExplicacion(valor) {
    const campo = document.getElementById('campoExplicacionNoDevolvi');
    campo.style.display = valor === 'no lo devolví' ? 'block' : 'none';
  }

  document.getElementById('accion_pedido').addEventListener('change', function () {
    mostrarCampoExplicacion(this.value);
  });



  function abrirModalPago(pedidoId) {
    window.pedidoSeleccionado = pedidoId;
    
    const radios = document.querySelectorAll('input[name="metodo_pago"]');
    radios.forEach(radio => radio.checked = false);
    
    const btnConfirmar = document.getElementById('btnConfirmarEntrega');
    btnConfirmar.disabled = true;
    btnConfirmar.style.opacity = '0.5';
    btnConfirmar.style.cursor = 'not-allowed';
    
    document.getElementById('modalMetodoPago').style.display = 'flex';
    
    radios.forEach(radio => {
      radio.addEventListener('change', habilitarBotonConfirmar);
    });
  }

  function habilitarBotonConfirmar() {
    const radioSeleccionado = document.querySelector('input[name="metodo_pago"]:checked');
    const btnConfirmar = document.getElementById('btnConfirmarEntrega');
    
    if (radioSeleccionado) {
      btnConfirmar.disabled = false;
      btnConfirmar.style.opacity = '1';
      btnConfirmar.style.cursor = 'pointer';
    } else {
      btnConfirmar.disabled = true;
      btnConfirmar.style.opacity = '0.5';
      btnConfirmar.style.cursor = 'not-allowed';
    }
  }

  function cerrarModalPago() {
    document.getElementById('modalMetodoPago').style.display = 'none';
    window.pedidoSeleccionado = null;
    
    const radios = document.querySelectorAll('input[name="metodo_pago"]');
    radios.forEach(radio => {
      radio.removeEventListener('change', habilitarBotonConfirmar);
    });
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
        body: JSON.stringify({ 
          estado: 'entregado', 
          metodo_pago: metodo.value 
        })
      });
      
      const result = await res.json();
      
      if (res.ok) {
        const metodoPagoTexto = metodo.value === 'efectivo' ? 'efectivo' : 'pago por App';
        mostrarMensaje(`✅ Pedido entregado exitosamente con ${metodoPagoTexto}`);
        cerrarModalPago();
        setTimeout(() => {
          location.reload();
        }, 1500);
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

  // Cerrar modal al hacer clic fuera de él
  document.addEventListener('click', function(event) {
    const modal = document.getElementById('modalMetodoPago');
    if (event.target === modal) {
      cerrarModalPago();
    }
  });

  // Cerrar modal con tecla Escape
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
      const modal = document.getElementById('modalMetodoPago');
      if (modal.style.display === 'flex') {
        cerrarModalPago();
      }
    }
  });

  async function confirmarNoEntregado() {
if (!pedidoProblemaId) {
  alert('Error: No se ha seleccionado un pedido');
  return;
}

// Obtener todos los valores del formulario
const motivo = document.getElementById('motivo').value;
const detalleMotivo = document.getElementById('detalle_motivo').value;
const llamoRestaurante = document.querySelector('input[name="llamo_restaurante"]:checked')?.value;
const accion = document.getElementById('accion_pedido').value;
const explicacionNoDevolvi = document.getElementById('explicacion_no_devolvi')?.value || '';

// VALIDACIONES OBLIGATORIAS
if (!motivo) {
  alert('⚠️ Debes seleccionar un motivo para el problema');
  return;
}

if (motivo === 'otro' && !detalleMotivo.trim()) {
  alert('⚠️ Debes explicar el motivo cuando seleccionas "Otro"');
  return;
}

if (!llamoRestaurante) {
  alert('⚠️ Debes indicar si llamaste al restaurante');
  return;
}

if (!accion) {
  alert('⚠️ Debes indicar qué hiciste con el pedido');
  return;
}

if (accion === 'no lo devolví' && !explicacionNoDevolvi.trim()) {
  alert('⚠️ Debes explicar por qué no devolviste el pedido');
  return;
}

// Construir comentario completo para el reporte
let comentario = `REPORTE DE PROBLEMA:\n`;
comentario += `Motivo: ${motivo}\n`;

if (motivo === 'otro' && detalleMotivo.trim()) {
  comentario += `Detalle del motivo: ${detalleMotivo.trim()}\n`;
}

comentario += `¿Llamó al restaurante?: ${llamoRestaurante}\n`;
comentario += `Acción tomada con el pedido: ${accion}\n`;

if (accion === 'no lo devolví' && explicacionNoDevolvi.trim()) {
  comentario += `Explicación de por qué no lo devolvió: ${explicacionNoDevolvi.trim()}`;
}

// Confirmación final antes de enviar
if (!confirm('¿Estás seguro de marcar este pedido como NO ENTREGADO? Esta acción no se puede deshacer.')) {
  return;
}

// Deshabilitar botón para evitar doble envío
const btnConfirmar = document.querySelector('.modal-contenido button[onclick="confirmarNoEntregado()"]');
const textoOriginal = btnConfirmar.innerHTML;
btnConfirmar.disabled = true;
btnConfirmar.innerHTML = '⏳ Enviando reporte...';

try {
  const res = await window.apiRequest(`/api/pedidos/${pedidoProblemaId}/estado-domiciliario`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      estado: 'cancelado',
      comentario_domiciliario: comentario
    })
  });

  const result = await res.json();

  if (res.ok) {
    mostrarMensaje('✅ Pedido marcado como no entregado - Reporte enviado exitosamente');
    cerrarModal();
    
    // Limpiar formulario para próximo uso
    limpiarFormularioProblema();
    
    // Recargar lista de pedidos
    setTimeout(() => {
      cargarPedidos();
    }, 1000);
  } else {
    alert(`❌ Error: ${result.error || 'No se pudo actualizar el estado del pedido'}`);
    
    // Restaurar botón
    btnConfirmar.disabled = false;
    btnConfirmar.innerHTML = textoOriginal;
  }
} catch (error) {
  console.error('Error al marcar como no entregado:', error);
  alert('❌ Error de conexión. Por favor intenta nuevamente.');
  
  // Restaurar botón
  btnConfirmar.disabled = false;
  btnConfirmar.innerHTML = textoOriginal;
}
}

// Función auxiliar para limpiar el formulario del modal de problema
function limpiarFormularioProblema() {
document.getElementById('motivo').value = '';
document.getElementById('detalle_motivo').value = '';
document.getElementById('campoOtro').style.display = 'none';
document.getElementById('accion_pedido').value = '';
document.getElementById('explicacion_no_devolvi').value = '';
document.getElementById('campoExplicacionNoDevolvi').style.display = 'none';

// Limpiar radio buttons
const radioButtons = document.querySelectorAll('input[name="llamo_restaurante"]');
radioButtons.forEach(radio => radio.checked = false);
}

// Función mejorada para cerrar modal (también limpia el formulario)
function cerrarModal() {
document.getElementById('modalProblema').style.display = 'none';
limpiarFormularioProblema();
pedidoProblemaId = null;
}

  // Función para abrir modal con detalles completos del pedido
  async function abrirDetallesPedido(pedidoId) {
    try {
      // Buscar el pedido en los datos ya cargados primero
      const response = await window.apiRequest(`/api/pedidos-domiciliario`);
      const pedidos = await response.json();
      const pedido = pedidos.find(p => p.id === pedidoId);
      
      if (!pedido) {
        alert('No se pudo encontrar el pedido');
        return;
      }

      const productosHtml = Array.isArray(pedido.productos) ? 
        pedido.productos.map(pr => {
          const subtotal = pr.precio * pr.cantidad;
          return `
            <div class="producto-detalle-item">
              <div class="producto-nombre-detalle">${pr.nombre}</div>
              <div class="producto-detalles">
                Cantidad: ${pr.cantidad} × ${pr.precio.toFixed(2)} = ${subtotal.toFixed(2)}
              </div>
            </div>
          `;
        }).join('') : '<p>No hay productos disponibles</p>';

// ✅ Calcular subtotal y costo real
const subtotalProductos = Array.isArray(pedido.productos) ? 
  pedido.productos.reduce((sum, pr) => sum + (pr.precio * pr.cantidad), 0) : 0;

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
          <p><strong>Subtotal productos:</strong> $${subtotalProductos.toLocaleString('es-CO')}</p>
          <p><strong>Domicilio:</strong> $${costoDomicilio.toLocaleString('es-CO')}</p>
          ${pedido.tipo_tarifa === 'por_km' && pedido.distancia_km ? 
            `<p style="font-size: 0.9em; color: #666;"><em>(Tarifa por km: ${pedido.distancia_km} km recorridos)</em></p>` : 
            ''}
          <p style="font-size: 1.2em; color: #facc15;"><strong>Total a cobrar: $${total.toLocaleString('es-CO')}</strong></p>
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

          <button class="btn-cerrar-modal" onclick="cerrarDetallesPedido()">
            ❌ Cerrar Detalles
          </button>
        </div>
      `;

      // Crear y mostrar el modal
      const modal = document.createElement('div');
      modal.id = 'modalDetalles';
      modal.innerHTML = modalHTML;
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.85);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
      `;
      
      document.body.appendChild(modal);

      // Cerrar con clic fuera del modal
      modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarDetallesPedido();
      });

    } catch (err) {
      console.error('Error al cargar detalles:', err);
      alert('Error al cargar los detalles del pedido');
    }
  }

  // Función para cerrar el modal de detalles
  function cerrarDetallesPedido() {
    const modal = document.getElementById('modalDetalles');
    if (modal) {
      modal.remove();
    }
  }

  // Evento para cerrar modal con tecla Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cerrarDetallesPedido();
    }
  });


  let pedidoALiberarId = null;

function abrirModalLiberar(pedidoId) {
pedidoALiberarId = pedidoId;
document.getElementById('modalLiberarPedido').style.display = 'flex';

// Resetear formulario
document.getElementById('motivo_liberacion').value = '';
document.getElementById('detalle_motivo_liberacion').value = '';
document.getElementById('campoDetalleMotivo').style.display = 'none';
}

function cerrarModalLiberar() {
document.getElementById('modalLiberarPedido').style.display = 'none';
pedidoALiberarId = null;
}

function mostrarDetalleMotivo(valor) {
document.getElementById('campoDetalleMotivo').style.display = 
  (valor === 'otro') ? 'block' : 'none';
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
    setTimeout(() => {
      cargarPedidos();
    }, 1000);
  } else {
    mostrarMensaje(`❌ ${result.error || 'Error al liberar pedido'}`, 'error');
  }
} catch (error) {
  console.error('Error al liberar pedido:', error);
  mostrarMensaje('❌ Error de conexión', 'error');
}
}

window.mostrarPedidoGeografico = mostrarPedidoGeografico;
window.removerPedidoFueraRadio = removerPedidoFueraRadio;

