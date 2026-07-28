package com.domipancho.domiciliarios;

import android.os.Bundle;
import android.content.Intent;
import android.os.PowerManager;
import android.provider.Settings;
import android.net.Uri;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    private static final int REQUEST_IGNORE_BATTERY_OPTIMIZATIONS = 1001;

    // ✅ Lo lee PedidosMessagingService para saber si la app está visible.
    //    Si está en primer plano, el JS maneja la alarma (banner + sonido) y el
    //    servicio nativo NO suena, evitando sonido doble.
    public static volatile boolean isAppForeground = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ✅ REGISTRAR PLUGIN ANTES DE super.onCreate()
        registerPlugin(LocationServicePlugin.class);
        
        super.onCreate(savedInstanceState);
        
        // ✅ Crear canales de notificación
        NotificationChannels.createChannels(this);
        
        // ✅ Solicitar excepción de optimización de batería
        solicitarExcepcionBateria();
    }

    private void solicitarExcepcionBateria() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        String packageName = getPackageName();
        
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
            if (!pm.isIgnoringBatteryOptimizations(packageName)) {
                Intent intent = new Intent();
                intent.setAction(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(Uri.parse("package:" + packageName));
                startActivityForResult(intent, REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        isAppForeground = true; // ✅
        // ✅ Si había una alarma sonando en segundo plano, pararla al volver al frente
        AlarmaPedidoService.detenerDesdeActividad(this);
        TrackingStateManager.restoreTrackingIfNeeded(this);
    }

    /**
     * Se dispara cuando la app ya está en primer plano y el usuario toca
     * el botón "Ver pedido" de la notificación (FLAG_ACTIVITY_SINGLE_TOP).
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && AlarmaPedidoService.ACTION_VER.equals(intent.getAction())) {
            AlarmaPedidoService.detenerDesdeActividad(this);
        }
    }

    @Override
    public void onPause() {
        super.onPause();
        isAppForeground = false; // ✅
    }

    @Override
    public void onDestroy() {
        // NO detener servicio aquí
        super.onDestroy();
    }
}