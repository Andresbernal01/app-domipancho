package com.domipancho.domiciliarios;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;

public class NotificationChannels {
    
    public static void createChannels(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager notificationManager = 
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            
            // ✅ Canal 1: CON sonido (domiciliario disponible, sonido activado)
            NotificationChannel channelWithSound = new NotificationChannel(
                "pedidos_channel",
                "Pedidos con sonido",
                NotificationManager.IMPORTANCE_HIGH
            );
            channelWithSound.setDescription("Notificaciones de nuevos pedidos con sonido - Para cuando estás disponible");
            channelWithSound.enableVibration(true);
            channelWithSound.setVibrationPattern(new long[]{0, 300, 200, 300, 200, 300});
            channelWithSound.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            channelWithSound.setShowBadge(true);
            
            // Configurar sonido personalizado
            Uri soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/raw/notificacion");
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build();
            channelWithSound.setSound(soundUri, audioAttributes);
            
            notificationManager.createNotificationChannel(channelWithSound);
            
            // ✅ Canal 2: SILENCIOSO (domiciliario disponible pero desactivó sonido)
            NotificationChannel channelSilent = new NotificationChannel(
                "pedidos_silent_channel",
                "Pedidos silenciosos",
                NotificationManager.IMPORTANCE_HIGH
            );
            channelSilent.setDescription("Notificaciones de nuevos pedidos sin sonido");
            channelSilent.setSound(null, null);
            channelSilent.enableVibration(false);
            channelSilent.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            channelSilent.setShowBadge(true);
            
            notificationManager.createNotificationChannel(channelSilent);
            
            // ✅ Canal 3: INFORMATIVO (domiciliario NO disponible)
            NotificationChannel channelInfo = new NotificationChannel(
                "pedidos_info_channel",
                "Pedidos informativos",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            channelInfo.setDescription("Notificaciones informativas cuando no estás disponible - Sonido suave");
            channelInfo.enableVibration(false);
            channelInfo.setSound(null, null); // Sin sonido del sistema, el sonido suave lo maneja la app
            channelInfo.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            channelInfo.setShowBadge(true);
            
            notificationManager.createNotificationChannel(channelInfo);
        }
    }
}