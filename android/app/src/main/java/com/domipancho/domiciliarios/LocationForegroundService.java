package com.domipancho.domiciliarios;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;
import android.app.AlarmManager;
import android.os.SystemClock;

public class LocationForegroundService extends Service implements LocationListener {
    private static final String TAG = "LocationService";
    private static final String CHANNEL_ID = "location_tracking_channel";
    private static final int NOTIFICATION_ID = 12345;
    
    private LocationManager locationManager;
    private PowerManager.WakeLock wakeLock;
    private Handler handler;
    private Runnable locationUpdateRunnable;
    private Runnable heartbeatRunnable;
    
    private Location lastLocation;
    private String serverUrl = "https://domipancho.com";
    private long lastUpdateTime = 0;
    private static final long UPDATE_INTERVAL = 10000; // 10 segundos
    
    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "✅ Servicio creado");
        
        createNotificationChannel();
        
        // ✅ Wake Lock PARTIAL - Mantiene CPU activa incluso con pantalla apagada
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "DomiPancho::LocationWakeLock"
        );
        wakeLock.acquire(); // ⚠️ Se libera en onDestroy
        Log.d(TAG, "✅ Wake Lock adquirido");
        
        // ✅ Handler para actualizaciones periódicas
        handler = new Handler(Looper.getMainLooper());
        
        // ✅ Runnable para actualización de ubicación (cada 10 segundos)
        locationUpdateRunnable = new Runnable() {
            @Override
            public void run() {
                if (lastLocation != null) {
                    long currentTime = System.currentTimeMillis();
                    if (currentTime - lastUpdateTime >= UPDATE_INTERVAL) {
                        sendLocationToServer(lastLocation);
                        lastUpdateTime = currentTime;
                    }
                }
                handler.postDelayed(this, UPDATE_INTERVAL);
            }
        };
        
        // ✅ Runnable para heartbeat (cada 60 segundos)
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                sendHeartbeat();
                handler.postDelayed(this, 60000);
            }
        };
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "✅ onStartCommand - Iniciando servicio foreground");
        
        // ✅ Iniciar como Foreground Service INMEDIATAMENTE
        Notification notification = createNotification();
        startForeground(NOTIFICATION_ID, notification);
        
        // ✅ Iniciar tracking de ubicación
        startLocationTracking();
        
        // ✅ Iniciar handlers
        handler.post(locationUpdateRunnable);
        handler.post(heartbeatRunnable);
        
        // ✅ START_STICKY + REDELIVER_INTENT = Android reinicia el servicio si es terminado
        // Y entrega el último intent
        return START_REDELIVER_INTENT;
    }
    
    private void startLocationTracking() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        
        try {
            // ✅ GPS Provider - Máxima precisión
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    5000,  // 5 segundos
                    5,     // 5 metros
                    this,
                    Looper.getMainLooper()
                );
                Log.d(TAG, "✅ GPS Provider activado");
            }
            
            // ✅ Network Provider - Backup
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    10000, // 10 segundos
                    10,    // 10 metros
                    this,
                    Looper.getMainLooper()
                );
                Log.d(TAG, "✅ Network Provider activado");
            }
            
            // ✅ Obtener última ubicación conocida
            Location lastKnownGPS = locationManager.getLastKnownLocation(LocationManager.GPS_PROVIDER);
            Location lastKnownNetwork = locationManager.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
            
            if (lastKnownGPS != null) {
                lastLocation = lastKnownGPS;
                Log.d(TAG, "✅ Última ubicación GPS obtenida");
            } else if (lastKnownNetwork != null) {
                lastLocation = lastKnownNetwork;
                Log.d(TAG, "✅ Última ubicación Network obtenida");
            }
            
        } catch (SecurityException e) {
            Log.e(TAG, "❌ Error de permisos: " + e.getMessage());
        }
    }
    
    @Override
    public void onLocationChanged(Location location) {
        if (location != null) {
            lastLocation = location;
            Log.d(TAG, "📍 Nueva ubicación: " + location.getLatitude() + ", " + location.getLongitude() 
                + " - Precisión: " + location.getAccuracy() + "m");
            
            // ✅ Actualizar notificación con última ubicación
            updateNotificationWithLocation(location);
        }
    }
    
    private void updateNotificationWithLocation(Location location) {
        Notification notification = createNotificationWithLocation(location);
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        notificationManager.notify(NOTIFICATION_ID, notification);
    }
    
    private void sendLocationToServer(Location location) {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(serverUrl + "/api/domiciliario/ubicacion");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
                conn.setDoOutput(true);
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                
                // ✅ Crear JSON
                JSONObject json = new JSONObject();
                json.put("latitud", location.getLatitude());
                json.put("longitud", location.getLongitude());
                json.put("timestamp", System.currentTimeMillis());
                json.put("accuracy", location.getAccuracy());
                json.put("provider", location.getProvider());
                
                // ✅ Enviar
                OutputStream os = conn.getOutputStream();
                os.write(json.toString().getBytes(StandardCharsets.UTF_8));
                os.flush();
                os.close();
                
                int responseCode = conn.getResponseCode();
                if (responseCode == 200) {
                    Log.d(TAG, "✅ Ubicación enviada - Lat: " + location.getLatitude() + ", Lon: " + location.getLongitude());
                } else {
                    Log.e(TAG, "❌ Error enviando ubicación - Código: " + responseCode);
                }
                
            } catch (Exception e) {
                Log.e(TAG, "❌ Error enviando ubicación: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }
    
    private void sendHeartbeat() {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(serverUrl + "/api/domiciliario-heartbeat");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
                conn.setDoOutput(true);
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                
                JSONObject json = new JSONObject();
                OutputStream os = conn.getOutputStream();
                os.write(json.toString().getBytes(StandardCharsets.UTF_8));
                os.flush();
                os.close();
                
                int responseCode = conn.getResponseCode();
                if (responseCode == 200) {
                    Log.d(TAG, "💓 Heartbeat enviado exitosamente");
                } else {
                    Log.e(TAG, "❌ Error heartbeat - Código: " + responseCode);
                }
                
            } catch (Exception e) {
                Log.e(TAG, "❌ Error enviando heartbeat: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
    }
    
    private Notification createNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 
            0, 
            notificationIntent, 
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("DomiPancho - Entrega Activa")
            .setContentText("Rastreando tu ubicación")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true) // ✅ No se puede deslizar para cerrar
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        
        return builder.build();
    }
    
    private Notification createNotificationWithLocation(Location location) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 
            0, 
            notificationIntent, 
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );
        
        String contentText = String.format("Última ubicación: %.5f, %.5f (%.0fm)",
            location.getLatitude(), 
            location.getLongitude(),
            location.getAccuracy());
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("DomiPancho - Entrega Activa")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        
        return builder.build();
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Rastreo de Ubicación Activo",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Rastreo continuo de ubicación para entregas activas");
            channel.setShowBadge(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.enableLights(false);
            channel.enableVibration(false);
            channel.setSound(null, null);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            manager.createNotificationChannel(channel);
            Log.d(TAG, "✅ Canal de notificación creado");
        }
    }
    
    @Override
    public void onDestroy() {
        Log.w(TAG, "⚠️ onDestroy llamado - Limpiando recursos");
        
        // ✅ Limpiar recursos
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (Exception e) {
                Log.e(TAG, "Error removiendo location updates: " + e.getMessage());
            }
        }
        
        if (handler != null) {
            handler.removeCallbacks(locationUpdateRunnable);
            handler.removeCallbacks(heartbeatRunnable);
        }
        
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.d(TAG, "✅ Wake Lock liberado");
        }
        
        super.onDestroy();
        
        // ✅ REINICIAR SERVICIO SI FUE MATADO
        Log.w(TAG, "🔄 Programando reinicio del servicio...");
        Intent broadcastIntent = new Intent(this, ServiceRestarter.class);
        sendBroadcast(broadcastIntent);
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
    
    // ✅ Métodos requeridos por LocationListener
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
        Log.d(TAG, "📡 Status cambiado: " + provider + " - " + status);
    }
    
    @Override
    public void onProviderEnabled(String provider) {
        Log.d(TAG, "✅ Provider habilitado: " + provider);
        // Reintentar obtener ubicación cuando el provider se habilita
        try {
            locationManager.requestLocationUpdates(
                provider,
                5000,
                5,
                this,
                Looper.getMainLooper()
            );
        } catch (SecurityException e) {
            Log.e(TAG, "Error reactivando provider: " + e.getMessage());
        }
    }
    
    @Override
    public void onProviderDisabled(String provider) {
        Log.w(TAG, "⚠️ Provider deshabilitado: " + provider);
    }
    
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Log.w(TAG, "⚠️ onTaskRemoved - App removida de recientes");
        
        // ✅ CRÍTICO: Reiniciar el servicio cuando se cierra desde recientes
        Intent restartServiceIntent = new Intent(getApplicationContext(), this.getClass());
        restartServiceIntent.setPackage(getPackageName());
        
        PendingIntent restartPendingIntent = PendingIntent.getService(
            getApplicationContext(),
            1,
            restartServiceIntent,
            PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_IMMUTABLE
        );
        
        AlarmManager alarmManager = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
        alarmManager.set(
            AlarmManager.ELAPSED_REALTIME,
            SystemClock.elapsedRealtime() + 1000,
            restartPendingIntent
        );
        
        super.onTaskRemoved(rootIntent);
    }
}