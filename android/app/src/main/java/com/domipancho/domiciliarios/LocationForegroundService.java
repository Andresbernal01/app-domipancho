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
    private boolean tienePedidosActivos = false; // ✅ NUEVO
    
    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "✅ Servicio creado");
        
        createNotificationChannel();
        
        // ✅ Wake Lock PARTIAL
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "DomiPancho::LocationWakeLock"
        );
        wakeLock.acquire();
        Log.d(TAG, "✅ Wake Lock adquirido");
        
        handler = new Handler(Looper.getMainLooper());
        
        // ✅ Runnable para actualización de ubicación
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
        
        // ✅ Runnable para heartbeat + verificar pedidos activos
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                sendHeartbeat();
                verificarPedidosActivos(); // ✅ NUEVO
                handler.postDelayed(this, 30000); // Cada 30 segundos
            }
        };
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "✅ onStartCommand - Iniciando servicio foreground");
        
        // ✅ Verificar si tiene pedidos activos al iniciar
        verificarPedidosActivos();
        
        // ✅ Iniciar como Foreground Service
        Notification notification = createNotification();
        startForeground(NOTIFICATION_ID, notification);
        
        // ✅ Iniciar tracking
        startLocationTracking();
        
        // ✅ Iniciar handlers
        handler.post(locationUpdateRunnable);
        handler.post(heartbeatRunnable);
        
        return START_REDELIVER_INTENT;
    }
    
    private void startLocationTracking() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        
        try {
            // ✅ GPS Provider
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER,
                    5000,
                    5,
                    this,
                    Looper.getMainLooper()
                );
                Log.d(TAG, "✅ GPS Provider activado");
            }
            
            // ✅ Network Provider
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    10000,
                    10,
                    this,
                    Looper.getMainLooper()
                );
                Log.d(TAG, "✅ Network Provider activado");
            }
            
            // ✅ Última ubicación conocida
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
            
            // ✅ Actualizar notificación
            updateNotificationWithLocation(location);
        }
    }
    
    private void updateNotificationWithLocation(Location location) {
        Notification notification = createNotificationWithLocation(location);
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        notificationManager.notify(NOTIFICATION_ID, notification);
    }
    
    // ✅ NUEVA FUNCIÓN: Verificar si tiene pedidos activos
    private void verificarPedidosActivos() {
        new Thread(() -> {
            HttpURLConnection conn = null;
            try {
                URL url = new URL(serverUrl + "/api/pedidos-domiciliario");
                conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("GET");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setRequestProperty("X-Requested-With", "XMLHttpRequest");
                conn.setConnectTimeout(10000);
                conn.setReadTimeout(10000);
                
                int responseCode = conn.getResponseCode();
                if (responseCode == 200) {
                    // Leer respuesta
                    java.io.BufferedReader br = new java.io.BufferedReader(
                        new java.io.InputStreamReader(conn.getInputStream(), "utf-8")
                    );
                    StringBuilder response = new StringBuilder();
                    String responseLine;
                    while ((responseLine = br.readLine()) != null) {
                        response.append(responseLine.trim());
                    }
                    
                    // Parsear JSON
                    org.json.JSONArray pedidos = new org.json.JSONArray(response.toString());
                    
                    // Contar pedidos "camino a tu casa"
                    int count = 0;
                    for (int i = 0; i < pedidos.length(); i++) {
                        JSONObject pedido = pedidos.getJSONObject(i);
                        String estado = pedido.optString("estado", "");
                        if ("camino a tu casa".equals(estado)) {
                            count++;
                        }
                    }
                    
                    boolean tienePedidos = count > 0;
                    
                    // Solo actualizar si cambió
                    if (tienePedidosActivos != tienePedidos) {
                        tienePedidosActivos = tienePedidos;
                        Log.d(TAG, "📊 Pedidos activos: " + tienePedidos);
                        
                        // Actualizar notificación
                        if (lastLocation != null) {
                            handler.post(() -> updateNotificationWithLocation(lastLocation));
                        }
                    }
                    
                } else {
                    Log.e(TAG, "❌ Error verificando pedidos - Código: " + responseCode);
                }
                
            } catch (Exception e) {
                Log.e(TAG, "❌ Error verificando pedidos: " + e.getMessage());
            } finally {
                if (conn != null) {
                    conn.disconnect();
                }
            }
        }).start();
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
                
                JSONObject json = new JSONObject();
                json.put("latitud", location.getLatitude());
                json.put("longitud", location.getLongitude());
                json.put("timestamp", System.currentTimeMillis());
                json.put("accuracy", location.getAccuracy());
                json.put("provider", location.getProvider());
                
                OutputStream os = conn.getOutputStream();
                os.write(json.toString().getBytes(StandardCharsets.UTF_8));
                os.flush();
                os.close();
                
                int responseCode = conn.getResponseCode();
                if (responseCode == 200) {
                    Log.d(TAG, "✅ Ubicación enviada");
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
                    Log.d(TAG, "💓 Heartbeat enviado");
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
        
        // ✅ Texto según tenga pedidos o no
        String titulo = tienePedidosActivos ? 
            "DomiPancho - Entrega Activa" : 
            "DomiPancho - Rastreando Ubicación";
        
        String texto = tienePedidosActivos ?
            "Realizando entrega" :
            "Buscando pedidos cercanos";
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(titulo)
            .setContentText(texto)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
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
        
        // ✅ CAMBIAR TEXTO SEGÚN TENGA PEDIDOS ACTIVOS O NO
        String titulo;
        String contentText;
        
        if (tienePedidosActivos) {
            titulo = "DomiPancho - Entrega Activa";
            contentText = String.format("Última ubicación: %.5f, %.5f (%.0fm)",
                location.getLatitude(), 
                location.getLongitude(),
                location.getAccuracy());
        } else {
            titulo = "DomiPancho - Rastreando Ubicación";
            contentText = String.format("Buscando pedidos cercanos (%.0fm precisión)",
                location.getAccuracy());
        }
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(titulo)
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
        
        // ✅ NO REINICIAR si el usuario marcó "no disponible"
        // El servicio solo se reiniciará automáticamente si fue matado por el sistema
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
    
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
        Log.d(TAG, "📡 Status cambiado: " + provider + " - " + status);
    }
    
    @Override
    public void onProviderEnabled(String provider) {
        Log.d(TAG, "✅ Provider habilitado: " + provider);
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
        
        // ✅ REINICIAR SERVICIO SI ESTÁ DISPONIBLE
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