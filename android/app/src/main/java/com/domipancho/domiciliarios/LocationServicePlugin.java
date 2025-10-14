package com.domipancho.domiciliarios;

import android.content.Intent;
import android.os.Build;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "LocationService")
public class LocationServicePlugin extends Plugin {
    
    private static final String TAG = "LocationServicePlugin";

    @PluginMethod
    public void startLocationService(PluginCall call) {
        Log.d(TAG, "✅ Iniciando servicio de ubicación...");
        
        try {
            Intent serviceIntent = new Intent(getContext(), LocationForegroundService.class);
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(serviceIntent);
            } else {
                getContext().startService(serviceIntent);
            }
            
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("message", "Location service started");
            call.resolve(ret);
            
            Log.d(TAG, "✅ Servicio de ubicación iniciado correctamente");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error iniciando servicio: " + e.getMessage());
            call.reject("Error starting location service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stopLocationService(PluginCall call) {
        Log.d(TAG, "🛑 Deteniendo servicio de ubicación...");
        
        try {
            Intent serviceIntent = new Intent(getContext(), LocationForegroundService.class);
            getContext().stopService(serviceIntent);
            
            // ✅ QUITAR NOTIFICACIÓN EXPLÍCITAMENTE
            android.app.NotificationManager notificationManager = 
                (android.app.NotificationManager) getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE);
            notificationManager.cancel(12345); // ID de la notificación
            
            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("message", "Location service stopped and notification removed");
            call.resolve(ret);
            
            Log.d(TAG, "✅ Servicio detenido y notificación removida");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error deteniendo servicio: " + e.getMessage());
            call.reject("Error stopping location service: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isServiceRunning(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("isRunning", true);
        call.resolve(ret);
    }
}