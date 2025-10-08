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
        // Obtener usuario actual primero
        const userResponse = await window.apiRequest('/api/usuario-actual');
        if (!userResponse.ok) return;
        const usuario = await userResponse.json();
        
        const response = await window.apiRequest('/api/pedidos-domiciliario-con-distancias');
        
        if (!response.ok) {
          console.error('❌ Error en polling:', response.status);
          return;
        }

        const pedidos = await response.json();
        
        // Detectar cambios con el ID del usuario
        this.detectarCambios(pedidos, usuario.id);
        
      } catch (error) {
        console.error('❌ Error en checkForUpdates:', error);
      }
    }

    detectarCambios(pedidosNuevos, usuarioId) {
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

      // ✅ DETECTAR PEDIDOS QUE DEBEN REMOVERSE
      const pedidosRemovidos = this.lastPedidosState.filter(viejo => {
        const pedidoNuevo = pedidosNuevos.find(nuevo => nuevo.id === viejo.id);
        
        // Caso 1: El pedido ya no existe
        if (!pedidoNuevo) return true;
        
        // Caso 2: Era "esperando repartidor" y ahora está en otro estado
        // PERO: Solo remover si NO es mi pedido
        if (viejo.estado === 'esperando repartidor' && pedidoNuevo.estado !== 'esperando repartidor') {
          // Si es mi pedido (asignado a mí), NO remover
          if (pedidoNuevo.domiciliario_id === usuarioId) {
            console.log(`✋ Pedido ${pedidoNuevo.id} es mío, NO remover`);
            return false;
          }
          // Si lo tomó otro domiciliario, SÍ remover
          console.log(`🚫 Pedido ${pedidoNuevo.id} tomado por otro, remover`);
          return true;
        }
        
        // Caso 3: Estados finales
        if (pedidoNuevo.estado === 'entregado' || pedidoNuevo.estado === 'cancelado') {
          return true;
        }
        
        return false;
      });

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