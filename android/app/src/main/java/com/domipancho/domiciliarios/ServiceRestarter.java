package com.domipancho.domiciliarios;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

/**
 * BroadcastReceiver que reinicia el servicio de ubicación
 * cuando es terminado por el sistema
 */
public class ServiceRestarter extends BroadcastReceiver {
    private static final String TAG = "ServiceRestarter";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "🔄 ServiceRestarter activado - Reiniciando servicio...");
        
        Intent serviceIntent = new Intent(context, LocationForegroundService.class);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(serviceIntent);
        } else {
            context.startService(serviceIntent);
        }
        
        Log.d(TAG, "✅ Servicio reiniciado");
    }
}