package com.novelcraft;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

final class ApiBridge {
    private final Context context;
    private final WebView webView;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final SharedPreferences prefs;

    ApiBridge(Context context, WebView webView) {
        this.context = context.getApplicationContext();
        this.webView = webView;
        this.prefs = context.getSharedPreferences("novelcraft_data", Context.MODE_PRIVATE);
    }

    @JavascriptInterface
    public void callDeepSeek(String apiKey, String model, String messagesJson, String requestId) {
        executor.execute(() -> {
            try {
                HttpURLConnection conn = (HttpURLConnection) new URL("https://api.deepseek.com/chat/completions").openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(30000);
                conn.setReadTimeout(120000);
                conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setDoOutput(true);

                JSONObject body = new JSONObject();
                body.put("model", model);
                body.put("messages", new JSONArray(messagesJson));
                body.put("temperature", 0.8);
                body.put("max_tokens", 4096);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                InputStream stream = code >= 200 && code < 300 ? conn.getInputStream() : conn.getErrorStream();
                StringBuilder resp = new StringBuilder();
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                    String line;
                    while ((line = reader.readLine()) != null) resp.append(line);
                }

                if (code >= 200 && code < 300) {
                    JSONObject json = new JSONObject(resp.toString());
                    String content = json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content");
                    int usage = json.optJSONObject("usage") != null ? json.getJSONObject("usage").optInt("total_tokens", 0) : 0;
                    callback("onDeepSeekResult", requestId, content.replace("\n", "\\n").replace("\r", ""), String.valueOf(usage));
                } else {
                    callback("onDeepSeekError", requestId, "API error " + code + ": " + resp.toString());
                }
            } catch (Exception e) {
                callback("onDeepSeekError", requestId, e.getMessage());
            }
        });
    }

    @JavascriptInterface
    public void saveData(String key, String value) {
        prefs.edit().putString(key, value).apply();
    }

    @JavascriptInterface
    public String loadData(String key) {
        return prefs.getString(key, "");
    }

    @JavascriptInterface
    public void removeData(String key) {
        prefs.edit().remove(key).apply();
    }

    @JavascriptInterface
    public void checkBalance(String apiKey, String requestId) {
        executor.execute(() -> {
            try {
                // DeepSeek doesn't have a direct balance API, so we make a minimal call
                // and check the response headers for quota info
                HttpURLConnection conn = (HttpURLConnection) new URL("https://api.deepseek.com/chat/completions").openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(15000);
                conn.setReadTimeout(15000);
                conn.setRequestProperty("Authorization", "Bearer " + apiKey);
                conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                conn.setDoOutput(true);

                JSONObject body = new JSONObject();
                body.put("model", "deepseek-chat");
                body.put("messages", new JSONArray("[{"role":"user","content":"hi"}]"));
                body.put("max_tokens", 1);

                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }

                int code = conn.getResponseCode();
                if (code >= 200 && code < 300) {
                    // Read response to get usage info
                    StringBuilder resp = new StringBuilder();
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) resp.append(line);
                    }
                    JSONObject json = new JSONObject(resp.toString());
                    int usage = json.optJSONObject("usage") != null ? json.getJSONObject("usage").optInt("total_tokens", 0) : 0;
                    // We can't get exact balance, but we can confirm the key works
                    callback("onBalanceResult", requestId, "ok", "API 密钥有效，已使用 " + usage + " tokens（本次查询）");
                } else {
                    StringBuilder err = new StringBuilder();
                    try (BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getErrorStream(), StandardCharsets.UTF_8))) {
                        String line;
                        while ((line = reader.readLine()) != null) err.append(line);
                    }
                    callback("onBalanceResult", requestId, "error", "查询失败: HTTP " + code);
                }
            } catch (Exception e) {
                callback("onBalanceResult", requestId, "error", "查询失败: " + e.getMessage());
            }
        });
    }

    private void callback(String function, String... args) {
        StringBuilder js = new StringBuilder("window." + function + "(");
        for (int i = 0; i < args.length; i++) {
            if (i > 0) js.append(",");
            js.append("'").append(args[i].replace("'", "\\'").replace("\n", "\\n")).append("'");
        }
        js.append(")");
        String script = js.toString();
        webView.post(() -> webView.evaluateJavascript(script, null));
    }
}
