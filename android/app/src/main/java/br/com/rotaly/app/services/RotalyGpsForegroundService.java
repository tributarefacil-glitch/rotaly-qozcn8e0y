package br.com.rotaly.app.services;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import br.com.rotaly.app.MainActivity;

/**
 * RotalyGpsForegroundService
 *
 * Foreground Service nativo do Android para rastreamento contínuo em segundo plano (estilo iFood).
 * - FusedLocationProviderClient com PRIORITY_HIGH_ACCURACY.
 * - Coleta pings a cada ~5s.
 * - TELEMETRIA EM LOTE: Acumula pings localmente e sobe em lotes (a cada 10 posições ou 30s, o que vier primeiro)
 *   no endpoint /backend/v1/telemetry-batch, reduzindo drasticamente consumo de internet, overhead HTTP e perda de pings.
 * - Fallback automático para o endpoint unitário /api/collections/locations/records se o backend não tiver o batch ou falhar.
 * - Buffer offline persistente no SharedPreferences para perda total de rede, integrado com a fila de envio.
 * - Retry exponencial curto em falhas transitórias.
 */
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

    // Constantes de Lote (estilo iFood)
    private static final int BATCH_SIZE_TRIGGER = 10; // Envia ao atingir 10 pings
    private static final long BATCH_TIME_TRIGGER_MS = 30000L; // Ou a cada 30 segundos
    private static final int MAX_OFFLINE_QUEUE_ITEMS = 1000;

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

    // Fila em memória para acúmulo de lote rápido
    private final List<JSONObject> pendingBatchList = new ArrayList<>();
    private long lastBatchSendTime = System.currentTimeMillis();

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
                // Forçar envio do que resta antes de parar
                flushBatchAndOfflineQueue(true);
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
        flushBatchAndOfflineQueue(false);

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
        Log.i(TAG, "Foreground tracking parado.");
    }

    private void requestLocationUpdates() {
        try {
            long minFastestIntervalMs = Math.max(1000L, intervalMs / 2);

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

        // 1. Processar e enfileirar no lote de telemetria
        queueLocationForBatch(location, now);

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

    /**
     * Acumula o ping no lote de telemetria e dispara envio quando atinge 10 posições ou 30 segundos.
     */
    private synchronized void queueLocationForBatch(Location location, long originalTimestamp) {
        float acc = location.hasAccuracy() ? location.getAccuracy() : 10.0f;
        if (acc > 2000f) {
            Log.w(TAG, "Ping nativo descartado por accuracy absurda: " + acc + "m");
            return;
        }

        float rawSpeedMps = location.hasSpeed() ? location.getSpeed() : 0.0f;
        float speedKmh = rawSpeedMps * 3.6f;
        if (speedKmh > 200f) {
            speedKmh = 0.0f;
        }

        try {
            JSONObject item = new JSONObject();
            item.put("lat", location.getLatitude());
            item.put("lng", location.getLongitude());
            item.put("speed", Math.round(speedKmh * 10.0f) / 10.0);
            item.put("heading", location.hasBearing() ? location.getBearing() : 0.0);
            item.put("accuracy", Math.round(acc * 10.0f) / 10.0);
            item.put("timestamp", originalTimestamp);
            item.put("gps_status", "active");
            item.put("offline_buffered", false);

            int battery = getNativeBatteryLevel();
            if (battery > 0 && battery <= 100) {
                item.put("battery_level", battery);
            }

            // Deduplicação defensiva local de coordenadas congeladas consecutivas
            if (!pendingBatchList.isEmpty()) {
                JSONObject last = pendingBatchList.get(pendingBatchList.size() - 1);
                double lastLat = last.optDouble("lat", Double.NaN);
                double lastLng = last.optDouble("lng", Double.NaN);
                if (Math.abs(lastLat - location.getLatitude()) < 0.0000001 &&
                        Math.abs(lastLng - location.getLongitude()) < 0.0000001) {
                    last.put("timestamp", originalTimestamp);
                    return;
                }
            }

            pendingBatchList.add(item);
            long now = System.currentTimeMillis();

            // Dispara envio se atingir 10 posições ou 30s desde o último envio
            boolean timeExpired = (now - lastBatchSendTime) >= BATCH_TIME_TRIGGER_MS;
            boolean countExceeded = pendingBatchList.size() >= BATCH_SIZE_TRIGGER;

            if (countExceeded || timeExpired) {
                flushBatchAndOfflineQueue(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao preparar item de telemetria em lote:", e);
        }
    }

    /**
     * Esvazia o lote em memória e a fila offline persistente, enviando ao backend.
     */
    private synchronized void flushBatchAndOfflineQueue(boolean forceImmediate) {
        if (baseUrl == null || baseUrl.isEmpty() || userId == null || userId.isEmpty()) {
            persistBatchToOfflineQueue();
            return;
        }

        // Move itens do pendingBatchList para a lista de envio
        final List<JSONObject> toSend = new ArrayList<>(pendingBatchList);
        pendingBatchList.clear();
        lastBatchSendTime = System.currentTimeMillis();

        networkExecutor.execute(() -> {
            boolean batchSuccess = false;
            if (!toSend.isEmpty()) {
                batchSuccess = sendBatchWithRetry(toSend, 2);
                if (!batchSuccess) {
                    // Se falhar o lote, adiciona de volta à fila offline persistida
                    enqueueItemsToOfflineQueue(toSend);
                }
            }

            // Agora verifica se há itens antigos no buffer offline persistido para esvaziar
            flushPersistentOfflineQueue();
        });
    }

    private synchronized void persistBatchToOfflineQueue() {
        if (pendingBatchList.isEmpty()) return;
        enqueueItemsToOfflineQueue(new ArrayList<>(pendingBatchList));
        pendingBatchList.clear();
    }

    private synchronized void enqueueItemsToOfflineQueue(List<JSONObject> items) {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String queueStr = prefs.getString(PREF_OFFLINE_QUEUE, "[]");
            JSONArray arr = new JSONArray(queueStr);

            for (JSONObject it : items) {
                // Se for para o buffer offline, marcar offline_buffered
                it.put("offline_buffered", true);
                arr.put(it);
            }

            // Trim se passar de 1000 itens
            if (arr.length() > MAX_OFFLINE_QUEUE_ITEMS) {
                JSONArray trimmed = new JSONArray();
                for (int i = arr.length() - 900; i < arr.length(); i++) {
                    trimmed.put(arr.get(i));
                }
                arr = trimmed;
            }

            prefs.edit().putString(PREF_OFFLINE_QUEUE, arr.toString()).apply();
            Log.i(TAG, "Itens salvos no buffer offline persistente (total na fila: " + arr.length() + ")");
        } catch (Exception e) {
            Log.e(TAG, "Erro ao persistir itens na fila offline:", e);
        }
    }

    /**
     * Envia um lote de posições via POST /backend/v1/telemetry-batch com fallback e retry exponencial curto.
     */
    private boolean sendBatchWithRetry(List<JSONObject> items, int maxRetries) {
        if (items.isEmpty()) return true;

        String cleanUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));

        for (int attempt = 1; attempt <= maxRetries; attempt++) {
            HttpURLConnection conn = null;
            try {
                URL batchEndpoint = new URL(cleanUrl + "/backend/v1/telemetry-batch");
                conn = (HttpURLConnection) batchEndpoint.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(8000);
                conn.setReadTimeout(12000);
                if (authToken != null && !authToken.isEmpty()) {
                    conn.setRequestProperty("Authorization", authToken);
                }
                conn.setDoOutput(true);

                JSONArray batchItems = new JSONArray();
                for (JSONObject it : items) {
                    JSONObject copy = new JSONObject(it.toString());
                    copy.put("user_id", userId);
                    long ts = copy.optLong("timestamp", System.currentTimeMillis());
                    copy.put("location_timestamp", sdf.format(new Date(ts)));
                    batchItems.put(copy);
                }

                JSONObject payload = new JSONObject();
                payload.put("user_id", userId);
                payload.put("items", batchItems);

                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }

                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    Log.i(TAG, "Lote de telemetria enviado com SUCESSO (" + items.size() + " pings, HTTP " + code + ")");
                    return true;
                } else if (code == 404) {
                    // Se o endpoint de lote não existir (ex: proxy desatualizado), fallback para envio individual
                    Log.w(TAG, "Endpoint /backend/v1/telemetry-batch retornou 404. Executando fallback para pings individuais.");
                    return sendItemsIndividuallyFallback(items);
                } else if (code == 400) {
                    // 400 Bad Request permanente: descartar para evitar loop
                    Log.w(TAG, "Lote de telemetria rejeitado com HTTP 400 — descartando.");
                    return true;
                } else {
                    Log.w(TAG, "Tentativa " + attempt + " de envio de lote falhou com HTTP " + code);
                }
            } catch (Exception e) {
                Log.w(TAG, "Tentativa " + attempt + " de envio de lote falhou por exceção de rede: " + e.getMessage());
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }

            if (attempt < maxRetries) {
                try {
                    // Retry exponencial curto: 1.5s, 3s
                    Thread.sleep(attempt * 1500L);
                } catch (InterruptedException ignored) {}
            }
        }

        return false;
    }

    /**
     * Fallback de envio individual se o endpoint de lote falhar com 404.
     */
    private boolean sendItemsIndividuallyFallback(List<JSONObject> items) {
        String cleanUrl = baseUrl.endsWith("/") ? baseUrl.substring(0, baseUrl.length() - 1) : baseUrl;
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));

        boolean allSuccess = true;
        for (JSONObject item : items) {
            HttpURLConnection conn = null;
            try {
                URL endpoint = new URL(cleanUrl + "/api/collections/locations/records");
                conn = (HttpURLConnection) endpoint.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                conn.setConnectTimeout(6000);
                conn.setReadTimeout(6000);
                if (authToken != null && !authToken.isEmpty()) {
                    conn.setRequestProperty("Authorization", authToken);
                }
                conn.setDoOutput(true);

                JSONObject payload = new JSONObject(item.toString());
                payload.put("user_id", userId);
                long ts = payload.optLong("timestamp", System.currentTimeMillis());
                payload.put("location_timestamp", sdf.format(new Date(ts)));

                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body);
                }

                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    allSuccess = false;
                }
            } catch (Exception e) {
                allSuccess = false;
            } finally {
                if (conn != null) {
                    try { conn.disconnect(); } catch (Exception ignored) {}
                }
            }
        }
        return allSuccess;
    }

    /**
     * Esvazia a fila offline do SharedPreferences enviando em lotes de até 50 itens.
     */
    private synchronized void flushPersistentOfflineQueue() {
        try {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String queueStr = prefs.getString(PREF_OFFLINE_QUEUE, "[]");
            JSONArray arr = new JSONArray(queueStr);
            if (arr.length() == 0) return;

            List<JSONObject> chunk = new ArrayList<>();
            int takeCount = Math.min(arr.length(), 50);
            for (int i = 0; i < takeCount; i++) {
                chunk.add(arr.getJSONObject(i));
            }

            boolean ok = sendBatchWithRetry(chunk, 1);
            if (ok) {
                JSONArray remaining = new JSONArray();
                for (int i = takeCount; i < arr.length(); i++) {
                    remaining.put(arr.getJSONObject(i));
                }
                prefs.edit().putString(PREF_OFFLINE_QUEUE, remaining.toString()).apply();
                Log.i(TAG, "Lote do buffer offline enviado com sucesso. Restam " + remaining.length() + " pings.");
            }
        } catch (Exception e) {
            Log.e(TAG, "Erro ao esvaziar fila persistente offline:", e);
        }
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

    private int getAppIconResourceId() {
        int iconId = getApplicationInfo().icon;
        if (iconId <= 0) {
            iconId = getResources().getIdentifier("ic_launcher", "mipmap", getPackageName());
        }
        if (iconId <= 0) {
            iconId = android.R.drawable.ic_dialog_map;
        }
        return iconId;
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

        int smallIcon = getAppIconResourceId();

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(content)
                .setSmallIcon(smallIcon)
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
        flushBatchAndOfflineQueue(true);
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
