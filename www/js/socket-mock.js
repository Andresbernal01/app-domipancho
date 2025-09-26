// socket-mock.js - Reemplazo de Socket.IO para app móvil
(function() {
  'use strict';
  
  // Mock de Socket.IO para la app móvil
  class SocketMock {
    constructor() {
      this.connected = false;
      this.listeners = {};
      this.reconnectAttempts = 0;
      this.maxReconnectAttempts = 5;
      this.reconnectInterval = 5000;
      this.pollingInterval = null;
    }

    on(event, callback) {
      if (!this.listeners[event]) {
        this.listeners[event] = [];
      }
      this.listeners[event].push(callback);
      console.log(`📱 Socket mock: Registrado listener para '${event}'`);
    }

    emit(event, data) {
      console.log(`📱 Socket mock: Emitiendo '${event}':`, data);
      // En una app móvil real, aquí harías polling o push notifications
    }

    connect() {
      console.log('📱 Socket mock: Simulando conexión...');
      this.connected = true;
      this.emit('connect');
      this.startPolling();
    }

    disconnect() {
      console.log('📱 Socket mock: Desconectando...');
      this.connected = false;
      this.stopPolling();
      this.emit('disconnect');
    }

    // Simular polling para reemplazar eventos en tiempo real
    startPolling() {
      if (this.pollingInterval) return;
      
      this.pollingInterval = setInterval(async () => {
        if (!this.connected) return;
        
        try {
          // Verificar si hay nuevos pedidos
          await this.checkForUpdates();
        } catch (error) {
          console.error('Error en polling:', error);
        }
      }, window.APP_CONFIG?.POLLING_INTERVAL || 30000);
    }

    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    }

    async checkForUpdates() {
      try {
        // Simular verificación de actualizaciones
        const response = await window.apiRequest('/api/pedidos-domiciliario');
        
        if (response.ok) {
          const pedidos = await response.json();
          
          // Detectar cambios y emitir eventos simulados
          this.handlePedidosUpdate(pedidos);
        }
      } catch (error) {
        console.error('Error verificando actualizaciones:', error);
      }
    }

    handlePedidosUpdate(pedidos) {
      // Lógica para detectar cambios en pedidos
      const pedidosDisponibles = pedidos.filter(p => p.estado === 'esperando repartidor');
      const pedidosActivos = pedidos.filter(p => p.estado === 'camino a tu casa');
      
      // Simular evento de actualización
      this.triggerEvent('estado-pedido-actualizado', {
        pedidosDisponibles: pedidosDisponibles.length,
        pedidosActivos: pedidosActivos.length
      });
    }

    triggerEvent(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(callback => {
          try {
            callback(data);
          } catch (error) {
            console.error(`Error ejecutando callback para ${event}:`, error);
          }
        });
      }
    }
  }

  // Crear instancia global
  window.io = function() {
    if (!window.socketMockInstance) {
      window.socketMockInstance = new SocketMock();
      // Auto-conectar después de un pequeño delay
      setTimeout(() => {
        window.socketMockInstance.connect();
      }, 1000);
    }
    return window.socketMockInstance;
  };

  // Funciones de utilidad
  window.io.connect = window.io;
  
  console.log('📱 Socket.IO mock inicializado para app móvil');
})();