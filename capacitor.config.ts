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
      timeout: 60000,
      maximumAge: 600000
    },
    LocalNotifications: {
      smallIcon: "ic_stat_icon_config_sample",
      iconColor: "#facc15",
      sound: "notificacion.mp3"
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    }
  },
  android: {
    allowMixedContent: true,
    permissions: [
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.WAKE_LOCK"
    ]
  }
};

export default config;