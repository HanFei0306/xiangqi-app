package com.xiangqi.trainer;

import android.app.Activity;
import android.content.res.AssetFileDescriptor;
import android.content.res.AssetManager;
import android.media.MediaPlayer;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Minimal native host for the Xiangqi Trainer web application.
 * Loads the bundled assets/public/index.html into a full-screen WebView.
 */
public class MainActivity extends Activity {

    private WebView webView;

    /*
     * v2026.11.23.1 — P0 FIX: load the REAL engine library, not the skeleton.
     * The JNI symbols nativePikafishInit/Query live in libpikafish_nc.so.
     * The 4.9KB skeleton only exports nativeEngineStatus/nativeQueryEngine,
     * so loading it made initPikafishIfPresent() fail and left the bundled
     * 50MB NNUE weights permanently unused (self engine was always selected).
     * Try the real library first; fall back to skeleton only on ABI mismatch.
     */
    static {
        boolean realLoaded = false;
        try {
            System.loadLibrary("pikafish_nc");
            realLoaded = true;
        } catch (UnsatisfiedLinkError ignored) {
            // e.g. armeabi-v7a build without the nc library — keep playable.
        }
        if (!realLoaded) {
            try {
                System.loadLibrary("pikafish_skeleton");
            } catch (UnsatisfiedLinkError ignored) {
                // Keep the app playable if no ABI-specific library is present.
            }
        }
    }

    /** volatile: written during init, read by the background search thread. */
    private volatile boolean pikafishAvailable = false;
    /** Single background thread for native search so deep thinking never freezes the UI thread. */
    private final ExecutorService engineExecutor = Executors.newSingleThreadExecutor();

    public native String nativeEngineStatus();

    public native String nativeQueryEngine(String uciPosition);

    public native String nativePikafishInit(String netPath, int hashMb, int threads);

    public native String nativePikafishQuery(String request);

    /** Minimal JS surface: status + UCI-string echo; never called by the UI yet. */
    public class NativeEngineBridge {
        @JavascriptInterface
        public String status() {
            if (pikafishAvailable) return "PIKAFISH_NC_READY";
            try {
                return nativeEngineStatus();
            } catch (Throwable t) {
                return "JNI_UNAVAILABLE";
            }
        }

        /**
         * Native cue playback: bypasses Web Audio entirely. Uses the exact same
         * base64 voice clips as the normal game, extracted to m4a assets.
         */
        @JavascriptInterface
        public void playCue(String cue) {
            playAsset(cueAsset(cue));
        }

        private String cueAsset(String cue) {
            if ("capture".equals(cue)) return "voice/capture.m4a";
            if ("check".equals(cue)) return "voice/check.m4a";
            if ("mate".equals(cue) || "checkmate".equals(cue)) return "voice/mate.m4a";
            if ("land".equals(cue) || "move".equals(cue)) return "voice/land.wav";
            return null;
        }

        private boolean playAsset(final String name) {
            if (name == null) return false;
            MediaPlayer player = new MediaPlayer();
            try {
                AssetFileDescriptor afd = getAssets().openFd(name);
                player.setDataSource(afd.getFileDescriptor(), afd.getStartOffset(), afd.getLength());
                afd.close();
                player.prepare();
                player.start();
                player.setOnCompletionListener(new MediaPlayer.OnCompletionListener() {
                    @Override
                    public void onCompletion(MediaPlayer mp) { mp.release(); }
                });
                return true;
            } catch (Throwable t) {
                player.release();
                return false;
            }
        }

