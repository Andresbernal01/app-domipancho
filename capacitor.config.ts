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
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    },
    BackgroundGeolocation: {
      notificationTitle: "DomiPancho - Entrega activa",
      notificationText: "Rastreando tu ubicación",
      notificationIcon: "ic_stat_icon_config_sample",
      notificationColor: "#facc15",
      backgroundMessage: "Tu ubicación se está compartiendo",
      distanceFilter: 10,
      stale: false,
      stopOnTerminate: false,
      startOnBoot: false
    },
    Geolocation: {
      permissions: ['fine', 'coarse', 'background'],
      backgroundLocationUpdates: true,
      timeout: 60000,
      maximumAge: 10000
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#facc15",
      sound: "notificacion.mp3"
    }
  },
  android: {
    allowMixedContent: true,
    permissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.WAKE_LOCK",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
      "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"
    ]
  }
};

export default config;