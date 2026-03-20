// fcm-notifications.js - V2: Sonido persistente, deep link correcto, notificaciones silenciosas

class FCMNotificationService {
  constructor() {
    this.fcmToken = null;
    this.isNative = !!window.Capacitor;
    this.notificacionesActivas = true;
    this.disponible = true; // ✅ NUEVO: Estado de disponibilidad
    
    // ✅ SONIDO PERSISTENTE: Múltiples reproducciones para no perder pedidos
    this.audio = null;
    this.alarmInterval = null;
    this.alarmTimeout = null;
    this._initAudio();
  }

  // ✅ Inicializar audio con fallbacks
  _initAudio() {
    try {
      this.audio = new Audio('/audio/notificacion.mp3');
      this.audio.volume = 0.9;
      this.audio.preload = 'auto';
      // Precargar para evitar delays
      this.audio.load();
    } catch (e) {
      console.warn('⚠️ No se pudo crear Audio object:', e);
    }
  }

  /**
   * ✅ NUEVO: Reproducir sonido de alarma persistente
   * Se repite cada 4 segundos durante 30 segundos (o hasta que el usuario interactúe)
   * Así el domiciliario NO pierde ningún pedido
   */
  reproducirAlarma() {
    // Limpiar alarma anterior si existe
    this.detenerAlarma();

    if (!this.notificacionesActivas || !this.audio) return;

    console.log('🔔 Iniciando alarma de nuevo pedido...');

    const reproducirSonido = () => {
      try {
        // Clonar el audio para poder reproducir múltiples veces sin esperar
        const sonido = this.audio.cloneNode();
        sonido.volume = 0.9;
        sonido.play().catch(err => {
          console.warn('⚠️ Error reproduciendo sonido:', err);
          // ✅ Fallback: Usar vibración si el sonido falla
          this._vibrar();
        });
      } catch (e) {
        console.warn('⚠️ Error en reproducción:', e);
        this._vibrar();
      }
    };

    // Reproducir inmediatamente
    reproducirSonido();
    // ✅ También vibrar para reforzar
    this._vibrar();

    // ✅ Repetir cada 4 segundos
    this.alarmInterval = setInterval(() => {
      reproducirSonido();
      this._vibrar();
    }, 4000);

    // ✅ Auto-detener después de 30 segundos para no molestar infinitamente
    this.alarmTimeout = setTimeout(() => {
      this.detenerAlarma();
      console.log('🔕 Alarma auto-detenida después de 30s');
    }, 30000);
  }

  /**
   * ✅ NUEVO: Reproducir sonido suave (1 sola vez) para notificaciones silenciosas
   */
  reproducirSonidoSuave() {
    if (!this.audio) return;
    try {
      const sonido = this.audio.cloneNode();
      sonido.volume = 0.2; // Volumen bajo
      sonido.play().catch(() => {});
    } catch (e) {}
  }

  /**
   * ✅ Detener alarma (llamado al interactuar o auto-stop)
   */
  detenerAlarma() {
    if (this.alarmInterval) {
      clearInterval(this.alarmInterval);
      this.alarmInterval = null;
    }
    if (this.alarmTimeout) {
      clearTimeout(this.alarmTimeout);
      this.alarmTimeout = null;
    }
  }

  /**
   * ✅ Vibrar el dispositivo
   */
  _vibrar() {
    try {
      if (navigator.vibrate) {
        navigator.vibrate([300, 200, 300, 200, 300]); // Patrón de vibración urgente
      }
      // ✅ Usar Haptics de Capacitor si está disponible
      if (this.isNative && window.Capacitor?.Plugins?.Haptics) {
        window.Capacitor.Plugins.Haptics.vibrate({ duration: 500 });
      }
    } catch (e) {}
  }

