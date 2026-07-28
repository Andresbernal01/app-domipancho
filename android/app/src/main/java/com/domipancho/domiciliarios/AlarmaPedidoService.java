package com.domipancho.domiciliarios;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.util.Log;

import androidx.core.app.NotificationCompat;

/**
 * Reproduce una alarma de nuevo pedido EN BUCLE (sonido + vibración) mientras
 * la app está en segundo plano o cerrada, hasta que:
 *   - el domiciliario pulse "Ver pedido" o "Silenciar" en la notificación,
 *   - llegue un push 'cancelar_pedido' (otro lo tomó / se canceló), o
 *   - venza el tiempo máximo de seguridad (AUTO_STOP_MS).
 *
 * Se muestra como notificación de alta prioridad (heads-up) con acciones.
 */
public class AlarmaPedidoService extends Service {

    private static final String TAG = "AlarmaPedido";

    public static final String ACTION_START = "com.domipancho.ALARMA_START";
    public static final String ACTION_STOP  = "com.domipancho.ALARMA_STOP";
    public static final String ACTION_VER   = "com.domipancho.ALARMA_VER";

    public static final String EXTRA_PEDIDO_ID  = "pedidoId";
    public static final String EXTRA_TITULO      = "titulo";
    public static final String EXTRA_CUERPO      = "cuerpo";
    public static final String EXTRA_CON_SONIDO  = "conSonido";

    public static final String CHANNEL_ID = "alarma_pedido_channel";
    private static final int NOTIFICATION_ID = 54321;

    // ⏱️ Tiempo máximo que suena si nadie interactúa (seguridad anti-batería)
    private static final long AUTO_STOP_MS = 90_000; // 90 segundos

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private Handler handler;
    private Runnable autoStopRunnable;
    private boolean sonando = false;

    @Override
    public void onCreate() {
        super.onCreate();
        crearCanal();
        handler = new Handler(Looper.getMainLooper());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;
        Log.d(TAG, "onStartCommand action=" + action);

        if (ACTION_STOP.equals(action) || ACTION_VER.equals(action)) {
            // Acción legacy por si llega de algún Intent antiguo guardado en caché
            detenerTodo();
            return START_NOT_STICKY;
        }

        // ACTION_START
        String titulo = intent.getStringExtra(EXTRA_TITULO);
        String cuerpo = intent.getStringExtra(EXTRA_CUERPO);
        String pedidoId = intent.getStringExtra(EXTRA_PEDIDO_ID);
        boolean conSonido = intent.getBooleanExtra(EXTRA_CON_SONIDO, true);

        if (titulo == null) titulo = "📦 Nuevo pedido disponible";
        if (cuerpo == null) cuerpo = "Tienes un pedido esperando. Ábrelo para tomarlo.";

        // Mostrar/actualizar notificación heads-up con acciones
        startForeground(NOTIFICATION_ID, construirNotificacion(titulo, cuerpo, pedidoId));

        // Iniciar sonido en bucle (si no estaba ya sonando)
        if (!sonando) {
            sonando = true;
            if (conSonido) iniciarSonidoLoop();
            iniciarVibracionLoop();
            programarAutoStop();
        }

        return START_NOT_STICKY;
    }