        /**
         * v21.10 统一走子音效：一步棋的落子声 + 吃/将/绝杀语音打包播放。
         * 全部走原生 MediaPlayer，延迟用 Handler 预约——彻底绕开 WebView 的
         * Web Audio 手势限制，确保所有模式（对局/适情雅趣/推演/记谱/复盘）一致。
         */
        @JavascriptInterface
        public boolean playUnified(final String cue, long delayMs) {
            final long d = Math.max(0, Math.min(delayMs, 5000));
            // 资源健康度预检：land.wav 必须能打开，否则回报 false 让 Web 端回退。
            boolean ok;
            try {
                AssetFileDescriptor probe = getAssets().openFd("voice/land.wav");
                probe.close();
                ok = true;
            } catch (Throwable t) { ok = false; }
            Runnable task = new Runnable() {
                @Override
                public void run() {
                    playAsset("voice/land.wav"); // 每步一次清脆麻将落牌声
                    String voice = null;
                    if ("capture".equals(cue)) voice = "voice/capture.m4a";
                    else if ("check".equals(cue)) voice = "voice/check.m4a";
                    else if ("mate".equals(cue)) voice = "voice/mate.m4a";
                    final String voiceAsset = voice;
                    if (voiceAsset != null) {
                        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
                            @Override public void run() { playAsset(voiceAsset); }
                        }, 90);
                    }
                }
            };
            if (d > 0) new Handler(Looper.getMainLooper()).postDelayed(task, d);
            else task.run();
            return ok;
        }

        /** Only present in pikafish-nc builds; returns "bestmove (none)" otherwise. */
        @JavascriptInterface
        public String pikafish(String request) {
            if (!pikafishAvailable) return "bestmove (none)";
            try {
                return nativePikafishQuery(request);
            } catch (Throwable t) {
                return "bestmove (none)";
            }
        }

        /**
         * v2026.11.23.1 — TRUE ASYNC native search. The synchronous pikafish()
         * above blocks whoever calls it; at master depth that is ~14s and would
         * freeze the WebView UI thread (the old PikafishEngine.getBestMoveAsync
         * was fake-async: it just called the sync method). Run the JNI search on
         * a background thread and post the result back to JS via a callback,
         * so the UI keeps rendering (thinking indicator, board, buttons) while
         * the engine thinks. JS registers window.__pikafishResolve(callbackId, raw).
         */
        @JavascriptInterface
        public void pikafishAsync(final String request, final String callbackId) {
            if (!pikafishAvailable) {
                postResult(callbackId, "bestmove (none)");
                return;
            }
            engineExecutor.execute(new Runnable() {
                @Override
                public void run() {
                    String result;
                    try {
                        result = nativePikafishQuery(request);
                    } catch (Throwable t) {
                        result = "bestmove (none)";
                    }
                    postResult(callbackId, result);
                }
            });
        }

        /** Hop back onto the UI thread before touching the WebView. */
        private void postResult(final String callbackId, final String result) {
            new Handler(Looper.getMainLooper()).post(new Runnable() {
                @Override
                public void run() {
                    try {
                        String id = MainActivity.jsString(callbackId);
                        String raw = MainActivity.jsString(result);
                        webView.evaluateJavascript(
                            "if(window.__pikafishResolve){window.__pikafishResolve(" + id + "," + raw + ");}",
                            null);
                    } catch (Throwable ignored) {
                        // WebView torn down (activity finishing) — drop the result.
                    }
                }
            });
        }

        @JavascriptInterface
        public String query(String uciPosition) {
            try {
                return nativeQueryEngine(uciPosition == null ? "" : uciPosition);
            } catch (Throwable t) {
                return "JNI_UNAVAILABLE";
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);

        // CRITICAL (v2026.11.19.2): render CSS pixels at a true 1:1 scale.
        // The old combination setLoadWithOverviewMode(true) + initialScale unset
        // made several Android vendors silently zoom the whole page to <100%,
        // resampling the board and blurring every piece edge and 1px line.
        // The HTML already declares <meta viewport width=device-width,
        // initial-scale=1>, so we let that meta drive a 100% layout and disable
        // every automatic/overview/user zoom path that could rescale it.
        settings.setLoadWithOverviewMode(false);
        settings.setUseWideViewPort(true);
        webView.setInitialScale(100);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        // Stop the system "font boosting" pass that enlarges small text and
        // smears glyph edges on some ROMs.
        settings.setTextZoom(100);
        settings.setMinimumFontSize(8);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setMediaPlaybackRequiresUserGesture(false);

        initPikafishIfPresent();
        webView.setWebViewClient(new WebViewClient());
        // v2026.11.23.1: the bridge now powers live move selection via the real
        // Pikafish NNUE engine (async) plus the native unified cue playback.
        webView.addJavascriptInterface(new NativeEngineBridge(), "XiangqiNative");
        webView.loadUrl("file:///android_asset/public/index.html");
    }

    /**
     * Non-commercial test builds bundle assets/public/engine/pikafish.nnue.
     * Copy it into private storage so the native engine can open a real path.
     * Self builds have no such asset and keep the proven TS engine.
     */
    private void initPikafishIfPresent() {
        AssetManager am = getAssets();
        File target = new File(getFilesDir(), "pikafish.nnue");
        try {
            InputStream in = null;
            try {
                in = am.open("public/engine/pikafish.nnue");
            } catch (Exception missing) {
                return; // self build: no NNUE, no native engine
            }
            OutputStream out = new FileOutputStream(target);
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            out.close();
            in.close();
            // v21.6: Hash 128->256MB（更多置换表命中，纯内存不增 CPU 负载）；线程保持 2
            // 以免手机持续多核满载降频反而变慢。
            String result = nativePikafishInit(target.getAbsolutePath(), 256, 2);
            pikafishAvailable = "ok".equals(result) || "already-initialized".equals(result);
        } catch (Throwable t) {
            pikafishAvailable = false;
        }
    }

    /** Minimal JS string literal escaping for async callback ids and bestmove output. */
    private static String jsString(String s) {
        String v = s == null ? "" : s;
        return "'" + v.replace("\\", "\\\\").replace("'", "\\'")
                      .replace("\n", "\\n").replace("\r", "\\r") + "'";
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}
