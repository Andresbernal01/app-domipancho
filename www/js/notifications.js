class NotificationSystem {
  constructor(esDomiciliario = false) {
    this.socket = null;
    this.audio = new Audio('/audio/notificacion.mp3');
    this.audio.volume = 0.7;
    this.esDomiciliario = esDomiciliario;
    this.audioLoop = null; // Para el loop de audio en restaurantes
    this.init();
  }

  async init() {
    try {
      this.socket = io();
      if (!this.socket) throw new Error("Socket.IO no está disponible");

      const response = await window.apiRequest('/api/usuario-actual');
      if (response.ok) {
        const usuario = await response.json();

        if (this.esDomiciliario) {
          if (usuario.ciudad) {
            const ciudadNormalizada = usuario.ciudad.trim().toLowerCase();
            this.socket.emit('join-domiciliarios-ciudad', ciudadNormalizada);
          }
        } else {
          this.socket.emit('join-restaurant', usuario.restaurante_id);
        }

        // 🔔 Evento para nuevos pedidos
        this.socket.on('nuevo-pedido', (data) => {
          const estado = data?.pedido?.estado?.toLowerCase();
          if (this.esDomiciliario && estado !== 'esperando repartidor') return;
          this.mostrarNotificacion(data);
        });

        // 🔄 Evento cuando un domiciliario actualiza un pedido
        this.socket.on('pedido-actualizado', (data) => {
          console.log('🔄 Pedido actualizado por domiciliario:', data);
          if (!this.esDomiciliario && typeof cargarPedidosHoy === 'function') {
            setTimeout(() => {
              cargarPedidosHoy();
            }, 1000);
          }
        });

        // ❌ Evento cuando otro domiciliario toma el pedido
        this.socket.on('pedido-tomado', ({ pedidoId }) => {
          if (this.esDomiciliario) {
            const card = document.querySelector(`.pedido-card button[onclick*="tomarPedido(${pedidoId})"]`)?.closest('.pedido-card');
            if (card) {
              card.remove();

              const restantes = document.querySelectorAll('.pedido-card');
              if (restantes.length === 0) {
                const contenedor = document.getElementById('listaPedidos');
                contenedor.innerHTML = `
                  <div class="no-pedidos">
                    <h3>🎯 No hay pedidos disponibles</h3>
                    <p>Actualmente no tienes pedidos asignados. ¡Mantente atento!</p>
                  </div>
                `;
              }
            }
          } else {
            if (typeof cargarPedidosHoy === 'function') {
              setTimeout(() => {
                cargarPedidosHoy();
              }, 1000);
            }
          }
        });

        // 🗑️ Evento cuando un pedido ya no está disponible
        this.socket.on('pedido-removido', ({ pedidoId }) => {
          if (this.esDomiciliario) {
            const card = document.querySelector(`.pedido-card button[onclick*="tomarPedido(${pedidoId})"]`)?.closest('.pedido-card');
            if (card) {
              card.remove();

              const restantes = document.querySelectorAll('.pedido-card');
              if (restantes.length === 0) {
                const contenedor = document.getElementById('listaPedidos');
                contenedor.innerHTML = `
                  <div class="no-pedidos">
                    <h3>🎯 No hay pedidos disponibles</h3>
                    <p>Actualmente no tienes pedidos asignados. ¡Mantente atento!</p>
                  </div>
                `;
              }
            }
          }
        });

        // 🔄 Evento cuando un pedido es liberado por otro domiciliario
        this.socket.on('pedido-liberado', (data) => {
          if (this.esDomiciliario) {
            console.log('🔄 Pedido liberado recibido:', data);
            
            // Recargar la lista de pedidos después de un breve delay
            setTimeout(() => {
              if (typeof cargarPedidos === 'function') {
                cargarPedidos();
              }
            }, 1000);
          }
        });

      }
    } catch (error) {
      console.error('Error al inicializar notificaciones:', error);
    }
  }

  mostrarNotificacion(data) {
    const estado = data?.pedido?.estado?.toLowerCase();
    const soloActualizar = !['pendiente', 'esperando repartidor'].includes(estado);

    if (soloActualizar) return;

    // Reproducir sonido según el tipo de usuario
    if (this.esDomiciliario) {
      // Para domiciliarios: sonido normal (no persistente)
      this.audio.play().catch(console.error);
    } else {
      // Para restaurantes: sonido en loop hasta silenciar
      this.iniciarSonidoPersistente();
    }

    this.crearNotificacionVisual(data);

    if (Notification.permission === 'granted') {
      new Notification('Nuevo Pedido - DomiPancho', {
        body: data.mensaje,
        icon: '/img/logo.png'
      });
    }
  }

  iniciarSonidoPersistente() {
    // Detener cualquier loop anterior
    this.detenerSonidoPersistente();
    
    // Crear nuevo audio con loop
    this.audioLoop = new Audio('/audio/notificacion.mp3');
    this.audioLoop.volume = 0.7;
    this.audioLoop.loop = true;
    this.audioLoop.play().catch(console.error);
  }

  detenerSonidoPersistente() {
    if (this.audioLoop) {
      this.audioLoop.pause();
      this.audioLoop.currentTime = 0;
      this.audioLoop = null;
    }
  }

  crearNotificacionVisual(data) {
    const notification = document.createElement('div');
    notification.className = 'notification-popup';

    const verURL = this.esDomiciliario
      ? `/domiciliarios.html?id=${data.pedido.id}`
      : `/ver_pedidos.html`;

    if (this.esDomiciliario) {
      // Notificación para domiciliarios (comportamiento original)
      notification.innerHTML = `
        <div class="notification-content">
          <h3>🔔 Nuevo Pedido</h3>
          <p>${data.mensaje}</p>
          <p>Pedido #${data.pedido.id}</p>
          <button onclick="this.parentElement.parentElement.remove(); window.location.href='${verURL}'">
            Ver Pedido
          </button>
          <button onclick="this.parentElement.parentElement.remove()">Cerrar</button>
        </div>
      `;

      // Auto-remover después de 10 segundos para domiciliarios
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
        }
      }, 10000);
    } else {
      // Notificación persistente para restaurantes
      notification.innerHTML = `
        <div class="notification-content notification-persistent">
          <h3>🔔 Nuevo Pedido</h3>
          <p>${data.mensaje}</p>
          <p>Pedido #${data.pedido.id}</p>
          <div class="notification-buttons">
            <button class="btn-ver-pedido" onclick="window.location.href='${verURL}'; this.parentElement.parentElement.parentElement.remove();">
              👁️ Ver Pedido
            </button>
            <button class="btn-silenciar" onclick="notificationSystem.silenciarNotificacion(this.parentElement.parentElement.parentElement)">
              🔇 Silenciar
            </button>
          </div>
        </div>
      `;

      // Para restaurantes NO auto-remover - solo se quita manualmente
    }

    document.body.appendChild(notification);
  }

  silenciarNotificacion(notificationElement) {
    // Detener sonido persistente
    this.detenerSonidoPersistente();
    
    // Remover notificación visual
    if (notificationElement && notificationElement.parentNode) {
      notificationElement.remove();
    }
  }

  async requestPermission() {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }
    return false;
  }
}