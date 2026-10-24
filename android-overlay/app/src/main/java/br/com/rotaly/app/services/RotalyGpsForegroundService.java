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

    private long intervalMs = 5000L; // Cadência contínua de ~5s em rota ativa
    private float minDistanceM = 10f; // 10m de deslocamento para detecção ágil
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
            long minFastestIntervalMs = 3000L;
            LocationRequest locationRequest = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
                    .setMinUpdateIntervalMillis(minFastestIntervalMs)
                    .setMinUpdateDistanceMeters(minDistanceM)
                    .setWaitForAccurateLocation(false)
                    .setMaxUpdateDelayMillis(10000L) // Força entrega em no máximo 10s mesmo em batch do SO
                    .build();

            fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper());
            Log.i(TAG, "LocationRequest registrado com interval=" + intervalMs + "ms, minDistance=" + minDistanceM + "m");
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

    /**
     * Obtém o nível de bateria atual do dispositivo via Android BatteryManager nativo.
     * Retorna valor inteiro de 1 a 100, ou -1 se indisponível.
     * NUNCA retorna 0 como valor falso.
     */
    private int getNativeBatteryLevel() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                android.os.BatteryManager bm = (android.os.BatteryManager) getSystemService(Context.BATTERY_SERVICE);
                if (bm != null) {
                    int val = bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
                    if (val > 0 && val <= 100) {
                        return val;
                    }
                }
            }
            IntentFilter ifilter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            Intent batteryStatus = registerReceiver(null, ifilter);
            if (batteryStatus != null) {
                int level = batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1);
                int scale = batteryStatus.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1);
                if (level > 0 && scale > 0) {
                    int pct = Math.round((level / (float) scale) * 100.0f);
                    if (pct > 0 && pct <= 100) {
                        return pct;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Falha ao obter nível de bateria nativo:", e);
        }
        return -1;
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

                // FILTRO DE QUALIDADE NATIVO:
                // Descartar pings com accuracy absurda (> 2000m) e velocidade impossível (> 200 km/h)
                float acc = location.hasAccuracy() ? location.getAccuracy() : 10.0f;
                if (acc > 2000f) {
                    Log.w(TAG, "Ping nativo descartado por accuracy absurda: " + acc + "m");
                    conn.disconnect();
                    return;
                }

                float rawSpeedMps = location.hasSpeed() ? location.getSpeed() : 0.0f;
                float speedKmh = rawSpeedMps * 3.6f;
                if (speedKmh > 200f) {
                    Log.w(TAG, "Velocidade impossível reportada pelo GPS (" + speedKmh + " km/h) — forçando speed para 0");
                    speedKmh = 0.0f;
                }

                JSONObject payload = new JSONObject();
                payload.put("user_id", userId);
                payload.put("lat", location.getLatitude());
                payload.put("lng", location.getLongitude());
                payload.put("speed", Math.round(speedKmh * 10.0f) / 10.0);
                payload.put("heading", location.hasBearing() ? location.getBearing() : 0.0);
                payload.put("accuracy", Math.round(acc * 10.0f) / 10.0);
                payload.put("gps_status", "active");
                payload.put("offline_buffered", false);

                // Leitura nativa real da bateria: NUNCA grava 0 falso
                int battery = getNativeBatteryLevel();
                if (battery > 0 && battery <= 100) {
                    payload.put("battery_level", battery);
                }

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

            double lat = location.getLatitude();
            double lng = location.getLongitude();

            // REGRA: Nunca enfileirar coordenada idêntica consecutiva no buffer offline
            if (arr.length() > 0) {
                JSONObject lastItem = arr.getJSONObject(arr.length() - 1);
                double lastLat = lastItem.optDouble("lat", Double.NaN);
                double lastLng = lastItem.optDouble("lng", Double.NaN);
                if (Math.abs(lastLat - lat) < 0.0000001 && Math.abs(lastLng - lng) < 0.0000001) {
                    // Atualizar apenas o timestamp do último item ao invés de duplicar
                    lastItem.put("timestamp", originalTimestamp);
                    if (location.hasSpeed()) lastItem.put("speed", location.getSpeed());
                    if (location.hasAccuracy()) lastItem.put("accuracy", location.getAccuracy());
                    prefs.edit().putString(PREF_OFFLINE_QUEUE, arr.toString()).apply();
                    return;
                }
            }

            JSONObject item = new JSONObject();
            item.put("lat", lat);
            item.put("lng", lng);
            float speedKmh = location.hasSpeed() ? (location.getSpeed() * 3.6f) : 0.0f;
            if (speedKmh > 200f) speedKmh = 0.0f;
            item.put("speed", Math.round(speedKmh * 10.0f) / 10.0);
            item.put("heading", location.hasBearing() ? location.getBearing() : 0.0);
            item.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 10.0);
            item.put("timestamp", originalTimestamp);

            int battery = getNativeBatteryLevel();
            if (battery > 0 && battery <= 100) {
                item.put("battery_level", battery);
            }

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

                int firstFailedIndex = -1;
                double lastSentLat = Double.NaN;
                double lastSentLng = Double.NaN;

                for (int i = 0; i < arr.length(); i++) {
                    JSONObject item = arr.getJSONObject(i);
                    double itemLat = item.optDouble("lat", Double.NaN);
                    double itemLng = item.optDouble("lng", Double.NaN);

                    // GUARD: Nunca reenviar coordenada idêntica consecutiva da fila
                    if (!Double.isNaN(lastSentLat) && !Double.isNaN(lastSentLng)
                            && Math.abs(lastSentLat - itemLat) < 0.0000001
                            && Math.abs(lastSentLng - itemLng) < 0.0000001) {
                        // Descarta/consome duplicata consecutiva idêntica sem disparar requisição ao backend
                        continue;
                    }

                    boolean itemSuccess = false;
                    boolean shouldDiscardOnError = false;
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
                        payload.put("lat", itemLat);
                        payload.put("lng", itemLng);
                        payload.put("speed", item.optDouble("speed", 0.0));
                        payload.put("heading", item.optDouble("heading", 0.0));
                        payload.put("accuracy", item.optDouble("accuracy", 10.0));
                        payload.put("gps_status", "active");
                        payload.put("offline_buffered", true);

                        int itemBattery = item.optInt("battery_level", -1);
                        if (itemBattery > 0 && itemBattery <= 100) {
                            payload.put("battery_level", itemBattery);
                        }

                        payload.put("location_timestamp", sdf.format(new Date(item.getLong("timestamp"))));

                        byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                        try (OutputStream os = conn.getOutputStream()) {
                            os.write(body);
                        }

                        int code = conn.getResponseCode();
                        conn.disconnect();
                        if (code >= 200 && code < 300) {
                            itemSuccess = true;
                            lastSentLat = itemLat;
                            lastSentLng = itemLng;
                        } else if (code == 400) {
                            // 400 Bad Request: payload inválido/rejeitado permanentemente pelo backend — descartar item para evitar loop
                            shouldDiscardOnError = true;
                            Log.w(TAG, "Item do buffer rejeitado com HTTP 400 — descartando para evitar loop.");
                        }
                    } catch (Exception sendErr) {
                        Log.w(TAG, "Falha de rede ao descarregar item " + i + " do buffer:", sendErr);
                    }

                    if (!itemSuccess && !shouldDiscardOnError) {
                        // Falha de rede / 5xx transitória: interrompe o loop e mantém a partir deste item
                        firstFailedIndex = i;
                        break;
                    }
                }

                JSONArray remaining = new JSONArray();
                if (firstFailedIndex >= 0) {
                    for (int k = firstFailedIndex; k < arr.length(); k++) {
                        remaining.put(arr.getJSONObject(k));
                    }
                }
                // Se firstFailedIndex == -1, todos os itens foram consumidos/enviados ou descartados com 400!

                prefs.edit().putString(PREF_OFFLINE_QUEUE, remaining.toString()).apply();
                Log.i(TAG, "Flush de fila offline concluído. Consumidos: " + (arr.length() - remaining.length()) + ", Restantes: " + remaining.length());
            } catch (Exception e) {
                Log.e(TAG, "Erro ao esvaziar fila offline:", e);
            }
        });
    }

    private void broadcastLocation(Location location) {
        try {
            JSONObject json = new JSONObject();
            json.put("latitude", location.getLatitude());
            json.put("longitude", location.getLongitude());
            json.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : 10.0);
            float speedKmh = location.hasSpeed() ? (location.getSpeed() * 3.6f) : 0.0f;
            if (speedKmh > 200f) speedKmh = 0.0f;
            json.put("speed", Math.round(speedKmh * 10.0f) / 10.0);
            json.put("heading", location.hasBearing() ? location.getBearing() : 90.0);
            json.put("altitude", location.hasAltitude() ? location.getAltitude() : 0.0);
            json.put("timestamp", location.getTime() > 0 ? location.getTime() : System.currentTimeMillis());

            int battery = getNativeBatteryLevel();
            if (battery > 0 && battery <= 100) {
                json.put("batteryLevel", battery);
                json.put("battery_level", battery);
            }

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
