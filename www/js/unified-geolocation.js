// js/unified-geolocation.js - SISTEMA CON SERVICIO FOREGROUND NATIVO COMPLETO

class UnifiedGeolocationService {
  constructor() {
    this.isNative = !!window.Capacitor;
    this.isTracking = false;
    this.lastPosition = null;
    this.permissionStatus = localStorage.getItem('geo_permission_status') || 'prompt';
    
    // ✅ Verificar si hay tracking pendiente al cargar
    this.checkPendingTracking();
  }

  /**
   * ✅ Verificar si hay un pedido activo al cargar la página
   */
  async checkPendingTracking() {
    const tienePedidoActivo = localStorage.getItem('domiciliario_pedido_activo');
    
    if (tienePedidoActivo === 'true') {
      console.log('🔄 Pedido activo detectado - reiniciando tracking automáticamente');
      
      setTimeout(async () => {
        try {
          await this.initialize();
          await this.startTracking();
          console.log('✅ Tracking reiniciado automáticamente');
        } catch (error) {
          console.error('❌ Error reiniciando tracking:', error);
        }
      }, 2000);
    }
  }

  async initialize() {
    console.log('🎯 Inicializando sistema unificado de geolocalización');
    
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
      
      const current = await BackgroundGeolocation.checkPermissions();
      
      if (current.location === 'granted' && current.coarseLocation === 'granted') {
        console.log('✅ Permisos nativos ya otorgados');
        this.permissionStatus = 'granted';
        localStorage.setItem('geo_permission_status', 'granted');
        return true;
      }

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
    
    // ✅ GUARDAR ESTADO DE TRACKING
    localStorage.setItem('tracking_activo', 'true');

    // ✅ INICIAR SERVICIO FOREGROUND NATIVO
    if (this.isNative) {
      await this.startNativeService();
    } else {
      await this.startWebTracking();
    }

    console.log('✅ Tracking iniciado correctamente');
  }

  async startNativeService() {
    try {
      // ✅ Usar el plugin personalizado de Capacitor
      const { LocationService } = window.Capacitor.Plugins;
      
      if (LocationService) {
        const result = await LocationService.startLocationService();
        console.log('✅ Servicio foreground iniciado:', result);
      } else {
        console.warn('⚠️ Plugin LocationService no disponible');
      }
    } catch (error) {
      console.error('❌ Error iniciando servicio nativo:', error);
    }
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

  async stopTracking() {
    // ✅ REMOVER VALIDACIÓN DE PEDIDO ACTIVO CUANDO SE LLAMA EXPLÍCITAMENTE
    if (!this.isTracking) {
      console.log('⚠️ Tracking ya estaba detenido');
      return;
    }
  
    this.isTracking = false;
    
    // ✅ LIMPIAR ESTADO
    localStorage.removeItem('tracking_activo');
  
    // ✅ DETENER SERVICIO NATIVO
    if (this.isNative) {
      await this.stopNativeService();
    } else if (this.watcherId) {
      navigator.geolocation.clearWatch(this.watcherId);
      this.watcherId = null;
    }
    
    console.log('🛑 Tracking detenido completamente');
  }

  async stopNativeService() {
    try {
      const { LocationService } = window.Capacitor.Plugins;
      
      if (LocationService) {
        const result = await LocationService.stopLocationService();
        console.log('✅ Servicio foreground detenido:', result);
      } else {
        console.warn('⚠️ Plugin LocationService no disponible');
      }
    } catch (error) {
      console.error('❌ Error deteniendo servicio:', error);
    }
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

  async forceUpdate() {
    if (this.lastPosition) {
      await this.updateServer(this.lastPosition);
    } else {
      console.warn('⚠️ No hay última posición disponible');
    }
  }
}

// ✅ Instancia global única
window.unifiedGeoService = new UnifiedGeolocationService();