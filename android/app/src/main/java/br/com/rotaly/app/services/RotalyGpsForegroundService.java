package br.com.rotaly.app.services;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import br.com.rotaly.app.MainActivity;
import br.com.rotaly.app.R;

public class RotalyGpsForegroundService extends Service {
    private static final String TAG = "RotalyGpsService";
    private static final String CHANNEL_ID = "rotaly_gps_channel_v1";
    private static final int NOTIFICATION_ID = 91823;

    public static final String ACTION_START = "br.com.rotaly.app.action.START_TRACKING";
    public static final String ACTION_STOP = "br.com.rotaly.app.action.STOP_TRACKING";
    public static final String EXTRA_OPTIONS_JSON = "extra_options_json";

    public static final String ACTION_LOCATION_BROADCAST = "br.com.rotaly.app.LOCATION_UPDATE";
    public static final String EXTRA_LOCATION_JSON = "location_json";

    private static final String PREFS_NAME = "rotaly_gps_prefs";
    private static final String PREF_IS_TRACKING = "pref_is_tracking";
    private static final String PREF_BASE_URL = "pref_base_url";
    private static final String PREF_AUTH_TOKEN = "pref_auth_token";
    private static final String PREF_USER_ID = "pref_user_id";
    private static final String PREF_INTERVAL_MS = "pref_interval_ms";
    private static final String PREF_MIN_DISTANCE_M = "pref_min_distance_m";
    private static final String PREF_OFFLINE_QUEUE = "pref_offline_queue";
    private static final String PREF_LAST_PING_TIMESTAMP = "pref_last_ping_timestamp";

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;

    private static volatile boolean isTracking = false;
    private static volatile long lastPingTimestamp = 0L;

    private long intervalMs = 30000L; // 30s
    private float minDistanceM = 18f;  // 18m
    private String notificationTitle = "Rastreamento de Entregas Rotaly";
    private String notificationText = "GPS em segundo plano ativo para cômputo da rota e segurança";

    private String baseUrl = "";
    private String authToken = "";
    private String userId = "";

    private final ExecutorService networkExecutor = Executors.newSingleThreadExecutor();

    public static boolean isCurrentlyTracking() {
        return isTracking;
    }

