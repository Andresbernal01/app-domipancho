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
            
            // Canal CON sonido
            NotificationChannel channelWithSound = new NotificationChannel(
                "pedidos_channel",
                "Pedidos con sonido",
                NotificationManager.IMPORTANCE_HIGH
            );
            channelWithSound.setDescription("Notificaciones de nuevos pedidos con sonido");
            channelWithSound.enableVibration(true);
            
            // Configurar sonido personalizado
            Uri soundUri = Uri.parse("android.resource://" + context.getPackageName() + "/raw/notificacion");
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build();
            channelWithSound.setSound(soundUri, audioAttributes);
            
            notificationManager.createNotificationChannel(channelWithSound);
            
            // Canal SILENCIOSO
            NotificationChannel channelSilent = new NotificationChannel(
                "pedidos_silent_channel",
                "Pedidos silenciosos",
                NotificationManager.IMPORTANCE_HIGH
            );
            channelSilent.setDescription("Notificaciones de nuevos pedidos sin sonido");
            channelSilent.setSound(null, null); // SIN sonido
            channelSilent.enableVibration(false); // Sin vibración
            
            notificationManager.createNotificationChannel(channelSilent);
        }
    }
}