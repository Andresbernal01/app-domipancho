// fcm-notifications.js - Sistema de notificaciones FCM (SIN imports ES6)
class FCMNotificationService {
    constructor() {
      this.fcmToken = null;
      this.isNative = !!window.Capacitor;
      this.notificacionesActivas = true; // Por defecto activadas
      this.audio = new Audio('/audio/notificacion.mp3');
      this.audio.volume = 0.7;
    }
  
    async inicializar() {
      if (!this.isNative) {
        console.log('📱 No es entorno nativo, FCM no disponible');
        return false;
      }
  
      try {
        // Acceder a PushNotifications desde Capacitor.Plugins
        const { PushNotifications } = window.Capacitor.Plugins;
        
        if (!PushNotifications) {
          console.warn('⚠️ Plugin PushNotifications no disponible');
          return false;
        }
        
        // Solicitar permisos
        const result = await PushNotifications.requestPermissions();
        
        if (result.receive === 'granted') {
          // Registrar dispositivo
          await PushNotifications.register();
          
          // Configurar listeners
          this.configurarListeners();
          
          console.log('✅ FCM inicializado correctamente');
          return true;
        } else {
          console.warn('⚠️ Permisos de notificaciones denegados');
          return false;
        }
      } catch (error) {
        console.error('❌ Error inicializando FCM:', error);
        return false;
      }
    }
  
    configurarListeners() {
      const { PushNotifications } = window.Capacitor.Plugins;
      
      // Token FCM recibido
      PushNotifications.addListener('registration', (token) => {
        this.fcmToken = token.value;
        console.log('🔑 FCM Token recibido:', token.value);
        
        // Guardar token en el servidor
        this.guardarTokenEnServidor(token.value);
      });
  
      // Error en registro
      PushNotifications.addListener('registrationError', (error) => {
        console.error('❌ Error en registro FCM:', error);
      });
  
      // Notificación recibida mientras app está abierta
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('📬 Notificación FCM recibida:', notification);
        
        // Reproducir sonido si las notificaciones están activas
        if (this.notificacionesActivas) {
          this.audio.play().catch(console.error);
          console.log('🔔 Sonido reproducido');
        } else {
          console.log('🔕 Notificación silenciosa (sonido desactivado)');
        }
        
        // Mostrar banner en la app
        this.mostrarNotificacionEnApp(notification);
      });
  
      // Notificación tocada (cuando la app está cerrada/background)
      PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        console.log('👆 Notificación tocada:', action);
        
        const data = action.notification.data;
        if (data.pedidoId) {
          // Redirigir a la página de pedidos
          window.location.href = `/domiciliarios.html?id=${data.pedidoId}`;
        }
      });
      
      console.log('✅ Listeners FCM configurados');
    }
  
    async guardarTokenEnServidor(token) {
      try {
        const response = await window.apiRequest('/api/domiciliario/fcm-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fcm_token: token })
        });
  
        if (response.ok) {
          console.log('✅ Token FCM guardado en servidor');
        } else {
          console.error('❌ Error guardando token FCM');
        }
      } catch (error) {
        console.error('❌ Error en guardarTokenEnServidor:', error);
      }
    }
  
    mostrarNotificacionEnApp(notification) {
      // Remover notificación anterior si existe
      const existente = document.getElementById('fcm-notification-banner');
      if (existente) existente.remove();
      
      const notifDiv = document.createElement('div');
      notifDiv.id = 'fcm-notification-banner';
      notifDiv.className = 'fcm-notification-banner';
      notifDiv.innerHTML = `
        <div class="fcm-notification-content">
          <h4>${notification.title || '📦 Nuevo pedido'}</h4>
          <p>${notification.body || 'Tienes un nuevo pedido disponible'}</p>
        </div>
        <button onclick="this.parentElement.remove()">✕</button>
      `;
      
      // Agregar estilos inline
      notifDiv.style.cssText = `
        position: fixed;
        top: 20px;
        left: 20px;
        right: 20px;
        background: white;
        padding: 15px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 10000;
        display: flex;
        justify-content: space-between;
        align-items: center;
        animation: slideDown 0.3s ease;
      `;
      
      document.body.appendChild(notifDiv);
      
      // Auto-remover después de 8 segundos
      setTimeout(() => {
        if (notifDiv.parentElement) {
          notifDiv.style.opacity = '0';
          setTimeout(() => notifDiv.remove(), 300);
        }
      }, 8000);
    }
  
    activarNotificaciones() {
      this.notificacionesActivas = true;
      localStorage.setItem('notificaciones_activas', 'true');
      console.log('🔔 Notificaciones con sonido ACTIVADAS');
    }
  
    desactivarNotificaciones() {
      this.notificacionesActivas = false;
      localStorage.setItem('notificaciones_activas', 'false');
      console.log('🔕 Notificaciones SILENCIOSAS (sin sonido)');
    }
  
    cargarEstadoNotificaciones() {
      const estado = localStorage.getItem('notificaciones_activas');
      // Por defecto activadas si no hay valor guardado
      this.notificacionesActivas = estado !== 'false';
      return this.notificacionesActivas;
    }
  
    obtenerToken() {
      return this.fcmToken;
    }
  }
  
  // Exportar instancia global
  window.fcmNotificationService = new FCMNotificationService();
  console.log('✅ FCMNotificationService cargado');