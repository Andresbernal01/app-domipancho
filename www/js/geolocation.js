// public/js/geolocation.js - VERSIÓN CORREGIDA PARA APP MÓVIL
class GeolocationService {
  constructor() {
    this.watchId = null;
    this.lastPosition = null;
    this.isTracking = false;
    this.permissionGranted = localStorage.getItem('geo_permission') === 'granted';
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async requestPermission() {
    if (!navigator.geolocation) {
      throw new Error('Geolocalización no soportada');
    }

    // Si ya tenemos permiso guardado, no preguntar de nuevo
    if (this.permissionGranted) {
      console.log('✅ Permiso de ubicación previamente otorgado');
      return true;
    }

    try {
      // ✅ Intentar obtener posición con configuración más permisiva
      const position = await this.getCurrentPosition();
      
      // Si llegamos aquí, el permiso fue otorgado
      localStorage.setItem('geo_permission', 'granted');
      this.permissionGranted = true;
      console.log('✅ Permiso de ubicación otorgado y guardado');
      return true;
      
    } catch (error) {
      console.error('❌ Error de permisos:', error);
      
      // Solo marcar como denegado si es error de permisos, no timeout
      if (error.code === 1) {
        localStorage.setItem('geo_permission', 'denied');
        this.permissionGranted = false;
        this.mostrarUIPermisosDenegados();
      } else if (error.code === 3 && this.retryCount < this.maxRetries) {
        // Si es timeout, reintentar
        console.warn(`⏰ Timeout - Reintentando (${this.retryCount + 1}/${this.maxRetries})...`);
        this.retryCount++;
        await new Promise(resolve => setTimeout(resolve, 1000));
        return await this.requestPermission();
      }
      
      throw error;
    }
  }

  mostrarUIPermisosDenegados() {
    const mensaje = document.createElement('div');
    mensaje.style.cssText = `
      position: fixed;
      top: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #fee2e2;
      color: #991b1b;
      padding: 15px 20px;
      border-radius: 8px;
      z-index: 9999;
      max-width: 90%;
      text-align: center;
      border: 2px solid #dc2626;
    `;
    mensaje.innerHTML = `
      <strong>📍 Ubicación requerida</strong>
      <p style="margin: 10px 0; font-size: 0.9em;">
        Para recibir pedidos cercanos, activa tu ubicación en:
        <br>Configuración → Aplicaciones → DomiPancho → Permisos
      </p>
      <button onclick="this.parentElement.remove()" style="
        background: #dc2626;
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
      ">Entendido</button>
    `;
    document.body.appendChild(mensaje);
  }

  getCurrentPosition() {
    return new Promise((resolve, reject) => {
      // ✅ Configuración más permisiva para app móvil
      const options = {
        enableHighAccuracy: true,  // Cambiado a true
        timeout: 60000,            // Aumentado a 60 segundos
        maximumAge: 600000         // 10 minutos (más permisivo)
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          this.lastPosition = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            timestamp: Date.now()
          };
          this.retryCount = 0; // Reset contador de reintentos
          console.log('✅ Ubicación obtenida:', this.lastPosition);
          resolve(this.lastPosition);
        },
        (error) => {
          console.error('❌ Error obteniendo ubicación:', error);
          
          // Si es timeout y aún hay reintentos, propagar error para retry
          if (error.code === 3 && this.retryCount < this.maxRetries) {
            reject(this.getGeolocationError(error));
          } else {
            // Si no hay más reintentos o es otro error, rechazar definitivamente
            reject(this.getGeolocationError(error));
          }
        },
        options
      );
    });
  }

  startTracking(callback) {
    if (this.isTracking) return;

    this.isTracking = true;
    
    // ✅ Configuración optimizada para tracking continuo
    const trackingOptions = {
      enableHighAccuracy: true,
      timeout: 45000,  // 45 segundos para tracking
      maximumAge: 30000 // 30 segundos
    };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const newPosition = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timestamp: Date.now()
        };

        if (this.hasPositionChanged(newPosition)) {
          this.lastPosition = newPosition;
          console.log('📍 Nueva posición:', newPosition);
          if (callback) callback(newPosition);
        }
      },
      (error) => {
        console.error('❌ Error en seguimiento:', error);
        
        // Si es timeout, intentar reiniciar tracking
        if (error.code === 3) {
          console.warn('⏰ Timeout en tracking, reiniciando...');
          this.stopTracking();
          setTimeout(() => this.startTracking(callback), 2000);
        }
      },
      trackingOptions
    );
  }

  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
  }

  hasPositionChanged(newPosition) {
    if (!this.lastPosition) return true;

    const distance = this.calculateDistance(
      this.lastPosition.latitude,
      this.lastPosition.longitude,
      newPosition.latitude,
      newPosition.longitude
    );

    return distance > 0.01; // ~10 metros
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  async updateLocationOnServer(position) {
    try {
      const response = await window.apiRequest('/api/domiciliario/ubicacion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitud: position.latitude,
          longitud: position.longitude
        })
      });

      if (!response.ok) {
        throw new Error('Error al enviar ubicación');
      }

      const result = await response.json();
      console.log('✅ Ubicación enviada al servidor');
      return result;
    } catch (error) {
      console.error('❌ Error enviando ubicación:', error);
      throw error;
    }
  }

  getGeolocationError(error) {
    switch (error.code) {
      case error.PERMISSION_DENIED:
        return new Error('Permisos de ubicación denegados');
      case error.POSITION_UNAVAILABLE:
        return new Error('Información de ubicación no disponible');
      case error.TIMEOUT:
        return new Error('Tiempo agotado al obtener ubicación');
      default:
        return new Error('Error desconocido');
    }
  }
}

window.GeolocationService = GeolocationService;