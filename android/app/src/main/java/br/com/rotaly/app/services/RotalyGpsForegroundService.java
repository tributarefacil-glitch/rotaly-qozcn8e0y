package br.com.rotaly.app.services;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONObject;

import br.com.rotaly.app.MainActivity;
import br.com.rotaly.app.R;

/**
 * RotalyGpsForegroundService
 *
 * Foreground Service nativo Android que mantém o GPS contínuo e ininterrupto:
 * - Exibe notificação persistente obrigatória "Rotaly em Operação — Rastreando rota"
 * - Executa com foregroundServiceType="location" (exigência Android 14+)
 * - Utiliza FusedLocationProviderClient com PRIORITY_HIGH_ACCURACY
 * - Mantém WakeLock parcial durante rotas ativas para impedir suspensão com tela apagada
 * - Notifica a MainActivity via broadcast/callback para transmissão à coleção 'locations'
 */
public class RotalyGpsForegroundService extends Service {

    private static final String TAG = "RotalyGpsService";
    public static final String CHANNEL_ID = "rotaly_gps_tracking_channel";
    public static final int NOTIFICATION_ID = 9001;

    public static final String ACTION_START = "ACTION_START";
    public static final String ACTION_STOP = "ACTION_STOP";
    public static final String EXTRA_OPTIONS_JSON = "EXTRA_OPTIONS_JSON";
    public static final String ACTION_LOCATION_BROADCAST = "br.com.rotaly.app.LOCATION_UPDATE";
    public static final String EXTRA_LOCATION_JSON = "EXTRA_LOCATION_JSON";

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;
    private boolean isTracking = false;

    private long intervalMs = 5000;
    private float minDistanceM = 10f;
    private String notificationTitle = "Rotaly em Operação";
    private String notificationText = "Rastreando rota em primeiro plano (GPS ativo)";

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) return;
                for (Location location : locationResult.getLocations()) {
                    if (location != null) {
                        broadcastLocation(location);
                    }
                }
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_START.equals(action)) {
                String optionsJson = intent.getStringExtra(EXTRA_OPTIONS_JSON);
                parseOptions(optionsJson);
                startTrackingForeground();
            } else if (ACTION_STOP.equals(action)) {
                stopTrackingForeground();
                stopSelf();
            }
        }
        return START_STICKY;
    }

    private void parseOptions(String jsonStr) {
        if (jsonStr == null || jsonStr.isEmpty()) return;
        try {
            JSONObject obj = new JSONObject(jsonStr);
            if (obj.has("title")) notificationTitle = obj.getString("title");
            if (obj.has("text")) notificationText = obj.getString("text");
            if (obj.has("minIntervalMs")) intervalMs = obj.getLong("minIntervalMs");
            if (obj.has("minDistanceMeters")) minDistanceM = (float) obj.getDouble("minDistanceMeters");
        } catch (Exception e) {
            Log.w(TAG, "Erro ao parsear opções do serviço:", e);
        }
    }

    private void startTrackingForeground() {
        if (isTracking) return;
        isTracking = true;

        Notification notification = buildNotification(notificationTitle, notificationText);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        acquireWakeLock();
        requestLocationUpdates();
        Log.i(TAG, "Foreground tracking iniciado com sucesso!");
    }

    private void stopTrackingForeground() {
        if (!isTracking) return;
        isTracking = false;

        try {
            if (fusedLocationClient != null && locationCallback != null) {
                fusedLocationClient.removeLocationUpdates(locationCallback);
            }
        } catch (Exception e) {
            Log.w(TAG, "Erro ao remover location updates:", e);
        }

        releaseWakeLock();
        stopForeground(true);
        Log.i(TAG, "Foreground tracking finalizado.");
    }

    private void requestLocationUpdates() {
        try {
            LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                    .setMinUpdateIntervalMillis(intervalMs / 2)
                    .setMinUpdateDistanceMeters(minDistanceM)
                    .setWaitForAccurateLocation(false)
                    .build();

            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper());
        } catch (SecurityException se) {
            Log.e(TAG, "Permissão de localização não concedida para o Foreground Service!", se);
        } catch (Exception e) {
            Log.e(TAG, "Erro ao solicitar updates de GPS:", e);
        }
    }

    private void broadcastLocation(Location location) {
        try {
            JSONObject json = new JSONObject();
            json.put("latitude", location.getLatitude());
            json.put("longitude", location.getLongitude());
            json.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 10.0);
            json.put("speed", location.hasSpeed() ? location.getSpeed() : 0.0);
            json.put("heading", location.hasBearing() ? location.getBearing() : 90.0);
            json.put("altitude", location.hasAltitude() ? location.getAltitude() : 0.0);
            json.put("timestamp", location.getTime() > 0 ? location.getTime() : System.currentTimeMillis());

            Intent broadcastIntent = new Intent(ACTION_LOCATION_BROADCAST);
            broadcastIntent.putExtra(EXTRA_LOCATION_JSON, json.toString());
            sendBroadcast(broadcastIntent);
        } catch (Exception e) {
            Log.e(TAG, "Erro ao emitir broadcast de coordenadas:", e);
        }
    }

    private Notification buildNotification(String title, String content) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                notificationIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0)
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(content)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(pendingIntent)
                .build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Rastreamento de Entregas Rotaly",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Notificação fixa para manter o GPS ativo em segundo plano durante a rota");
            channel.setShowBadge(false);

            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "rotaly:GpsServiceWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(10 * 60 * 60 * 1000L /* 10 horas */);
            }
        } catch (Exception e) {
            Log.w(TAG, "Erro ao adquirir WakeLock:", e);
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception e) {
            Log.w(TAG, "Erro ao liberar WakeLock:", e);
        }
    }

    @Override
    public void onDestroy() {
        stopTrackingForeground();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
