// notification-service.js - Versión corregida para Capacitor
class MobileNotificationService {
    constructor() {
      this.isNative = !!window.Capacitor;
      this.LocalNotifications = null;
      this.notificationId = 1;
      this.audio = new Audio('/audio/notificacion.mp3');
      this.init();
    }
  
    async init() {
      if (this.isNative) {
        try {
          // Acceder a LocalNotifications desde Capacitor.Plugins
          this.LocalNotifications = window.Capacitor.Plugins.LocalNotifications;
          
          if (!this.LocalNotifications) {
            console.warn('⚠️ Plugin LocalNotifications no disponible');
            return;
          }
          
          // Solicitar permisos
          await this.requestPermissions();
          
          // Configurar listeners
          this.setupListeners();
          
          console.log('✅ LocalNotifications inicializado');
        } catch (error) {
          console.error('❌ Error inicializando LocalNotifications:', error);
        }
      } else {
        // Fallback para navegador web
        if ('Notification' in window) {
          await Notification.requestPermission();
        }
      }
    }
  
    async requestPermissions() {
      try {
        const result = await this.LocalNotifications.requestPermissions();
        console.log('📱 Permisos de notificación:', result.display);
        return result.display === 'granted';
      } catch (error) {
        console.error('❌ Error solicitando permisos:', error);
        return false;
      }
    }
  
    setupListeners() {
      if (!this.LocalNotifications) return;
      
      // Manejar click en notificación
      this.LocalNotifications.addListener('localNotificationActionPerformed', (notification) => {
        console.log('🔔 Notificación clickeada:', notification);
        
        // Redirigir a pedidos si la app está en background
        if (notification.notification.extra?.pedidoId) {
          window.location.href = `/domiciliarios.html?id=${notification.notification.extra.pedidoId}`;
        }
      });
    }
  
    async showNotification(title, options = {}) {
      if (this.isNative && this.LocalNotifications) {
        try {
          // Notificación nativa con prioridad alta
          await this.LocalNotifications.schedule({
            notifications: [{
              id: this.notificationId++,
              title: title,
              body: options.body || '',
              sound: 'notificacion.mp3',
              smallIcon: 'ic_stat_icon_config_sample',
              iconColor: '#facc15',
              channelId: 'pedidos_channel',
              extra: options.data || {},
              ongoing: false,
              autoCancel: true
            }]
          });
  
          // Vibración usando Haptics si está disponible
          if (window.Capacitor?.Plugins?.Haptics) {
            try {
              await window.Capacitor.Plugins.Haptics.impact({ style: 'HEAVY' });
            } catch (e) {
              console.warn('Vibración no disponible');
            }
          }
  
          console.log('✅ Notificación nativa enviada');
        } catch (error) {
          console.error('❌ Error mostrando notificación:', error);
          this.fallbackNotification(title, options);
        }
      } else {
        this.fallbackNotification(title, options);
      }
  
      // Reproducir sonido adicional
      this.audio.play().catch(console.error);
    }
  
    fallbackNotification(title, options) {
      // Fallback para web
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(title, {
          body: options.body || '',
          icon: options.icon || '/img/logo.png',
          badge: '/img/logo.png',
          vibrate: [200, 100, 200],
          requireInteraction: true,
          tag: 'pedido-notification'
        });
      }
    }
  
    async createNotificationChannel() {
      if (this.isNative && this.LocalNotifications) {
        try {
          await this.LocalNotifications.createChannel({
            id: 'pedidos_channel',
            name: 'Nuevos Pedidos',
            description: 'Notificaciones de nuevos pedidos disponibles',
            importance: 5,
            visibility: 1,
            sound: 'notificacion.mp3',
            vibration: true,
            lights: true,
            lightColor: '#facc15'
          });
          console.log('✅ Canal de notificaciones creado');
        } catch (error) {
          console.error('❌ Error creando canal:', error);
        }
      }
    }
  }
  
  // Exportar instancia global
  window.MobileNotificationService = MobileNotificationService;