package com.games.wenzi.yunyin;

import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private View loadingOverlay;
    private View enterButton;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean loadingDismissed = false;
    private Runnable enterButtonRunnable;

    /**
     * 系统栏占位,单位:CSS 像素,经 NativeApp 桥交给页面。
     * 边到边(targetSdk 36 也会强制)下 Android WebView 的 env(safe-area-inset-bottom) 恒为 0,须由原生量。
     * 底部取 tappableElement 而非 navigationBars:手势导航前者为 0,只在三键导航时垫。
     */
    private volatile float insetTopCss = 0f;
    private volatile float insetBottomCss = 0f;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 须在 super.onCreate 前注册:Bridge 在 super 里创建,晚注册的插件不进 JS 的 PluginHeaders
        registerPlugin(SaveTransferPlugin.class);
        super.onCreate(savedInstanceState);

        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = new WindowInsetsControllerCompat(getWindow(), getWindow().getDecorView());
        controller.setAppearanceLightStatusBars(false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);

        // BridgeActivity 已创建自己的 WebView 布局,遮罩层叠加在上面
        loadingOverlay = getLayoutInflater().inflate(R.layout.activity_main, null);
        addContentView(loadingOverlay, new ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        ));

        enterButton = loadingOverlay.findViewById(R.id.enterButton);

        enterButton.setOnClickListener(v -> dismissLoading());

        enterButtonRunnable = () -> {
            if (!loadingDismissed && enterButton != null) {
                enterButton.setVisibility(View.VISIBLE);
                enterButton.setAlpha(0f);
                enterButton.animate().alpha(1f).setDuration(300).start();
            }
        };
        handler.postDelayed(enterButtonRunnable, 5000);

        WebView webView = getBridge().getWebView();
        if (webView != null) {
            final float density = getResources().getDisplayMetrics().density;
            ViewCompat.setOnApplyWindowInsetsListener(webView, (v, insets) -> {
                Insets status = insets.getInsets(WindowInsetsCompat.Type.statusBars());
                Insets tappable = insets.getInsets(WindowInsetsCompat.Type.tappableElement());
                float top = status.top / density;
                float bottom = tappable.bottom / density;
                if (top != insetTopCss || bottom != insetBottomCss) {
                    insetTopCss = top;
                    insetBottomCss = bottom;
                    // 首次派发在 attach 时,页面可能未加载;事件丢了无妨,组件挂载时会主动读一次
                    v.post(() -> ((WebView) v).evaluateJavascript(
                        "window.dispatchEvent(new Event('nativeinsets'))", null));
                }
                return insets;
            });
            ViewCompat.requestApplyInsets(webView);

            // 方法在 JavaBridge 线程上被调,只读 volatile 字段
            webView.addJavascriptInterface(new Object() {
                @android.webkit.JavascriptInterface
                public void hideLoading() {
                    runOnUiThread(() -> dismissLoading());
                }

                @android.webkit.JavascriptInterface
                public float insetTop() {
                    return insetTopCss;
                }

                @android.webkit.JavascriptInterface
                public float insetBottom() {
                    return insetBottomCss;
                }
            }, "NativeApp");

            // 原生轮询 Vue 是否渲染完再撤遮罩;不可改成注入自转的 JS:自愈 reload 后注入的脚本随之消失
            handler.postDelayed(() -> pollForApp(System.currentTimeMillis()), 500);
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        handler.removeCallbacksAndMessages(null);
    }

    /** 自愈只做一次,防止 reload 循环 */
    private boolean healAttempted = false;

    /** #app 有子节点即算渲染完成 */
    private static final String JS_APP_READY =
        "(function(){var a=document.getElementById('app');return !!(a&&a.children.length>0)})()";

    /**
     * 自愈:注销全部 Service Worker、清掉其缓存后重载。
     * 1.34.0 注册的 SW 接管导航后 fetch() https://localhost 失败、缓存无副本,#app 永不出现;
     * 它先于新页面执行,只能由原生注入拆除。只动 SW 与 CacheStorage,localStorage(存档)不碰。
     */
    private static final String JS_HEAL =
        "(function(){var sw=navigator.serviceWorker;if(!sw||!sw.getRegistrations)return;" +
        "sw.getRegistrations().then(function(rs){if(!rs.length)return;" +
        "console.warn('yunyin: #app 迟迟未出现且存在 Service Worker,注销 '+rs.length+' 个并重载');" +
        "return Promise.all(rs.map(function(r){return r.unregister()}))" +
        ".then(function(){return caches.keys()})" +
        ".then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))})" +
        ".then(function(){location.reload()})})})()";

    private void pollForApp(long startedAt) {
        if (loadingDismissed) return;
        WebView wv = getBridge().getWebView();
        if (wv == null) return;
        wv.evaluateJavascript(JS_APP_READY, value -> {
            if ("true".equals(value)) {
                dismissLoading();
                return;
            }
            if (!healAttempted && System.currentTimeMillis() - startedAt > 6000) {
                healAttempted = true;
                wv.evaluateJavascript(JS_HEAL, null);
            }
            handler.postDelayed(() -> pollForApp(startedAt), 200);
        });
    }

    private void dismissLoading() {
        if (loadingDismissed || loadingOverlay == null) return;
        loadingDismissed = true;
        if (enterButtonRunnable != null) {
            handler.removeCallbacks(enterButtonRunnable);
        }
        loadingOverlay.animate()
            .alpha(0f)
            .setDuration(300)
            .withEndAction(() -> loadingOverlay.setVisibility(View.GONE))
            .start();
    }
}