    public static long getLastPingTimestamp() {
        return lastPingTimestamp;
    }

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
                        handleNewLocation(location);
                    }
                }
            }
        };
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);

        if (intent != null) {
            String action = intent.getAction();
            if (ACTION_START.equals(action)) {
                String optionsJson = intent.getStringExtra(EXTRA_OPTIONS_JSON);
                parseOptionsAndPersist(optionsJson, prefs);
                startTrackingForeground();
            } else if (ACTION_STOP.equals(action)) {
                stopTrackingForeground();
                prefs.edit().putBoolean(PREF_IS_TRACKING, false).apply();
                stopSelf();
            }
        } else {
            // REINICIALIZAÇÃO AUTOMÁTICA START_STICKY PELO ANDROID (após kill do SO)
            Log.i(TAG, "onStartCommand com intent NULL (START_STICKY após kill). Recuperando estado persistido...");
            boolean wasTracking = prefs.getBoolean(PREF_IS_TRACKING, false);
            if (wasTracking) {
                restoreFromPreferences(prefs);
                startTrackingForeground();
            } else {
                stopSelf();
            }
        }
        return START_STICKY;
    }

    private void restoreFromPreferences(SharedPreferences prefs) {
        baseUrl = prefs.getString(PREF_BASE_URL, "");
        authToken = prefs.getString(PREF_AUTH_TOKEN, "");
        userId = prefs.getString(PREF_USER_ID, "");
        intervalMs = prefs.getLong(PREF_INTERVAL_MS, 30000L);
        minDistanceM = prefs.getFloat(PREF_MIN_DISTANCE_M, 18f);
        lastPingTimestamp = prefs.getLong(PREF_LAST_PING_TIMESTAMP, 0L);
        Log.i(TAG, "Estado restaurado SharedPreferences: userId=" + userId + ", baseUrl=" + baseUrl);
    }

    private void parseOptionsAndPersist(String jsonStr, SharedPreferences prefs) {
        if (jsonStr == null || jsonStr.isEmpty()) return;
        try {
            JSONObject obj = new JSONObject(jsonStr);
            if (obj.has("title")) notificationTitle = obj.getString("title");
            if (obj.has("text")) notificationText = obj.getString("text");
            if (obj.has("minIntervalMs")) intervalMs = obj.getLong("minIntervalMs");
            if (obj.has("minDistanceMeters")) minDistanceM = (float) obj.getDouble("minDistanceMeters");
            if (obj.has("baseUrl")) baseUrl = obj.getString("baseUrl");
            if (obj.has("token")) authToken = obj.getString("token");
            if (obj.has("userId")) userId = obj.getString("userId");

            SharedPreferences.Editor editor = prefs.edit();
            editor.putBoolean(PREF_IS_TRACKING, true);
            editor.putString(PREF_BASE_URL, baseUrl);
            editor.putString(PREF_AUTH_TOKEN, authToken);
            editor.putString(PREF_USER_ID, userId);
            editor.putLong(PREF_INTERVAL_MS, intervalMs);
            editor.putFloat(PREF_MIN_DISTANCE_M, minDistanceM);
            editor.apply();

            Log.i(TAG, "Opções de GPS persistidas com sucesso para userId=" + userId);
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

        // Tentar enviar fila offline remanescente se houver
        flushOfflineQueue();

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
            long minFastestIntervalMs = 5000L;
            LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                    .setMinUpdateIntervalMillis(minFastestIntervalMs)
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

    private void handleNewLocation(Location location) {
        long now = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();
        lastPingTimestamp = now;

        // Atualizar timestamp recente no SharedPreferences
        try {
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putLong(PREF_LAST_PING_TIMESTAMP, now)
                    .apply();
        } catch (Exception ignored) {}

        // 1. Gravar DIRETAMENTE no PocketBase via HTTP POST em thread assíncrona
        postLocationDirectly(location, now);

        // 2. Broadcast para a UI (Capacitor/WebView) vira secundário para animação
        broadcastLocation(location);
    }

    private void postLocationDirectly(Location location, long originalTimestamp) {
        networkExecutor.execute(() -> {
            boolean success = false;
            try {
                if (baseUrl == null || baseUrl.isEmpty() || userId == null || userId.isEmpty()) {
                    // Sem credenciais ainda, enfileirar localmente
                    enqueueOfflinePing(location, originalTimestamp);
                    return;
                }

                String cleanUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
                URL endpoint = new URL(cleanUrl + "/api/collections/locations/records");
                HttpURLConnection conn = (HttpURLConnection) endpoint.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(8000);
                if (authToken != null && !authToken.isEmpty()) {
                    conn.setRequestProperty("Authorization", authToken);
                }
                conn.setDoOutput(true);

                JSONObject payload = new JSONObject();
                payload.put("user_id", userId);
                payload.put("lat", location.getLatitude());
                payload.put("lng", location.getLongitude());
                payload.put("speed", location.hasSpeed() ? location.getSpeed() : 0.0);
                payload.put("heading", location.hasBearing() ? location.getBearing() : 0.0);
                payload.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 10.0);
                payload.put("gps_status", "active");
                payload.put("offline_buffered", false);

                // Timestamp original do ping formatado em UTC ISO 8601
                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS'Z'", Locale.US);
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
                payload.put("location_timestamp", sdf.format(new Date(originalTimestamp)));

                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }

                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    success = true;
                } else {
                    Log.w(TAG, "POST direto de ping retornou HTTP " + code);
                }
                conn.disconnect();
            } catch (Exception e) {
                Log.w(TAG, "Falha de rede ao enviar pingo direto:", e);
            }

            if (!success) {
                enqueueOfflinePing(location, originalTimestamp);
            } else {
                // Ao conseguir enviar com sucesso, tentar esvaziar fila pendente
                flushOfflineQueue();
            }
        });
    }

    private synchronized void enqueueOfflinePing(Location location, long originalTimestamp) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String queueStr = prefs.getString(PREF_OFFLINE_QUEUE, "[]");
            JSONArray arr = new JSONArray(queueStr);

            JSONObject item = new JSONObject();
            item.put("lat", location.getLatitude());
            item.put("lng", location.getLongitude());
            item.put("speed", location.hasSpeed() ? location.getSpeed() : 0.0);
            item.put("heading", location.hasBearing() ? location.getBearing() : 0.0);
            item.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 10.0);
            item.put("timestamp", originalTimestamp);

            // Limitar fila a 1000 pings mais recentes para não esgotar memória
            if (arr.length() > 1000) {
                JSONArray trimmed = new JSONArray();
                for (int i = arr.length() - 900; i < arr.length(); i++) {
                    trimmed.put(arr.get(i));
                }
                arr = trimmed;
            }
            arr.put(item);

            prefs.edit().putString(PREF_OFFLINE_QUEUE, arr.toString()).apply();
            Log.i(TAG, "Ping enfileirado na memória offline (total na fila: " + arr.length() + ")");
        } catch (Exception e) {
            Log.e(TAG, "Erro ao enfileirar ping offline:", e);
        }
    }

    private synchronized void flushOfflineQueue() {
        networkExecutor.execute(() -> {
            try {
                SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
                String queueStr = prefs.getString(PREF_OFFLINE_QUEUE, "[]");
                JSONArray arr = new JSONArray(queueStr);
                if (arr.length() == 0) return;

                if (baseUrl == null || baseUrl.isEmpty() || userId == null || userId.isEmpty()) return;

                String cleanUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
                SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS'Z'", Locale.US);
                sdf.setTimeZone(TimeZone.getTimeZone("UTC"));

                JSONArray remaining = new JSONArray();

                for (int i = 0; i < arr.length(); i++) {
                    JSONObject item = arr.getJSONObject(i);
                    try {
                        URL endpoint = new URL(cleanUrl + "/api/collections/locations/records");
                        HttpURLConnection conn = (HttpURLConnection) endpoint.openConnection();
                        conn.setRequestMethod("POST");
                        conn.setRequestProperty("Content-Type", "application/json");
                        conn.setConnectTimeout(6000);
                        conn.setReadTimeout(6000);
                        if (authToken != null && !authToken.isEmpty()) {
                            conn.setRequestProperty("Authorization", authToken);
                        }
                        conn.setDoOutput(true);

                        JSONObject payload = new JSONObject();
                        payload.put("user_id", userId);
                        payload.put("lat", item.getDouble("lat"));
                        payload.put("lng", item.getDouble("lng"));
                        payload.put("speed", item.optDouble("speed", 0.0));
                        payload.put("heading", item.optDouble("heading", 0.0));
                        payload.put("accuracy", item.optDouble("accuracy", 10.0));
                        payload.put("gps_status", "active");
                        payload.put("offline_buffered", true);
                        payload.put("location_timestamp", sdf.format(new Date(item.getLong("timestamp"))));

                        byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(body);
                        }

                        int code = conn.getResponseCode();
                        conn.disconnect();
                        if (code < 200 || code >= 300) {
                            // Se falhou, manter da posição atual em diante
                            for (int k = i; k < arr.length(); k++) {
                                remaining.put(arr.getJSONObject(k));
                            }
                            break;
                        }
                    } catch (Exception sendErr) {
                        for (int k = i; k < arr.length(); k++) {
                            remaining.put(arr.getJSONObject(k));
                        }
                        break;
                    }
                }

                prefs.edit().putString(PREF_OFFLINE_QUEUE, remaining.toString()).apply();
                Log.i(TAG, "Flush de fila offline concluído. Restantes: " + remaining.length());
            } catch (Exception e) {
                Log.w(TAG, "Erro ao esvaziar fila offline:", e);
            }
        });
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
        networkExecutor.shutdown();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
