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
                if (url.startsWith("waze://") || url.startsWith("https://waze.com") ||
                    url.startsWith("geo:") || url.startsWith("https://www.google.com/maps")) {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        startActivity(intent);
                        return true;
                    } catch (Exception e) {
                        Log.w(TAG, "Falha ao abrir intent de mapa externa: " + url, e);
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
        public boolean isTrackingActive() {
            return true;
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

        @JavascriptInterface
        public boolean openNavigationApp(double lat, double lng, String appName, String label) {
            try {
                boolean hasCoords = !Double.isNaN(lat) && !Double.isNaN(lng) &&
                        (Math.abs(lat) > 0.000001 || Math.abs(lng) > 0.000001);
                String destinationText = (label != null && !label.trim().isEmpty()) ? label.trim() : "";

                if ("waze".equalsIgnoreCase(appName)) {
                    String wazeUrl;
                    if (hasCoords) {
                        wazeUrl = "https://waze.com/ul?ll=" + lat + "," + lng + "&navigate=yes";
                    } else if (!destinationText.isEmpty()) {
                        wazeUrl = "https://waze.com/ul?q=" + Uri.encode(destinationText) + "&navigate=yes";
                    } else {
                        wazeUrl = "https://waze.com/ul";
                    }

                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(wazeUrl));
                    intent.setPackage("com.waze");
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        startActivity(intent);
                        return true;
                    } catch (Exception fallback) {
                        // Se app Waze não estiver instalado ou falhar, abre via Intent genérica com fallback no navegador externo
                        try {
                            Intent browserIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(wazeUrl));
                            browserIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            startActivity(browserIntent);
                            return true;
                        } catch (Exception ex) {
                            Log.e(TAG, "Falha ao abrir Waze via navegador externo:", ex);
                            return false;
                        }
                    }
                } else {
                    // Google Maps / Navegação
                    Intent intent;
                    String mapsWeb;
                    if (hasCoords) {
                        String uriStr = "google.navigation:q=" + lat + "," + lng;
                        intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uriStr));
                        mapsWeb = "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng;
                    } else if (!destinationText.isEmpty()) {
                        String uriStr = "geo:0,0?q=" + Uri.encode(destinationText);
                        intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uriStr));
                        mapsWeb = "https://www.google.com/maps/search/?api=1&query=" + Uri.encode(destinationText);
                    } else {
                        String uriStr = "geo:0,0";
                        intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uriStr));
                        mapsWeb = "https://www.google.com/maps";
                    }

                    intent.setPackage("com.google.android.apps.maps");
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        startActivity(intent);
                        return true;
                    } catch (Exception fallback) {
                        // Se app Google Maps nativo não estiver disponível, abre via navegador do sistema
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
                }
            } catch (Exception e) {
                Log.e(TAG, "Erro ao abrir app de navegação:", e);
                return false;
            }
        }
    }
}