    private void iniciarSonidoLoop() {
        try {
            Uri sound = Uri.parse("android.resource://" + getPackageName() + "/raw/notificacion");
            mediaPlayer = new MediaPlayer();
            mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build());
            mediaPlayer.setDataSource(this, sound);
            mediaPlayer.setLooping(true); // 🔁 bucle continuo
            mediaPlayer.setVolume(1.0f, 1.0f);
            // ✅ Mantiene el CPU despierto mientras suena (pantalla apagada/bloqueada).
            //    Requiere el permiso WAKE_LOCK (ya está en el manifest).
            mediaPlayer.setWakeMode(getApplicationContext(), PowerManager.PARTIAL_WAKE_LOCK);
            mediaPlayer.prepare();
            mediaPlayer.start();
            Log.d(TAG, "🔔 Alarma en bucle iniciada");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error iniciando sonido: " + e.getMessage());
        }
    }

    private void iniciarVibracionLoop() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator == null || !vibrator.hasVibrator()) return;
            long[] patron = {0, 500, 400, 500, 400}; // espera/vibra/...
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator.vibrate(VibrationEffect.createWaveform(patron, 0)); // 0 = repetir
            } else {
                vibrator.vibrate(patron, 0);
            }
        } catch (Exception e) {
            Log.w(TAG, "Vibración no disponible: " + e.getMessage());
        }
    }

    private void programarAutoStop() {
        autoStopRunnable = () -> {
            Log.d(TAG, "⏱️ Auto-stop por tiempo máximo");
            detenerTodo();
        };
        handler.postDelayed(autoStopRunnable, AUTO_STOP_MS);
    }

    private void detenerTodo() {
        sonando = false;
        if (handler != null && autoStopRunnable != null) {
            handler.removeCallbacks(autoStopRunnable);
        }
        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }
        if (vibrator != null) {
            try { vibrator.cancel(); } catch (Exception ignored) {}
            vibrator = null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        stopSelf();
        Log.d(TAG, "🛑 Alarma detenida y notificación removida");
    }

    /**
     * Llamado desde MainActivity.onResume() para detener la alarma
     * cuando el usuario abre la app (ya sea por el botón "Ver pedido"
     * o abriendo la app directamente desde el drawer/recientes).
     */
    public static void detenerDesdeActividad(Context context) {
        Intent i = new Intent(context, AlarmaPedidoService.class);
        i.setAction(ACTION_STOP);
        context.startService(i);
        Log.d(TAG, "🔕 Alarma detenida porque la app volvió al frente");
    }

    private void abrirApp() {
        Intent i = new Intent(this, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try { startActivity(i); } catch (Exception e) { Log.e(TAG, "No se pudo abrir la app: " + e.getMessage()); }
    }

    private Notification construirNotificacion(String titulo, String cuerpo, String pedidoId) {
        // ✅ "Ver pedido": abre MainActivity directamente (no el Service)
        Intent abrirAppIntent = new Intent(this, MainActivity.class);
        abrirAppIntent.setAction(ACTION_VER);
        abrirAppIntent.putExtra(EXTRA_PEDIDO_ID, pedidoId);
        abrirAppIntent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK |
                Intent.FLAG_ACTIVITY_SINGLE_TOP |
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        );
        PendingIntent verPI = PendingIntent.getActivity(
                this, 1,
                abrirAppIntent,
                pendingFlags());

        // ✅ "Silenciar": para el Service (no necesita abrir la app)
        PendingIntent silenciarPI = PendingIntent.getService(
                this, 2,
                new Intent(this, AlarmaPedidoService.class).setAction(ACTION_STOP),
                pendingFlags());

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(titulo)
                .setContentText(cuerpo)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM) // alarma insistente, NO "llamada"
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                // ❌ SIN setFullScreenIntent: con la pantalla bloqueada Android lo
                //    disparaba solo y abría la app. Ahora solo suena en bucle y
                //    muestra la notificación; el domiciliario abre con "Ver pedido".
                .setContentIntent(verPI) // tocar la notificación = abrir + detener
                .addAction(android.R.drawable.ic_menu_view, "Ver pedido", verPI)
                .addAction(android.R.drawable.ic_lock_silent_mode, "Silenciar", silenciarPI)
                .build();
    }

    private int pendingFlags() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            return PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        }
        return PendingIntent.FLAG_UPDATE_CURRENT;
    }

    private void crearCanal() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm.getNotificationChannel(CHANNEL_ID) != null) return;

            NotificationChannel canal = new NotificationChannel(
                    CHANNEL_ID,
                    "Alarma de nuevo pedido",
                    NotificationManager.IMPORTANCE_HIGH);
            canal.setDescription("Alarma persistente cuando llega un pedido y la app está cerrada");
            canal.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            canal.enableVibration(false);   // la vibración la maneja el service (en bucle)
            canal.setSound(null, null);     // el sonido lo maneja el MediaPlayer (en bucle)
            canal.setBypassDnd(false);
            nm.createNotificationChannel(canal);
        }
    }

    @Override
    public void onDestroy() {
        detenerTodo();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}