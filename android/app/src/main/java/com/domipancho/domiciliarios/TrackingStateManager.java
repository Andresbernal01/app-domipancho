package com.domipancho.domiciliarios;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * Gestiona el estado del tracking para mantenerlo persistente
 * incluso cuando la app se cierra o reinicia
 */
public class TrackingStateManager {
    private static final String PREFS_NAME = "DomiPanchoTracking";
    private static final String KEY_TRACKING_ACTIVE = "tracking_active";
    private static final String KEY_PEDIDO_ACTIVO = "pedido_activo_id";
    private static final String KEY_LAST_UPDATE = "last_update_timestamp";
    private static final String TAG = "TrackingStateManager";

    /**
     * Guarda que el tracking está activo
     */
    public static void setTrackingActive(Context context, boolean active) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putBoolean(KEY_TRACKING_ACTIVE, active)
            .putLong(KEY_LAST_UPDATE, System.currentTimeMillis())
            .apply();
        
        Log.d(TAG, "Tracking activo guardado: " + active);
    }

    /**
     * Verifica si el tracking debe estar activo
     */
    public static boolean isTrackingActive(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean active = prefs.getBoolean(KEY_TRACKING_ACTIVE, false);
        
        Log.d(TAG, "Estado de tracking: " + active);
        return active;
    }

    /**
     * Guarda el ID del pedido activo
     */
    public static void setPedidoActivo(Context context, int pedidoId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putInt(KEY_PEDIDO_ACTIVO, pedidoId)
            .apply();
        
        Log.d(TAG, "Pedido activo guardado: " + pedidoId);
    }

    /**
     * Obtiene el ID del pedido activo (0 si no hay)
     */
    public static int getPedidoActivo(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getInt(KEY_PEDIDO_ACTIVO, 0);
    }

    /**
     * Limpia el estado del tracking
     */
    public static void clearTracking(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putBoolean(KEY_TRACKING_ACTIVE, false)
            .putInt(KEY_PEDIDO_ACTIVO, 0)
            .apply();
        
        Log.d(TAG, "Estado de tracking limpiado");
    }

    /**
     * Restaura el tracking si debe estar activo
     * (llamado desde MainActivity.onResume)
     */
    public static void restoreTrackingIfNeeded(Context context) {
        if (isTrackingActive(context)) {
            int pedidoId = getPedidoActivo(context);
            Log.d(TAG, "Restaurando tracking para pedido: " + pedidoId);
            // El tracking se reiniciará desde JavaScript
        }
    }

    /**
     * Obtiene el timestamp de la última actualización
     */
    public static long getLastUpdateTimestamp(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        return prefs.getLong(KEY_LAST_UPDATE, 0);
    }
}