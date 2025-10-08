// js/unified-geolocation.js - SISTEMA MEJORADO CON BACKGROUND TRACKING
class UnifiedGeolocationService {
  constructor() {
    this.isNative = !!window.Capacitor;
    this.watcherId = null;
    this.isTracking = false;
    this.lastPosition = null;
    this.updateInterval = null;
    this.heartbeatInterval = null;
    
    // Verificar permisos guardados
    this.permissionStatus = localStorage.getItem('geo_permission_status') || 'prompt';
  }

  async initialize() {
    console.log('🎯 Inicializando sistema unificado de geolocalización');
    
    // Si ya hay permiso, no mostrar modal
    if (this.permissionStatus === 'granted') {
      console.log('✅ Permisos ya otorgados previamente');
      return true;
    }

    try {
      await this.requestPermissions();
      return true;
    } catch (error) {
      console.error('❌ Error en inicialización:', error);
      return false;
    }
  }

  async requestPermissions() {
    if (this.isNative && window.Capacitor?.Plugins?.BackgroundGeolocation) {
      return await this.requestNativePermissions();
    } else {
      return await this.requestWebPermissions();
    }
  }

  async requestNativePermissions() {
    try {
      const { BackgroundGeolocation } = window.Capacitor.Plugins;
      
      // Verificar permisos actuales
      const current = await BackgroundGeolocation.checkPermissions();
      
      if (current.location === 'granted' && current.coarseLocation === 'granted') {
        console.log('✅ Permisos nativos ya otorgados');
        this.permissionStatus = 'granted';
        localStorage.setItem('geo_permission_status', 'granted');
        return true;
      }

      // Solo mostrar modal si NO hay permisos
      this.showPermissionDialog();
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const result = await BackgroundGeolocation.requestPermissions({
        permissions: ['location', 'coarseLocation']
      });

      if (result.location === 'granted') {
        this.permissionStatus = 'granted';
        localStorage.setItem('geo_permission_status', 'granted');
        return true;
      } else {
        this.permissionStatus = 'denied';
        localStorage.setItem('geo_permission_status', 'denied');
        throw new Error('Permisos denegados');
      }
    } catch (error) {
      console.error('Error en permisos nativos:', error);
      throw error;
    }
  }

