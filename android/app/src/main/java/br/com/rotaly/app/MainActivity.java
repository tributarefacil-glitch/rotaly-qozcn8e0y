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

        // Carrega o frontend (aplicativo empacotado ou URL configurada)
        // Se houver asset index.html empacotado: file:///android_asset/public/index.html
        // Fallback: carregar a URL da aplicação hospedada
        String initialUrl = "https://rotaly-qozcn8e0y.skip.app/courier";
        webView.loadUrl(initialUrl);
    }

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
                if ("waze".equalsIgnoreCase(appName)) {
                    String url = "https://waze.com/ul?ll=" + lat + "," + lng + "&navigate=yes";
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                    intent.setPackage("com.waze");
                    try {
                        startActivity(intent);
                        return true;
                    } catch (Exception fallback) {
                        // Se app Waze não estiver instalado, abre navegador
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                        return true;
                    }
                } else {
                    String uriStr = "google.navigation:q=" + lat + "," + lng;
                    Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(uriStr));
                    intent.setPackage("com.google.android.apps.maps");
                    try {
                        startActivity(intent);
                        return true;
                    } catch (Exception fallback) {
                        String mapsWeb = "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng;
                        startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(mapsWeb)));
                        return true;
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Erro ao abrir app de navegação:", e);
                return false;
            }
        }
    }
}
