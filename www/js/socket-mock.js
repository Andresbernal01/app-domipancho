// socket-mock.js - Socket.IO mock mejorado para app móvil
(function() {
  'use strict';
  
  class SocketMock {
    constructor() {
      this.connected = false;
      this.listeners = {};
      this.pollingInterval = null;
      this.lastPedidosState = null;
      this.usuarioId = null;
    }

    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
      console.log(`📱 Socket registrado: '${event}'`);
    }

    emit(event, data) {
      console.log(`📱 Socket emit: '${event}':`, data);
      
      // Guardar ID de usuario cuando se une
      if (event === 'join-domiciliario' && data) {
        this.usuarioId = data;
        console.log(`👤 Usuario domiciliario guardado: ${this.usuarioId}`);
      }
    }

    connect() {
      console.log('📱 Socket mock conectando...');
      this.connected = true;
      this.triggerEvent('connect');
      this.startPolling();
    }

    disconnect() {
      console.log('📱 Socket desconectando...');
      this.connected = false;
      this.stopPolling();
      this.triggerEvent('disconnect');
    }

    startPolling() {
      if (this.pollingInterval) return;
      
      console.log('🔄 Iniciando polling cada 10 segundos...');
      
      // Poll inmediato
      this.checkForUpdates();
      
      // Polling regular
      this.pollingInterval = setInterval(() => {
        if (this.connected) {
          this.checkForUpdates();
        }
      }, 10000); // 10 segundos
    }

    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    }

    async checkForUpdates() {
      try {
        const response = await window.apiRequest('/api/pedidos-domiciliario-con-distancias');
        
        if (!response.ok) {
          console.error('❌ Error en polling:', response.status);
          return;
        }

        const pedidos = await response.json();
        
        // Detectar cambios
        this.detectarCambios(pedidos);
        
      } catch (error) {
        console.error('❌ Error en checkForUpdates:', error);
      }
    }

    detectarCambios(pedidosNuevos) {
      if (!this.lastPedidosState) {
        this.lastPedidosState = pedidosNuevos;
        return;
      }

      // Detectar nuevos pedidos disponibles
      const disponiblesNuevos = pedidosNuevos.filter(p => 
        p.estado === 'esperando repartidor' &&
        !this.lastPedidosState.some(old => old.id === p.id && old.estado === 'esperando repartidor')
      );

      // Detectar pedidos que cambiaron de estado
      pedidosNuevos.forEach(pedidoNuevo => {
        const pedidoViejo = this.lastPedidosState.find(p => p.id === pedidoNuevo.id);
        
        if (pedidoViejo && pedidoViejo.estado !== pedidoNuevo.estado) {
          console.log(`🔄 Estado cambió: Pedido ${pedidoNuevo.id} de '${pedidoViejo.estado}' a '${pedidoNuevo.estado}'`);
          
          this.triggerEvent('estado-pedido-actualizado', {
            pedidoId: pedidoNuevo.id,
            estadoAnterior: pedidoViejo.estado,
            nuevoEstado: pedidoNuevo.estado
          });
        }
      });

      // Notificar nuevos pedidos disponibles
      disponiblesNuevos.forEach(pedido => {
        console.log(`📦 Nuevo pedido disponible detectado: ${pedido.id}`);
        
        // Simular evento geográfico
        this.triggerEvent('nuevo-pedido-geografico', {
          pedido: pedido,
          distancia: pedido.distancia_al_restaurante || 0,
          conexion_inicial: false
        });
      });

      // Detectar pedidos removidos
      const pedidosRemovidos = this.lastPedidosState.filter(viejo => 
        viejo.estado === 'esperando repartidor' &&
        !pedidosNuevos.some(nuevo => nuevo.id === viejo.id && nuevo.estado === 'esperando repartidor')
      );

      pedidosRemovidos.forEach(pedido => {
        console.log(`🗑️ Pedido removido detectado: ${pedido.id}`);
        this.triggerEvent('pedido-removido', {
          pedidoId: pedido.id
        });
      });

      this.lastPedidosState = pedidosNuevos;
    }

    triggerEvent(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            console.error(`❌ Error en callback para ${event}:`, error);
          }
        });
      }
    }
  }

  // Crear instancia global
  window.io = function() {
    if (!window.socketMockInstance) {
      console.log('📱 Creando nueva instancia de Socket Mock');
      window.socketMockInstance = new SocketMock();
      
      // Auto-conectar después de 500ms
      setTimeout(() => {
        if (window.socketMockInstance) {
          window.socketMockInstance.connect();
        }
      }, 500);
    }
    return window.socketMockInstance;
  };

  console.log('✅ Socket.IO mock v2 cargado');
})();