package br.com.rotaly.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import br.com.rotaly.app.services.RotalyGpsForegroundService;

public class MainActivity extends AppCompatActivity {

    private static final String TAG = "MainActivity";
    private static final int PERMISSION_REQUEST_CODE = 1001;
    private static final int BACKGROUND_LOCATION_REQUEST_CODE = 1002;

    private WebView webView;
    private BroadcastReceiver locationBroadcastReceiver;

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        setupWebViewSettings();
        setupBroadcastReceiver();

        // Solicita permissões iniciais no primeiro uso
        checkAndRequestPermissions();

        // Carrega o frontend: inicia na raiz de produção (https://www.rotaly.com.br) sem forçar /courier
        String initialUrl = PRIMARY_URL;
        webView.loadUrl(initialUrl);
    }

    private static final String PRIMARY_URL = "https://www.rotaly.com.br";
    private static final String FALLBACK_PREVIEW_URL = "https://gestao-de-entregas-10f17--preview.goskip.app";
    private boolean hasFailedOverToPreview = false;

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebViewSettings() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUserAgentString(settings.getUserAgentString() + " RotalyNativeApp/1.0.0");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url == null || url.isEmpty()) {
                    return false;
                }
                Uri uri = Uri.parse(url);
                String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
                String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase();

                // WhatsApp: wa.me / api.whatsapp.com / chat.whatsapp.com / whatsapp://
                boolean isWhatsAppLink = scheme.equals("whatsapp") || scheme.equals("whatsapp-send")
                        || host.equals("wa.me") || host.endsWith(".wa.me")
                        || host.equals("api.whatsapp.com")
                        || host.endsWith(".whatsapp.com");
                // Contato direto: telefone / SMS / e-mail (WebView Android não trata sozinho)
                boolean isContactLink = scheme.equals("tel") || scheme.equals("sms") || scheme.equals("mailto");
                // Google Maps (tratamento original preservado)
                boolean isMapLink = scheme.equals("geo") || url.startsWith("https://www.google.com/maps");

                // REDE DE SEGURANÇA ANTI-VAZAMENTO (bug do print: net::ERR_UNKNOWN_URL_SCHEME):
                // QUALQUER esquema que não seja http/https e não seja o app em si (ex.:
                // whatsapp://, intent://, mailto:, tel:, market://) NUNCA pode ser carregado
                // pelo WebView — cai sempre no ACTION_VIEW externo. Assim, mesmo que alguma
                // página (ex.: wa.me) redirecione internamente para whatsapp://send/?...,
                // o esquema nunca vaza para o erro "Página da Web não disponível".
                boolean isWebScheme = scheme.equals("http") || scheme.equals("https");
                boolean isAppInternalScheme = scheme.equals("about") || url.startsWith("javascript:");
                if (!isWebScheme && !isAppInternalScheme) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        return true;
                    } catch (Exception e) {
                        Log.w(TAG, "Nenhum app para tratar o esquema externo " + scheme + ": " + url, e);
                        return true;
                    }
                }

                if (isWhatsAppLink || isContactLink || isMapLink) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                        return true;
                    } catch (android.content.ActivityNotFoundException e) {
                        Log.w(TAG, "Nenhum app para tratar o link externo: " + url, e);
                        // WhatsApp ausente: leva à Play Store; tel/sms sem discador: apenas consome o link
                        if (isWhatsAppLink) {
                            try {
                                Intent store = new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=com.whatsapp"));
                                store.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(store);
                            } catch (Exception ex) {
                                Log.w(TAG, "Falha ao abrir Play Store para instalar o WhatsApp: " + url, ex);
                            }
                        }
                        return true;
                    } catch (Exception e) {
                        Log.w(TAG, "Falha ao abrir link externo no app nativo: " + url, e);
                        return true;
                    }
                }
                return false;
            }

            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                super.onReceivedError(view, errorCode, description, failingUrl);
                handlePageLoadError(view, failingUrl, description);
            }

            @Override
            public void onReceivedError(WebView view, android.webkit.WebResourceRequest request, android.webkit.WebResourceError error) {
                super.onReceivedError(view, request, error);
                if (request != null && request.isForMainFrame()) {
                    String url = request.getUrl() != null ? request.getUrl().toString() : "";
                    String desc = (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && error != null && error.getDescription() != null)
                            ? error.getDescription().toString()
                            : "Erro de conexão";
                    handlePageLoadError(view, url, desc);
                }
            }

            private void handlePageLoadError(WebView view, String failingUrl, String description) {
                Log.w(TAG, "Erro ao carregar URL (" + failingUrl + "): " + description);
                // Fallback automático para o preview se o domínio principal ainda não propagou no DNS
                if (!hasFailedOverToPreview && failingUrl != null &&
                        (failingUrl.contains("rotaly.com.br") || failingUrl.contains("skip.app"))) {
                    hasFailedOverToPreview = true;
                    Log.i(TAG, "Ativando fallback para o preview: " + FALLBACK_PREVIEW_URL);
                    view.post(() -> {
                        Toast.makeText(MainActivity.this, "Conectando ao ambiente de contingência Rotaly...", Toast.LENGTH_SHORT).show();
                        view.loadUrl(FALLBACK_PREVIEW_URL);
                    });
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, android.webkit.GeolocationPermissions.Callback callback) {
                callback.invoke(origin, true, false);
            }
        });

        // Injeta a ponte JavascriptInterface nativa acessível pelo React via window.RotalyNativeGps
        webView.addJavascriptInterface(new RotalyNativeBridge(), "RotalyNativeGps");
    }

    private void setupBroadcastReceiver() {
        locationBroadcastReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (intent != null && RotalyGpsForegroundService.ACTION_LOCATION_BROADCAST.equals(intent.getAction())) {
                    String jsonLocation = intent.getStringExtra(RotalyGpsForegroundService.EXTRA_LOCATION_JSON);
                    if (jsonLocation != null && webView != null) {
                        // Envia a coordenada fresca direto para a janela do React
                        webView.post(() -> {
                            String jsCode = "if (typeof window.onRotalyNativeLocationReceived === 'function') { window.onRotalyNativeLocationReceived(" + jsonLocation + "); }";
                            webView.evaluateJavascript(jsCode, null);
                        });
                    }
                }
            }
        };

        IntentFilter filter = new IntentFilter(RotalyGpsForegroundService.ACTION_LOCATION_BROADCAST);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(locationBroadcastReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(locationBroadcastReceiver, filter);
        }
    }

    private void checkAndRequestPermissions() {
        List<String> permissionsNeeded = new ArrayList<>();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            permissionsNeeded.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                permissionsNeeded.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (!permissionsNeeded.isEmpty()) {
            ActivityCompat.requestPermissions(this, permissionsNeeded.toArray(new String[0]), PERMISSION_REQUEST_CODE);
        } else {
            checkBackgroundLocationPermission();
        }
    }

    private void checkBackgroundLocationPermission() {
        // No Android 10+ (Q), a permissão de segundo plano deve ser solicitada separadamente
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                Toast.makeText(this, "Para rastreamento contínuo durante a entrega, selecione 'Permitir o tempo todo'.", Toast.LENGTH_LONG).show();
                ActivityCompat.requestPermissions(this, new String[]{Manifest.permission.ACCESS_BACKGROUND_LOCATION}, BACKGROUND_LOCATION_REQUEST_CODE);
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQUEST_CODE) {
            checkBackgroundLocationPermission();
        }
    }

    @Override
    protected void onDestroy() {
        if (locationBroadcastReceiver != null) {
            unregisterReceiver(locationBroadcastReceiver);
        }
        super.onDestroy();
    }

    // ==========================================
    // PONTE JAVASCRIPT EXPOSTA AO FRONTEND REACT
    // ==========================================
    public class RotalyNativeBridge {

        @JavascriptInterface
        public boolean startForegroundTracking(String optionsJson) {
            try {
                Intent serviceIntent = new Intent(MainActivity.this, RotalyGpsForegroundService.class);
                serviceIntent.setAction(RotalyGpsForegroundService.ACTION_START);
                serviceIntent.putExtra(RotalyGpsForegroundService.EXTRA_OPTIONS_JSON, optionsJson);
if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    startForegroundService(serviceIntent);
} else {
    startService(serviceIntent);
}
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Erro ao iniciar foreground service:", e);
                return false;
            }
        }

        @JavascriptInterface
        public boolean stopForegroundTracking() {
            try {
                Intent serviceIntent = new Intent(MainActivity.this, RotalyGpsForegroundService.class);
                serviceIntent.setAction(RotalyGpsForegroundService.ACTION_STOP);
                startService(serviceIntent);
                return true;
            } catch (Exception e) {
                Log.e(TAG, "Erro ao parar foreground service:", e);
                return false;
            }
        }

        @JavascriptInterface
        public String isTrackingActive() {
            // Retorna JSON com estado real: { isTracking, lastPingAgeSeconds, isDegraded }
            boolean tracking = RotalyGpsForegroundService.isCurrentlyTracking();
            long lastPing = RotalyGpsForegroundService.getLastPingTimestamp();
            long now = System.currentTimeMillis();
            long ageSec = lastPing > 0 ? Math.max(0, (now - lastPing) / 1000) : -1;
            boolean degraded = tracking && (ageSec > 120 || ageSec == -1);

            try {
                org.json.JSONObject obj = new org.json.JSONObject();
                obj.put("isTracking", tracking);
                obj.put("lastPingTimestamp", lastPing);
                obj.put("lastPingAgeSeconds", ageSec);
                obj.put("isDegraded", degraded);
                return obj.toString();
            } catch (Exception e) {
                return "{\"isTracking\":" + tracking + ",\"lastPingAgeSeconds\":" + ageSec + ",\"isDegraded\":" + degraded + "}";
            }
        }

        @JavascriptInterface
        public void requestAllPermissions() {
            runOnUiThread(() -> checkAndRequestPermissions());
        }

        @JavascriptInterface
        public String checkPermissions() {
            JSONObject obj = new JSONObject();
            try {
                boolean fine = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
                boolean bg = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    bg = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
                }
                boolean notif = true;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    notif = ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
                }
                obj.put("fineLocation", fine);
                obj.put("backgroundLocation", bg);
                obj.put("notifications", notif);
            } catch (Exception ignored) {}
            return obj.toString();
        }

        @JavascriptInterface
        public int getBatteryLevel() {
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
                Log.w(TAG, "Falha na leitura direta de bateria:", e);
            }
            return -1;
        }

        @JavascriptInterface
        public boolean isIgnoringBatteryOptimizations() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
                    if (pm != null) {
                        return pm.isIgnoringBatteryOptimizations(getPackageName());
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Falha ao checar isIgnoringBatteryOptimizations:", e);
            }
            return false;
        }

        @JavascriptInterface
        public boolean requestIgnoreBatteryOptimizations() {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.os.PowerManager pm = (android.os.PowerManager) getSystemService(Context.POWER_SERVICE);
                    String packageName = getPackageName();
                    if (pm != null && !pm.isIgnoringBatteryOptimizations(packageName)) {
                        @SuppressLint("BatteryLife")
                        Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                        intent.setData(Uri.parse("package:" + packageName));
                        startActivity(intent);
                        return true;
                    } else if (pm != null && pm.isIgnoringBatteryOptimizations(packageName)) {
                        return true;
                    }
                }
            } catch (Exception e) {
                Log.w(TAG, "Falha ao solicitar diálogo de isenção direta de bateria, usando fallback de configurações:", e);
                openBatteryOptimizationSettings();
            }
            return false;
        }

        @JavascriptInterface
        public void openBatteryOptimizationSettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
                startActivity(intent);
            } catch (Exception e) {
                openAppSettings();
            }
        }

        @JavascriptInterface
        public void openAppSettings() {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + getPackageName()));
                startActivity(intent);
            } catch (Exception ignored) {}
        }

        /**
         * Abre o WhatsApp nativo direto com a conversa do cliente pronta.
         *
         * POR QUE EXISTE: dentro do WebView, https://wa.me/55... redireciona
         * INTERNAMENTE para whatsapp://send/... e redirecionamentos internos não
         * passam pelo shouldOverrideUrlLoading — estourava net::ERR_UNKNOWN_URL_SCHEME
         * ("Página da Web não disponível") dentro do app. Aqui saímos do WebView
         * antes de qualquer navegação: intent DIRETO com package com.whatsapp.
         *
         * Fallback: se o WhatsApp não estiver instalado, abre https://wa.me/...
         * no NAVEGADOR EXTERNO (ACTION_VIEW fora do WebView).
         *
         * @param phone   número JÁ normalizado pelo helper JS (55 + DDD + número)
         * @param message mensagem pronta (pode ser vazia/null)
         * @return true se algum app externo foi aberto
         */
        @JavascriptInterface
        public boolean openWhatsApp(String phone, String message) {
            try {
                String digits = (phone == null) ? "" : phone.replaceAll("[^0-9]", "");
                if (digits.isEmpty()) {
                    return false;
                }
                if (!digits.startsWith("55") && digits.length() >= 10 && digits.length() <= 13) {
                    digits = "55" + digits;
                }

                // 1) WhatsApp instalado: intent direto no pacote com.whatsapp
                //    (api.whatsapp.com/send é aceito pelo app do WhatsApp e abre a
                //    conversa com número e texto prontos, sem passar pelo WebView).
                try {
                    String waUrl = "https://api.whatsapp.com/send?phone=" + digits
                            + (message != null && !message.trim().isEmpty()
                                    ? "&text=" + Uri.encode(message)
                                    : "");
                    Intent waIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(waUrl));
                    waIntent.setPackage("com.whatsapp");
                    waIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(waIntent);
                    return true;
                } catch (Exception e) {
                    Log.i(TAG, "WhatsApp não disponível para intent direto, usando fallback externo: " + e);
                }

                // 2) Fallback: navegador EXTERNO com wa.me (nunca dentro do WebView)
                try {
                    String webUrl = "https://wa.me/" + digits
                            + (message != null && !message.trim().isEmpty()
                                    ? "?text=" + Uri.encode(message)
                                    : "");
                    Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(webUrl));
                    browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(browserIntent);
                    return true;
                } catch (Exception e) {
                    Log.e(TAG, "Falha ao abrir WhatsApp via navegador externo:", e);
                    return false;
                }
            } catch (Exception e) {
                Log.e(TAG, "Erro ao abrir WhatsApp pela ponte nativa:", e);
                return false;
            }
        }

        @JavascriptInterface
        public boolean openNavigationApp(double lat, double lng, String appName, String label) {
            return openNavigationApp(lat, lng, appName, label, 0, 0, null);
        }

        @JavascriptInterface
        public boolean openNavigationApp(double lat, double lng, String appName, String label, double originLat, double originLng, String waypointsStr) {
            try {
                boolean hasCoords = !Double.isNaN(lat) && !Double.isNaN(lng) &&
                        (Math.abs(lat) > 0.000001 || Math.abs(lng) > 0.000001);
                String destinationText = (label != null && !label.trim().isEmpty()) ? label.trim() : "";

                // Google Maps oficial único: rota otimizada com origem + destino + waypoints
                boolean hasOrigin = !Double.isNaN(originLat) && !Double.isNaN(originLng) &&
                        (Math.abs(originLat) > 0.000001 || Math.abs(originLng) > 0.000001);
                boolean hasWaypoints = waypointsStr != null && !waypointsStr.trim().isEmpty();

                StringBuilder mapsDir = new StringBuilder("https://www.google.com/maps/dir/?api=1");
                if (hasOrigin) {
                    mapsDir.append("&origin=").append(originLat).append(",").append(originLng);
                }
                if (hasCoords) {
                    mapsDir.append("&destination=").append(lat).append(",").append(lng);
                } else if (!destinationText.isEmpty()) {
                    mapsDir.append("&destination=").append(Uri.encode(destinationText));
                }
                if (hasWaypoints) {
                    mapsDir.append("&waypoints=").append(waypointsStr.trim());
                }
                mapsDir.append("&travelmode=driving");
                String mapsWeb = mapsDir.toString();

                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(mapsWeb));
                intent.setPackage("com.google.android.apps.maps");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(intent);
                    return true;
                } catch (Exception fallback) {
                    try {
                        Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(mapsWeb));
                        browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(browserIntent);
                        return true;
                    } catch (Exception ex) {
                        Log.e(TAG, "Falha ao abrir Google Maps via navegador externo:", ex);
                        return false;
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Erro ao abrir app de navegação:", e);
                return false;
            }
        }
    }
}
