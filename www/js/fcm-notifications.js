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
      const sinAtender = idsPendientes.filter(id => !this.pedidosSilenciados.has(id)).length;
      const banner = document.getElementById('fcm-notification-banner');
      const cuerpo = sinAtender > 1
        ? `${sinAtender} pedidos esperando repartidor`
        : 'Hay un pedido esperando repartidor';
      if (!banner || banner.dataset.variant !== 'nuevo') {
        this.mostrarNotificacionEnApp({ title: 'Nuevo pedido disponible', body: cuerpo }, true, true, { variant: 'nuevo' });
      } else {
        // Ya visible: solo actualizar el texto (sin animación ni parpadeo)
        const p = banner.querySelector('.fcm-txt p');
        if (p) p.textContent = cuerpo;
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
      banner.classList.add('fcm-saliendo');
      banner.id = ''; // permite mostrar otro banner de inmediato
      setTimeout(() => { if (banner.parentElement) banner.remove(); }, 220);
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

        // El banner "Nuevo pedido" lo muestra evaluarAlarma() con datos reales.
        // Si NO está disponible, solo un aviso informativo que se cierra solo.
        if (!this.disponible) {
          this.mostrarNotificacionEnApp({
            title: 'Nuevo pedido en tu ciudad',
            body: 'Activa "Disponible" para poder tomarlo.'
          }, false, false, { variant: 'info' });
        }
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
          title: 'Pedido listo para recoger',
          body: `#${data.pedidoId} · ${data.restaurante || 'Restaurante'}`,
          data: data
        }, true, true, { variant: 'listo', destino: 'pedidos-activos', textoBoton: 'Ir' });
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
      
      this.mostrarNotificacionEnApp(notification, true, false, { variant: 'info', destino: null });
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
   * ✅ Banner flotante en-app (estilo notificación del sistema).
   * - Usa los textos reales del push (data.titulo / data.cuerpo en mensajes data-only).
   * - Respeta el notch / barra de estado (safe-area).
   * - Se descarta deslizando hacia arriba o con la X.
   * @param {object} notification {title, body, data}
   * @param {boolean} esDisponible muestra botón de acción si es true
   * @param {boolean} persistente si true NO se auto-cierra (alarma de nuevo pedido)
   * @param {object} opts { variant: 'nuevo'|'urgente'|'listo'|'info', destino, textoBoton }
   */
  mostrarNotificacionEnApp(notification, esDisponible, persistente = false, opts = {}) {
    const existente = document.getElementById('fcm-notification-banner');
    if (existente) existente.remove();
    clearTimeout(this._bannerTimer);

    const data = notification?.data || {};
    const limpiar = (t) => String(t || '')
      .replace(/^[\s☀-➿⬀-⯿️\u{1F000}-\u{1FAFF}·]+/u, '')
      .trim();

    let variant = opts.variant || (data.tipo === 'pedido_listo' ? 'listo' : data.tipo === 'nuevo_pedido' ? 'nuevo' : 'info');
    if (data.urgente === 'true' || data.urgente === true) variant = 'urgente';

    const titulo = limpiar(notification?.title || data.titulo) ||
      (variant === 'listo' ? 'Pedido listo para recoger' : variant === 'info' ? 'DomiPancho' : 'Nuevo pedido disponible');
    const cuerpo = limpiar(notification?.body || data.cuerpo) ||
      (esDisponible ? 'Toca para ver los detalles' : 'Activa "Disponible" para tomarlo');
    const destino = opts.destino !== undefined ? opts.destino : (variant === 'listo' ? 'pedidos-activos' : 'pedidos');
    const textoBoton = opts.textoBoton || 'Ver';

    const ICONS = {
      nuevo:   '<path stroke-linecap="round" stroke-linejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>',
      urgente: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>',
      listo:   '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>',
      info:    '<path stroke-linecap="round" stroke-linejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>'
    };
    const etiqueta = { nuevo: 'NUEVO PEDIDO', urgente: 'URGENTE', listo: 'PEDIDO LISTO', info: 'AVISO' }[variant];

    const notifDiv = document.createElement('div');
    notifDiv.id = 'fcm-notification-banner';
    notifDiv.className = `fcm-banner fcm-${variant}${persistente ? ' fcm-sonando' : ''}`;
    notifDiv.dataset.variant = variant;
    notifDiv.setAttribute('role', 'alert');
    notifDiv.innerHTML = `
      <div class="fcm-ic"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">${ICONS[variant] || ICONS.info}</svg></div>
      <div class="fcm-txt">
        <span class="fcm-tag">${etiqueta}${persistente ? '<i class="fcm-eq"><b></b><b></b><b></b></i>' : ''}</span>
        <h4></h4>
        <p></p>
      </div>
      <div class="fcm-actions">
        ${esDisponible && destino ? `<button class="fcm-ver" type="button">${textoBoton}</button>` : ''}
        <button class="fcm-close" type="button" aria-label="Cerrar">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>`;
    // textContent: nunca interpretar HTML que venga del push
    notifDiv.querySelector('h4').textContent = titulo;
    notifDiv.querySelector('p').textContent = cuerpo;
    document.body.appendChild(notifDiv);

    const accion = () => {
      this.silenciarAlarma();
      if (destino && typeof window.navigateTo === 'function') window.navigateTo(destino);
      if (typeof window.cargarPedidos === 'function') window.cargarPedidos();
    };

    const verBtn = notifDiv.querySelector('.fcm-ver');
    if (verBtn) verBtn.addEventListener('click', (e) => { e.stopPropagation(); accion(); });
    notifDiv.querySelector('.fcm-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.silenciarAlarma();
    });
    // Tocar el cuerpo del banner = misma acción que "Ver"
    notifDiv.addEventListener('click', () => { if (verBtn) accion(); });

    // Deslizar hacia arriba para descartar
    let y0 = null, dy = 0;
    notifDiv.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; dy = 0; notifDiv.style.transition = 'none'; }, { passive: true });
    notifDiv.addEventListener('touchmove', (e) => {
      if (y0 === null) return;
      dy = Math.min(0, e.touches[0].clientY - y0);
      notifDiv.style.transform = `translate(-50%, ${dy}px)`;
      notifDiv.style.opacity = String(1 + dy / 120);
    }, { passive: true });
    notifDiv.addEventListener('touchend', () => {
      notifDiv.style.transition = '';
      if (dy < -40) this.silenciarAlarma();
      else { notifDiv.style.transform = ''; notifDiv.style.opacity = ''; }
      y0 = null;
    });

    // Auto-cerrar solo si NO es persistente (avisos informativos)
    if (!persistente) {
      this._bannerTimer = setTimeout(() => {
        if (notifDiv.parentElement && !this.alarmInterval) this.ocultarNotificacionEnApp();
      }, 6000);
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
            smallIcon: 'ic_stat_pedido',
            iconColor: esDisponible ? '#E74C3C' : '#94a3b8',
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