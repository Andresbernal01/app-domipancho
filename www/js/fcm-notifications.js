// fcm-notifications.js - V2: Sonido persistente, deep link correcto, notificaciones silenciosas

class FCMNotificationService {
  constructor() {
    this.fcmToken = null;
    this.isNative = !!window.Capacitor;
    this.notificacionesActivas = true;
    this.disponible = true; // ✅ NUEVO: Estado de disponibilidad
    
    // ✅ SONIDO PERSISTENTE EN BUCLE: suena hasta que el pedido se tome o se silencie
    this.audio = null;
    this.alarmInterval = null;
    this.alarmTimeout = null;
    this.pedidosSilenciados = new Set(); // IDs que el usuario ya atendió (Ver/cerrar/tomar)
    this._ultimosPendientes = [];        // últimos IDs en "esperando repartidor"
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
    if (!this.notificacionesActivas || !this.audio) return;

    // ✅ BUCLE: si ya está sonando, NO reiniciar (evita solapar sonidos).
    // La alarma sigue hasta que el pedido se tome o el usuario la silencie.
    if (this.alarmInterval) return;

    console.log('🔔 Iniciando alarma de nuevo pedido (bucle)...');

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

    // Reproducir inmediatamente + vibrar
    reproducirSonido();
    this._vibrar();

    // ✅ Repetir cada 4 segundos EN BUCLE mientras la app esté visible.
    // En segundo plano JS se suspende y, si sigue vivo, NO debe repetir el sonido:
    // el aviso de fondo lo da la notificación FCM (una sola vez). Así no queda
    // "pitando cada 4s" después de salir de la app.
    this.alarmInterval = setInterval(() => {
      if (document.hidden) return; // segundo plano → silencio (lo maneja FCM)
      reproducirSonido();
      this._vibrar();
    }, 4000);
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
   * ✅ NUEVO: Decide si la alarma debe sonar según los pedidos pendientes.
   * Se llama desde cargarPedidos() en cada actualización/poll, por lo que funciona
   * IGUAL estando dentro de la app (vía socket-mock) o con la app cerrada (vía FCM).
   * - Suena en bucle mientras haya pedidos pendientes SIN atender y el domiciliario
   *   pueda recibirlos (disponible y bajo el máximo).
   * - Se detiene sola cuando ya no quedan pedidos pendientes (p.ej. otro domiciliario
   *   lo tomó) o cuando el usuario la silencia (Ver / cerrar / tomar).
   * @param {Array<number>} idsPendientes IDs en estado 'esperando repartidor'
   * @param {boolean} puedeRecibir disponible y por debajo del máximo de pedidos
   */
  evaluarAlarma(idsPendientes = [], puedeRecibir = true) {
    this._ultimosPendientes = idsPendientes;

    // Limpiar silenciados que ya no están pendientes (para volver a sonar si reaparecen)
    this.pedidosSilenciados.forEach(id => {
      if (!idsPendientes.includes(id)) this.pedidosSilenciados.delete(id);
    });

    // Ocupado / al límite, o sin pedidos → detener alarma.
    // ✅ FIX: NO usar clear(). Si limpiábamos la memoria, al entregar un pedido y
    // recuperar cupo, los pedidos que YA estaban esperando se trataban como nuevos
    // y la alarma sonaba sin haber llegado nada nuevo.
    // En su lugar, marcamos los pendientes ACTUALES como "ya conocidos": así, al
    // liberar cupo NO suenan; solo sonará por pedidos que lleguen DESPUÉS.
    if (!puedeRecibir || idsPendientes.length === 0) {
      this.detenerAlarma();
      this.ocultarNotificacionEnApp();
      idsPendientes.forEach(id => this.pedidosSilenciados.add(id));
      return;
    }

    // ¿Hay algún pedido pendiente que el usuario aún NO haya atendido?
    const hayPendienteSinAtender = idsPendientes.some(id => !this.pedidosSilenciados.has(id));

    if (hayPendienteSinAtender) {
      this.reproducirAlarma(); // el guard interno evita reiniciar si ya suena
      // Mostrar el banner flotante solo si aún no está visible (evita parpadeo en cada poll)
      if (!document.getElementById('fcm-notification-banner')) {
        this.mostrarNotificacionEnApp({
          title: 'Nuevo pedido disponible',
          body: 'Tienes un pedido esperando repartidor.'
        }, true, true);
      }
    }
  }

  /**
   * ✅ NUEVO: Silenciar la alarma de los pedidos actuales.
   * Marca los pedidos pendientes como atendidos para que NO vuelva a sonar por ellos,
   * pero seguirá sonando si llega un pedido NUEVO (con otro id).
   * Se llama al pulsar "Ver pedido", cerrar el banner o tomar un pedido.
   */
  silenciarAlarma() {
    (this._ultimosPendientes || []).forEach(id => this.pedidosSilenciados.add(id));
    this.detenerAlarma();
    this.ocultarNotificacionEnApp();
  }

  /**
   * ✅ NUEVO: Ocultar el banner flotante en-app si está visible.
   */
  ocultarNotificacionEnApp() {
    const banner = document.getElementById('fcm-notification-banner');
    if (banner) {
      banner.style.transition = 'all 0.25s ease';
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(-20px)';
      setTimeout(() => { if (banner.parentElement) banner.remove(); }, 250);
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

        if (window.socketMockInstance) window.socketMockInstance.forceCheck();
        if (typeof window.cargarPedidos === 'function') window.cargarPedidos();

        // ❌ NO arrancar la alarma a ciegas aquí.
        // cargarPedidos() → evaluarAlarma() decide: la alarma SOLO suena si el
        // pedido SIGUE en 'esperando repartidor' al recargar. Si otro domiciliario
        // ya lo tomó, evaluarAlarma([]) la detiene → se evita el clásico
        // "suena y al ir a ver no está el pedido".
        // (Para no disponibles, evaluarAlarma tampoco sonará: puedeRecibir=false.)

        this.mostrarNotificacionEnApp(notification, this.disponible, true);
        return;
      }

      // ✅ PEDIDO TOMADO POR OTRO / CANCELADO → apagar la alarma de ESE pedido.
      // El backend (cancelarNotificacionPedido) envía este push data-only cuando
      // alguien toma el pedido o se cancela. Sin esto, la alarma quedaba colgada
      // y el domiciliario "iba a ver y no estaba el pedido".
      if (data.tipo === 'cancelar_pedido') {
        console.log('🛑 cancelar_pedido recibido:', data.pedidoId);
        if (data.pedidoId) {
          const idNum = parseInt(data.pedidoId);
          if (!Number.isNaN(idNum)) this.pedidosSilenciados.add(idNum);
        }
        this.detenerAlarma();
        this.ocultarNotificacionEnApp();
        if (window.socketMockInstance) window.socketMockInstance.forceCheck();
        if (typeof window.cargarPedidos === 'function') window.cargarPedidos();
        return;
      }

      // ✅ PEDIDO LISTO - Restaurante marcó pedido como listo para recoger
      if (data.tipo === 'pedido_listo') {
        console.log('✅ Pedido listo via FCM:', data.pedidoId);
        
        if (window.socketMockInstance) window.socketMockInstance.forceCheck();
        if (typeof window.cargarPedidos === 'function') window.cargarPedidos();

        // Alarma persistente
        this.reproducirAlarma();
        
        this.mostrarNotificacionEnApp({
          title: '✅ ¡Pedido Listo!',
          body: `Pedido #${data.pedidoId} de ${data.restaurante || 'Restaurante'} está listo para recoger`,
          data: data
        }, true, true);
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
      
      // ✅ SILENCIAR ALARMA al tocar la notificación (marca pedidos como atendidos)
      this.silenciarAlarma();
      
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
   * ✅ MEJORADO: Banner flotante en-app, profesional con iconos SVG.
   * @param {object} notification {title, body}
   * @param {boolean} esDisponible muestra botón "Ver" si es true
   * @param {boolean} persistente si true, NO se auto-cierra (se cierra al Ver/cerrar/tomar
   *                  o cuando la alarma se detiene). Usado para alarmas de nuevo pedido.
   */
  mostrarNotificacionEnApp(notification, esDisponible, persistente = false) {
    const existente = document.getElementById('fcm-notification-banner');
    if (existente) existente.remove();

    // Inyectar estilos una sola vez
    if (!document.getElementById('fcm-banner-styles')) {
      const st = document.createElement('style');
      st.id = 'fcm-banner-styles';
      st.textContent = `
        #fcm-notification-banner{
          position:fixed;top:12px;left:12px;right:12px;z-index:10001;
          display:flex;align-items:center;gap:12px;
          background:#ffffff;padding:12px 14px;border-radius:16px;
          border:1px solid #e2e8f0;box-shadow:0 12px 38px rgba(15,23,42,0.22);
          animation:fcmSlideDown .32s cubic-bezier(.2,.8,.2,1);
        }
        @keyframes fcmSlideDown{from{opacity:0;transform:translateY(-28px)}to{opacity:1;transform:translateY(0)}}
        @keyframes fcmPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
        #fcm-notification-banner .fcm-ic{
          width:44px;height:44px;border-radius:13px;flex-shrink:0;
          display:flex;align-items:center;justify-content:center;color:#fff;
          animation:fcmPulse 1.3s ease-in-out infinite;
        }
        #fcm-notification-banner .fcm-txt{flex:1;min-width:0;}
        #fcm-notification-banner .fcm-txt h4{margin:0 0 2px;font-size:.95rem;font-weight:700;color:#0f172a;}
        #fcm-notification-banner .fcm-txt p{margin:0;font-size:.82rem;color:#64748b;line-height:1.3;
          overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        #fcm-notification-banner .fcm-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}
        #fcm-notification-banner .fcm-ver{
          display:flex;align-items:center;gap:5px;background:#22c55e;color:#fff;border:none;
          padding:9px 14px;border-radius:11px;font-size:.82rem;font-weight:700;cursor:pointer;
          box-shadow:0 3px 10px rgba(34,197,94,.4);transition:transform .1s ease;
        }
        #fcm-notification-banner .fcm-ver:active{transform:scale(.95);}
        #fcm-notification-banner .fcm-close{
          display:flex;align-items:center;justify-content:center;background:#f1f5f9;color:#64748b;
          border:none;width:34px;height:34px;border-radius:11px;cursor:pointer;transition:transform .1s ease;
        }
        #fcm-notification-banner .fcm-close:active{transform:scale(.95);}
      `;
      document.head.appendChild(st);
    }

    const acento = esDisponible ? '#22c55e' : '#94a3b8';
    const titulo = notification.title || (esDisponible ? 'Nuevo pedido cercano' : 'Nuevo pedido');
    const cuerpo = notification.body || (esDisponible
      ? 'NUEVOOO!'
      : 'Hay un nuevo pedido. Actívate para tomarlo.');

    // Iconos SVG (inline, sin dependencias externas)
    const iconBell = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>`;
    const iconEye = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>`;
    const iconClose = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>`;

    const notifDiv = document.createElement('div');
    notifDiv.id = 'fcm-notification-banner';
    notifDiv.style.borderLeft = `5px solid ${acento}`;
    notifDiv.innerHTML = `
      <div class="fcm-ic" style="background:${acento};">${iconBell}</div>
      <div class="fcm-txt">
        <h4>${titulo}</h4>
        <p>${cuerpo}</p>
      </div>
      <div class="fcm-actions">
        ${esDisponible ? `<button class="fcm-ver" type="button">${iconEye}<span>Ver</span></button>` : ''}
        <button class="fcm-close" type="button" aria-label="Cerrar">${iconClose}</button>
      </div>
    `;
    document.body.appendChild(notifDiv);

    // Handlers
    const verBtn = notifDiv.querySelector('.fcm-ver');
    if (verBtn) {
      verBtn.addEventListener('click', () => {
        this.silenciarAlarma();
        if (typeof window.navigateTo === 'function') window.navigateTo('pedidos');
        if (typeof window.cargarPedidos === 'function') window.cargarPedidos();
      });
    }
    notifDiv.querySelector('.fcm-close').addEventListener('click', () => {
      this.silenciarAlarma();
    });

    // Auto-cerrar solo si NO es persistente (notificaciones informativas)
    if (!persistente) {
      setTimeout(() => {
        // No cerrar si mientras tanto se activó una alarma en bucle
        if (notifDiv.parentElement && !this.alarmInterval) {
          notifDiv.style.transition = 'all 0.3s ease';
          notifDiv.style.opacity = '0';
          notifDiv.style.transform = 'translateY(-20px)';
          setTimeout(() => notifDiv.remove(), 300);
        }
      }, 8000);
    }
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