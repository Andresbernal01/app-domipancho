// fcm-notifications.js - CON SOPORTE PARA DESPERTAR APP

class FCMNotificationService {
  constructor() {
    this.fcmToken = null;
    this.isNative = !!window.Capacitor;
    this.notificacionesActivas = true;
    this.audio = new Audio('/audio/notificacion.mp3');
    this.audio.volume = 0.7;
  }

  async inicializar() {
    if (!this.isNative) {
      console.log('📱 No es entorno nativo, FCM no disponible');
      return false;
    }

    try {
      const { PushNotifications } = window.Capacitor.Plugins;
      
      if (!PushNotifications) {
        console.warn('⚠️ Plugin PushNotifications no disponible');
        return false;
      }
      
      const result = await PushNotifications.requestPermissions();
      
      if (result.receive === 'granted') {
        await PushNotifications.register();
        this.configurarListeners();
        await this.cargarEstadoNotificacionesServidor();
        
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
      this.guardarTokenEnServidor(token.value);
    });

    // Error en registro
    PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ Error en registro FCM:', error);
    });

    // 📥 NOTIFICACIÓN RECIBIDA (app abierta o cerrada)
    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      console.log('📬 Notificación FCM recibida:', notification);
      
      // ✅ VERIFICAR SI ES NOTIFICACIÓN DE "DESPERTAR"
      const data = notification.data || {};
      
      if (data.type === 'wake_for_location') {
        console.log('⏰ Notificación de despertar recibida - Actualizando ubicación...');
        
        // Forzar actualización de ubicación
        if (window.unifiedGeoService) {
          await window.unifiedGeoService.forceUpdate();
        }
        
        // NO reproducir sonido para este tipo
        return;
      }
      
      // Para otras notificaciones, reproducir sonido según configuración
      if (this.notificacionesActivas) {
        this.audio.play().catch(console.error);
        console.log('🔔 Sonido reproducido');
      } else {
        console.log('🔕 Notificación silenciosa (sonido desactivado)');
      }
      
      // Mostrar notificación local
      this.mostrarNotificacionLocal(notification);
    });

    // 👆 Notificación tocada
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('👆 Notificación tocada:', action);
      
      const data = action.notification.data;
      
      // Si es de despertar, solo actualizar ubicación
      if (data.type === 'wake_for_location') {
        if (window.unifiedGeoService) {
          window.unifiedGeoService.forceUpdate();
        }
        return;
      }
      
      // Para pedidos, redirigir a la página
      if (data.pedidoId) {
        window.location.href = `/domiciliarios.html?id=${data.pedidoId}`;
      }
    });
    
    console.log('✅ Listeners FCM configurados');
  }

  async mostrarNotificacionLocal(notification) {
    try {
      console.log('🔔 Intentando mostrar notificación local...');
      const { LocalNotifications } = window.Capacitor.Plugins;
      
      if (!LocalNotifications) {
        console.warn('❌ LocalNotifications no disponible');
        this.mostrarNotificacionEnApp(notification);
        return;
      }
  
      console.log('✅ LocalNotifications disponible, programando notificación...');

      const result = await LocalNotifications.schedule({
        notifications: [
          {
            title: notification.title || '📦 Nuevo pedido cercano',
            body: notification.body || 'Tienes un nuevo pedido disponible',
            id: Math.floor(Math.random() * 1000000),
            sound: this.notificacionesActivas ? 'notificacion.mp3' : null,
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: '#facc15',
            extra: {
              pedidoId: notification.data?.pedidoId || null
            }
          }
        ]
      });
  
      console.log('✅ Notificación local programada:', result);
      this.mostrarNotificacionEnApp(notification);
      
    } catch (error) {
      console.error('❌ Error mostrando notificación local:', error);
      this.mostrarNotificacionEnApp(notification);
    }
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
    
    setTimeout(() => {
      if (notifDiv.parentElement) {
        notifDiv.style.opacity = '0';
        setTimeout(() => notifDiv.remove(), 300);
      }
    }, 8000);
  }

  async activarNotificaciones() {
    this.notificacionesActivas = true;
    
    try {
      const response = await window.apiRequest('/api/domiciliario/configuracion-notificaciones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificaciones_sonido: true })
      });

      if (response.ok) {
        console.log('🔔 Notificaciones con sonido ACTIVADAS');
      }
    } catch (error) {
      console.error('❌ Error guardando configuración:', error);
    }
  }

  async desactivarNotificaciones() {
    this.notificacionesActivas = false;
    
    try {
      const response = await window.apiRequest('/api/domiciliario/configuracion-notificaciones', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificaciones_sonido: false })
      });

      if (response.ok) {
        console.log('🔕 Notificaciones SILENCIOSAS');
      }
    } catch (error) {
      console.error('❌ Error guardando configuración:', error);
    }
  }

  async cargarEstadoNotificacionesServidor() {
    try {
      const response = await window.apiRequest('/api/domiciliario/configuracion-notificaciones');
      
      if (response.ok) {
        const data = await response.json();
        this.notificacionesActivas = data.notificaciones_sonido !== false;
        console.log(`📊 Estado cargado: ${this.notificacionesActivas ? 'CON sonido' : 'SIN sonido'}`);
        return this.notificacionesActivas;
      }
    } catch (error) {
      console.error('❌ Error cargando configuración:', error);
    }
    
    return true;
  }

  obtenerToken() {
    return this.fcmToken;
  }
}

window.fcmNotificationService = new FCMNotificationService();
console.log('✅ FCMNotificationService cargado');