  async requestWebPermissions() {
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
        );
      });

      this.permissionStatus = 'granted';
      localStorage.setItem('geo_permission_status', 'granted');
      this.lastPosition = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      return true;
    } catch (error) {
      if (error.code === 1) {
        this.permissionStatus = 'denied';
        localStorage.setItem('geo_permission_status', 'denied');
      }
      throw error;
    }
  }

  showPermissionDialog() {
    const dialogShown = sessionStorage.getItem('permission_dialog_shown');
    if (dialogShown) return;
    if (document.getElementById('permissionDialog')) return;
    
    sessionStorage.setItem('permission_dialog_shown', 'true');
    
    const dialog = document.createElement('div');
    dialog.id = 'permissionDialog';
    dialog.style.cssText = `
      position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
      background: white; padding: 20px; border-radius: 12px; z-index: 10000;
      max-width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    `;
    dialog.innerHTML = `
      <h3 style="margin-top: 0; color: #333;">📍 Permiso de Ubicación</h3>
      <p style="color: #666; line-height: 1.5;">
        Para recibir pedidos cercanos y que los clientes rastreen tus entregas,
        necesitamos acceso a tu ubicación <strong>todo el tiempo</strong>.
      </p>
      <p style="color: #666; line-height: 1.5;">
        En la siguiente pantalla, selecciona:
        <strong>"Permitir todo el tiempo"</strong>
      </p>
      <button id="close-perm-dialog" style="
        background: #10b981; color: white; border: none; padding: 12px 24px;
        border-radius: 8px; cursor: pointer; width: 100%; font-weight: bold;
      ">Entendido</button>
    `;
    document.body.appendChild(dialog);
    
    document.getElementById('close-perm-dialog').onclick = () => dialog.remove();
  }

  async startTracking() {
    if (this.isTracking) {
      console.log('⚠️ Ya hay tracking activo');
      return;
    }

    if (this.permissionStatus !== 'granted') {
      console.warn('❌ No hay permisos para tracking');
      return;
    }

    this.isTracking = true;

    if (this.isNative && window.Capacitor?.Plugins?.BackgroundGeolocation) {
      await this.startNativeTracking();
    } else {
      await this.startWebTracking();
    }

    // ✅ ACTUALIZAR SERVIDOR CADA 10 SEGUNDOS (antes 3)
    this.updateInterval = setInterval(() => {
      if (this.lastPosition) {
        this.updateServer(this.lastPosition);
      }
    }, 10000); // 10 segundos

    // ✅ NUEVO: HEARTBEAT CADA 60 SEGUNDOS
    this.startHeartbeat();
  }

  async startNativeTracking() {
    const { BackgroundGeolocation } = window.Capacitor.Plugins;
    
    const callback = async (location, error) => {
      if (error) {
        console.error('Error en tracking:', error);
        return;
      }

      if (location) {
        this.lastPosition = {
          latitude: location.latitude,
          longitude: location.longitude
        };
        console.log('📍 Nueva ubicación (native):', this.lastPosition);
        await this.updateServer(this.lastPosition);
      }
    };

    this.watcherId = await BackgroundGeolocation.addWatcher(
      {
        // ✅ CONFIGURACIÓN MEJORADA PARA BACKGROUND
        backgroundMessage: "DomiPancho - Entrega activa",
        backgroundTitle: "Rastreando ubicación",
        requestPermissions: false,
        stale: false,
        distanceFilter: 10, // Cada 10 metros
        
        // ✅ OPCIONES CRÍTICAS PARA BACKGROUND
        backgroundActivityType: "otherNavigation", // iOS
        requiresCharging: false,
        requiresBatteryNotLow: false,
        
        // ✅ Android específico
        notificationTitle: "DomiPancho",
        notificationText: "Rastreando ubicación para entregas",
        notificationIcon: "ic_stat_icon_config_sample"
      },
      callback
    );

    console.log('✅ Tracking nativo iniciado con background support');
  }

  async startWebTracking() {
    this.watcherId = navigator.geolocation.watchPosition(
      (position) => {
        this.lastPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        console.log('📍 Nueva ubicación (web):', this.lastPosition);
        this.updateServer(this.lastPosition);
      },
      (error) => console.error('Error tracking web:', error),
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 10000
      }
    );

    console.log('✅ Tracking web iniciado');
  }

  // ✅ NUEVO: SISTEMA DE HEARTBEAT
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(async () => {
      try {
        await window.apiRequest('/api/domiciliario-heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        console.log('💓 Heartbeat enviado');
      } catch (error) {
        console.error('❌ Error en heartbeat:', error);
      }
    }, 60000); // Cada 60 segundos
  }

  async stopTracking() {
    if (!this.isTracking) return;

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.isNative && this.watcherId && window.Capacitor?.Plugins?.BackgroundGeolocation) {
      await window.Capacitor.Plugins.BackgroundGeolocation.removeWatcher({ id: this.watcherId });
    } else if (this.watcherId) {
      navigator.geolocation.clearWatch(this.watcherId);
    }

    this.isTracking = false;
    this.watcherId = null;
    console.log('🛑 Tracking detenido');
  }

  async updateServer(position) {
    try {
      await window.apiRequest('/api/domiciliario/ubicacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitud: position.latitude,
          longitud: position.longitude,
          timestamp: new Date().toISOString()
        })
      });
      console.log('✅ Ubicación enviada al servidor');
    } catch (error) {
      console.error('❌ Error enviando ubicación:', error);
    }
  }

  // ✅ NUEVA FUNCIÓN: Forzar actualización de ubicación
  async forceUpdate() {
    if (this.lastPosition) {
      await this.updateServer(this.lastPosition);
    } else {
      console.warn('⚠️ No hay última posición disponible');
    }
  }
}

// Instancia global única
window.unifiedGeoService = new UnifiedGeolocationService();