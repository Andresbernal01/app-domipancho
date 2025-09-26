import { CapacitorConfig } from '@capacitor/core';

const config: CapacitorConfig = {
  appId: 'com.domipancho.domiciliarios',
  appName: 'DomiPancho',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      'https://domipancho.com',
      'https://wa.me'
    ]
  },
  plugins: {
    Geolocation: {
      permissions: ['fine', 'coarse', 'background'],
      backgroundLocationUpdates: true,
      // ✅ Configuración adicional para mejor rendimiento
      timeout: 60000,
      maximumAge: 600000
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#facc15",
      sound: "beep.wav"
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    App: {
      launchUrl: 'index.html'
    },
    CapacitorHttp: {
      enabled: true
    }
  },
  android: {
    allowMixedContent: true,
    captureInput: true,
    webContentsDebuggingEnabled: true,
    // ✅ Configuración para permisos persistentes
    permissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION"
    ]
  }
};

export default config;