  /**
   * ✅ NUEVO: Actualizar estado de disponibilidad
   */
  setDisponible(estado) {
    this.disponible = estado;
    console.log(`📱 FCM disponibilidad actualizada: ${estado ? 'DISPONIBLE' : 'NO DISPONIBLE'}`);
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
        
        // ✅ NUEVO: Cargar estado de disponibilidad
        await this._cargarDisponibilidad();
        
        // ✅ Pre-cargar audio tocando el DOM (necesario en algunos Android)
        this._prewarmAudio();
        
        console.log('✅ FCM inicializado correctamente (v2)');
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

  /**
   * ✅ Pre-calentar el audio context (necesario en Android WebView)
   */
  _prewarmAudio() {
    // En Android WebView, el audio necesita una interacción del usuario primero
    // Reproducimos un sonido silencioso al tocar cualquier cosa
    const prewarm = () => {
      if (this.audio) {
        const silentPlay = this.audio.cloneNode();
        silentPlay.volume = 0;
        silentPlay.play().then(() => {
          silentPlay.pause();
          console.log('✅ Audio pre-calentado');
        }).catch(() => {});
      }
      document.removeEventListener('touchstart', prewarm);
      document.removeEventListener('click', prewarm);
    };
    document.addEventListener('touchstart', prewarm, { once: true });
    document.addEventListener('click', prewarm, { once: true });
  }

  async _cargarDisponibilidad() {
    try {
      const response = await window.apiRequest('/api/domiciliarios/domiciliario/estado-disponibilidad');
      if (response.ok) {
        const data = await response.json();
        this.disponible = data.disponible !== false;
      }
    } catch (e) {
      console.warn('⚠️ Error cargando disponibilidad para FCM:', e);
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

    // 🔥 NOTIFICACIÓN RECIBIDA (app en primer plano)
    PushNotifications.addListener('pushNotificationReceived', async (notification) => {
      console.log('📬 Notificación FCM recibida (foreground):', notification);
      
      const data = notification.data || {};
      
      // ✅ VERIFICAR SI ES NOTIFICACIÓN DE "DESPERTAR" para ubicación
      if (data.type === 'wake_for_location') {
        console.log('⏰ Notificación de despertar - Actualizando ubicación...');
        if (window.unifiedGeoService) {
          await window.unifiedGeoService.forceUpdate();
        }
        return;
      }
      
      // ✅ NUEVO PEDIDO
      if (data.tipo === 'nuevo_pedido') {
        console.log('⚡ Nuevo pedido via FCM');
        
        // ✅ Recargar lista inmediatamente
        if (window.socketMockInstance) {
          window.socketMockInstance.forceCheck();
        }
        if (typeof window.cargarPedidos === 'function') {
          window.cargarPedidos();
        }

        // ✅ LÓGICA DE SONIDO SEGÚN DISPONIBILIDAD
        if (this.disponible) {
          // DISPONIBLE: Alarma persistente (repetida) para no perder el pedido
          this.reproducirAlarma();
          console.log('🔔 Alarma persistente activada (domiciliario disponible)');
        } else {
          // NO DISPONIBLE: Solo sonido suave informativo (1 vez)
          if (this.notificacionesActivas) {
            this.reproducirSonidoSuave();
            console.log('🔕 Sonido suave (domiciliario no disponible)');
          }
        }
        
        // ✅ Mostrar banner en la app
        this.mostrarNotificacionEnApp(notification, this.disponible);
        return;
      }
      
      // Otros tipos de notificaciones (estado cambiado, etc.)
      if (this.notificacionesActivas) {
        try {
          const sonido = this.audio.cloneNode();
          sonido.volume = 0.7;
          sonido.play().catch(() => {});
        } catch (e) {}
      }
      
      this.mostrarNotificacionEnApp(notification, true);
    });

    // 👆 NOTIFICACIÓN TOCADA (deep link)
    PushNotifications.addListener('pushNotificationActionPerformed', async (action) => {
      console.log('👆 Notificación tocada:', action);
      
      const data = action.notification.data || {};
      
      // ✅ Ignorar notificaciones de ubicación
      if (data.type === 'wake_for_location') {
        if (window.unifiedGeoService) {
          window.unifiedGeoService.forceUpdate();
        }
        return;
      }
      
      // ✅ DETENER ALARMA al tocar la notificación
      this.detenerAlarma();
      
      // ✅ DEEP LINK CORRECTO: Navegar a la página de pedidos
      if (data.tipo === 'nuevo_pedido' || data.pedidoId) {
        // La app ya debería estar en inicio_domi.html
        // Si estamos en la página correcta, solo recargar y navegar al tab correcto
        if (window.location.pathname.includes('inicio_domi.html')) {
          // Navegar al tab de pedidos disponibles o activos
          if (typeof window.navigateTo === 'function') {
            window.navigateTo('pedidos');
          }
          if (typeof window.cargarPedidos === 'function') {
            window.cargarPedidos();
          }
        } else {
          // Si estamos en otra página, redirigir a inicio_domi
          window.location.href = '/inicio_domi.html';
        }
        return;
      }
      
      // ✅ Fallback: siempre abrir la app en la página principal de domiciliarios
      if (!window.location.pathname.includes('inicio_domi.html')) {
        window.location.href = '/inicio_domi.html';
      }
    });
    
    console.log('✅ Listeners FCM configurados (v2 - alarma persistente + deep link)');
  }

  /**
   * ✅ MEJORADO: Banner en-app con botón para detener alarma
   */
  mostrarNotificacionEnApp(notification, esDisponible) {
    const existente = document.getElementById('fcm-notification-banner');
    if (existente) existente.remove();
    
    const notifDiv = document.createElement('div');
    notifDiv.id = 'fcm-notification-banner';
    
    const bgColor = esDisponible ? '#ffffff' : '#f1f5f9';
    const borderColor = esDisponible ? '#22c55e' : '#94a3b8';
    const titulo = notification.title || (esDisponible ? '📦 Nuevo pedido cercano' : '📦 Nuevo pedido (informativo)');
    const cuerpo = notification.body || (esDisponible ? '¡Tienes un nuevo pedido disponible!' : 'Hay un nuevo pedido. Activa tu disponibilidad para tomarlo.');
    
    notifDiv.innerHTML = `
      <div style="flex:1;min-width:0;">
        <h4 style="margin:0 0 4px 0;font-size:0.95rem;font-weight:700;color:#1e293b;">${titulo}</h4>
        <p style="margin:0;font-size:0.85rem;color:#64748b;line-height:1.3;">${cuerpo}</p>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
        ${esDisponible ? `<button onclick="window.fcmNotificationService.detenerAlarma();if(typeof navigateTo==='function')navigateTo('pedidos');this.closest('#fcm-notification-banner').remove();" style="background:#22c55e;color:white;border:none;padding:8px 14px;border-radius:8px;font-size:0.8rem;font-weight:600;cursor:pointer;">Ver pedido</button>` : ''}
        <button onclick="window.fcmNotificationService.detenerAlarma();this.closest('#fcm-notification-banner').remove();" style="background:none;border:none;color:#94a3b8;font-size:1.2rem;cursor:pointer;padding:4px;">✕</button>
      </div>
    `;
    
    notifDiv.style.cssText = `
      position: fixed;
      top: 12px;
      left: 12px;
      right: 12px;
      background: ${bgColor};
      padding: 14px 16px;
      border-radius: 14px;
      border-left: 4px solid ${borderColor};
      box-shadow: 0 8px 30px rgba(0,0,0,0.2);
      z-index: 10001;
      display: flex;
      align-items: center;
      gap: 12px;
      animation: slideDown 0.3s ease;
    `;
    
    document.body.appendChild(notifDiv);
    
    // Auto-remover después de 15 segundos (más tiempo para que lo vea)
    setTimeout(() => {
      if (notifDiv.parentElement) {
        notifDiv.style.transition = 'all 0.3s ease';
        notifDiv.style.opacity = '0';
        notifDiv.style.transform = 'translateY(-20px)';
        setTimeout(() => notifDiv.remove(), 300);
      }
    }, 15000);
  }

  /**
   * ✅ MEJORADO: Notificación local con canal correcto según disponibilidad
   */
  async mostrarNotificacionLocal(notification, esDisponible) {
    try {
      const { LocalNotifications } = window.Capacitor.Plugins;
      
      if (!LocalNotifications) {
        console.warn('❌ LocalNotifications no disponible');
        return;
      }

      // ✅ Elegir canal según disponibilidad y configuración de sonido
      let channelId = 'pedidos_channel'; // Con sonido por defecto
      
      if (!esDisponible) {
        channelId = 'pedidos_silent_channel'; // Silencioso si no está disponible
      } else if (!this.notificacionesActivas) {
        channelId = 'pedidos_silent_channel'; // Silencioso si desactivó sonido
      }

      const titulo = esDisponible 
        ? (notification.title || '📦 ¡Nuevo pedido disponible!')
        : (notification.title || '📦 Nuevo pedido (informativo)');
      
      const cuerpo = esDisponible
        ? (notification.body || '¡Tienes un nuevo pedido cercano! Tócalo para verlo.')
        : (notification.body || 'Hay un nuevo pedido. Activa tu disponibilidad para tomarlo.');

      await LocalNotifications.schedule({
        notifications: [
          {
            title: titulo,
            body: cuerpo,
            id: Math.floor(Math.random() * 1000000),
            channelId: channelId,
            sound: (this.notificacionesActivas && esDisponible) ? 'notificacion.mp3' : null,
            smallIcon: 'ic_stat_icon_config_sample',
            iconColor: esDisponible ? '#22c55e' : '#94a3b8',
            extra: {
              pedidoId: notification.data?.pedidoId || null,
              tipo: 'nuevo_pedido'
            },
            // ✅ Alta prioridad para que se muestre como heads-up
            importance: esDisponible ? 5 : 3
          }
        ]
      });

      console.log(`✅ Notificación local programada (${esDisponible ? 'con sonido' : 'silenciosa'})`);
      
    } catch (error) {
      console.error('❌ Error mostrando notificación local:', error);
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

  async activarNotificaciones() {
    this.notificacionesActivas = true;
    
    try {
      const response = await window.apiRequest('/api/domiciliarios/domiciliario/configuracion-notificaciones', {
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
      const response = await window.apiRequest('/api/domiciliarios/domiciliario/configuracion-notificaciones', {
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
      const response = await window.apiRequest('/api/domiciliarios/domiciliario/configuracion-notificaciones');
      
      if (response.ok) {
        const data = await response.json();
        this.notificacionesActivas = data.notificaciones_sonido !== false;
        console.log(`📊 Estado sonido: ${this.notificacionesActivas ? 'CON sonido' : 'SIN sonido'}`);
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
console.log('✅ FCMNotificationService v2 cargado (alarma persistente + deep link + silenciosas)');