package com.domipancho.domiciliarios;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Servicio FCM nativo de DomiPancho.
 *
 * Extiende el MessagingService del plugin oficial @capacitor/push-notifications
 * para NO romper la recepción en primer plano (el JS sigue recibiendo
 * pushNotificationReceived vía super.onMessageReceived).
 *
 * ⚠️ Si NO usas @capacitor/push-notifications sino @capacitor-community/fcm,
 * cambia el "extends" por la clase de ese plugin
 * (com.getcapacitor.community.fcm.FCMService).
 *
 * Responsabilidad EXTRA de esta clase: cuando la app está en segundo plano o
 * cerrada, arrancar/parar la alarma sonora persistente (AlarmaPedidoService).
 * En primer plano NO hace nada: lo maneja fcm-notifications.js (banner + sonido),
 * así evitamos sonido doble.
 */
public class PedidosMessagingService
        extends com.capacitorjs.plugins.pushnotifications.MessagingService {

    private static final String TAG = "PedidosFCM";

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        // 1. Deja que Capacitor haga su trabajo (emite el evento al JS si la app vive)
        try {
            super.onMessageReceived(remoteMessage);
        } catch (Exception e) {
            Log.w(TAG, "super.onMessageReceived falló: " + e.getMessage());
        }

        Map<String, String> data = remoteMessage.getData();
        if (data == null || data.isEmpty()) return;

        String tipo = data.get("tipo");
        if (tipo == null) return;

        Log.d(TAG, "📬 Data FCM recibido. tipo=" + tipo + " foreground=" + MainActivity.isAppForeground);

        // 2. Si la app está EN PRIMER PLANO, el JS se encarga de todo. No duplicamos.
        if (MainActivity.isAppForeground) {
            return;
        }

        // 3. App en segundo plano / cerrada → control nativo de la alarma
        switch (tipo) {
            case "nuevo_pedido":
            case "pedido_listo": {
                boolean conSonido = !"false".equals(data.get("conSonido"));
                String titulo = data.get("titulo");
                String cuerpo = data.get("cuerpo");
                String pedidoId = data.get("pedidoId");

                if (titulo == null) {
                    titulo = "pedido_listo".equals(tipo) ? "✅ ¡Pedido listo!" : "📦 Nuevo pedido disponible";
                }
                if (cuerpo == null) {
                    cuerpo = "Tienes un pedido esperando. Ábrelo para tomarlo.";
                }

                Intent i = new Intent(this, AlarmaPedidoService.class);
                i.setAction(AlarmaPedidoService.ACTION_START);
                i.putExtra(AlarmaPedidoService.EXTRA_PEDIDO_ID, pedidoId);
                i.putExtra(AlarmaPedidoService.EXTRA_TITULO, titulo);
                i.putExtra(AlarmaPedidoService.EXTRA_CUERPO, cuerpo);
                i.putExtra(AlarmaPedidoService.EXTRA_CON_SONIDO, conSonido);
                arrancarServicio(i);
                break;
            }

            case "cancelar_pedido": {
                // El pedido ya fue tomado por otro / cancelado → apagar alarma
                Intent i = new Intent(this, AlarmaPedidoService.class);
                i.setAction(AlarmaPedidoService.ACTION_STOP);
                i.putExtra(AlarmaPedidoService.EXTRA_PEDIDO_ID, data.get("pedidoId"));
                arrancarServicio(i);
                break;
            }

            case "wake_for_location":
            default:
                // Nada nativo que hacer
                break;
        }
    }

    private void arrancarServicio(Intent i) {
        try {
            // Los mensajes FCM de prioridad alta otorgan una ventana temporal
            // para iniciar un foreground service desde background.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(i);
            } else {
                startService(i);
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ No se pudo iniciar AlarmaPedidoService: " + e.getMessage());
        }
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.d(TAG, "🔑 onNewToken: " + token);
        // El token también lo guarda el plugin de Capacitor desde JS.
    }
}