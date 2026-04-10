// socket-mock.js - Socket.IO mock optimizado para Capacitor
// FCM es el canal principal, este polling es el respaldo
// ✅ v4: Cache de usuarioId — no pide /api/usuario-actual en cada poll
(function() {
  'use strict';
  
  class SocketMock {
    constructor() {
      this.connected = false;
      this.listeners = {};
      this.pollingInterval = null;
      this.lastPedidosState = null;
      this.usuarioId = null;
      this.isPolling = false; // Evitar polls simultáneos
      this._usuarioFetchPromise = null; // Evitar fetches duplicados del usuario
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
      
      // ✅ Polling cada 5 segundos
      const POLLING_MS = 5000;
      console.log(`🔄 Iniciando polling cada ${POLLING_MS / 1000} segundos...`);
      
      // Poll inmediato
      this.checkForUpdates();
      
      // Polling regular
      this.pollingInterval = setInterval(() => {
        if (this.connected && !document.hidden) {
          this.checkForUpdates();
        }
      }, POLLING_MS);
    }

    stopPolling() {
      if (this.pollingInterval) {
        clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }
    }

    /**
     * ✅ OPTIMIZACIÓN: Obtener usuarioId con cache
     * 1. Si ya está en memoria → devolverlo instantáneamente
     * 2. Si domiciliario.js lo tiene cacheado → usar ese
     * 3. Solo como último recurso, hacer fetch
     */
    async getUsuarioId() {
      if (this.usuarioId) return this.usuarioId;

      // Intentar usar cache global de domiciliario.js
      if (typeof window.__getUsuarioCache === 'function') {
        const cached = window.__getUsuarioCache();
        if (cached && cached.id) {
          this.usuarioId = cached.id;
          return this.usuarioId;
        }
      }

      // Evitar fetches duplicados si ya hay uno en curso
      if (this._usuarioFetchPromise) return this._usuarioFetchPromise;

      this._usuarioFetchPromise = (async () => {
        try {
          const res = await window.apiRequest('/api/usuario-actual');
          if (!res.ok) return null;
          const usuario = await res.json();
          this.usuarioId = usuario.id;
          return usuario.id;
        } catch (err) {
          console.error('❌ Error obteniendo usuario:', err);
          return null;
        } finally {
          this._usuarioFetchPromise = null;
        }
      })();

      return this._usuarioFetchPromise;
    }

    async checkForUpdates() {
      // ✅ Evitar polls simultáneos
      if (this.isPolling) return;
      this.isPolling = true;

      try {
        // ✅ OPTIMIZACIÓN: usuarioId cacheado — no se pide en cada poll
        // (antes eran 2 requests, ahora solo 1)
        const usuarioId = await this.getUsuarioId();
        if (!usuarioId) {
          console.warn('⚠️ No hay usuarioId disponible, saltando poll');
          return;
        }

        const response = await window.apiRequest('/api/domiciliarios/pedidos-domiciliario-con-distancias');
        
        if (!response.ok) {
          console.error('❌ Error en polling:', response.status);
          return;
        }

        const pedidos = await response.json();
        this.detectarCambios(pedidos, usuarioId);
        
      } catch (error) {
        console.error('❌ Error en checkForUpdates:', error);
      } finally {
        this.isPolling = false;
      }
    }

    /**
     * ✅ Forzar una verificación inmediata (llamado por FCM)
     */
    forceCheck() {
      console.log('⚡ Verificación forzada por FCM');
      this.isPolling = false; // Reset para permitir verificación inmediata
      this.checkForUpdates();
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
        
        this.triggerEvent('nuevo-pedido', {
          pedidoId: pedido.id,
          mensaje: 'Nuevo pedido disponible',
          timestamp: new Date().toISOString()
        });
      });

      // ✅ DETECTAR PEDIDOS QUE DEBEN REMOVERSE
      const pedidosRemovidos = this.lastPedidosState.filter(viejo => {
        const pedidoNuevo = pedidosNuevos.find(nuevo => nuevo.id === viejo.id);
        
        if (!pedidoNuevo) return true;
        
        if (viejo.estado === 'esperando repartidor' && pedidoNuevo.estado !== 'esperando repartidor') {
          if (pedidoNuevo.domiciliario_id === usuarioId) {
            console.log(`✋ Pedido ${pedidoNuevo.id} es mío, NO remover`);
            return false;
          }
          console.log(`🚫 Pedido ${pedidoNuevo.id} tomado por otro, remover`);
          return true;
        }
        
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
      
      // ✅ Auto-conectar inmediatamente
      setTimeout(() => {
        if (window.socketMockInstance) {
          window.socketMockInstance.connect();
        }
      }, 100);
    }
    return window.socketMockInstance;
  };

  console.log('✅ Socket.IO mock v4 cargado (cache usuarioId)');
})();