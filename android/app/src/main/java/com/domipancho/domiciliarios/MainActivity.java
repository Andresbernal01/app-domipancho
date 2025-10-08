package com.domipancho.domiciliarios;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // ✅ Crear canales de notificación al iniciar
        NotificationChannels.createChannels(this);
    }
}