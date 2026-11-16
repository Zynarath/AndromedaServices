package us.thefinalhour.andromeda;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * Andromeda Services on a phone: Andromeda Hosting (the game server panel), the WotLK website and
 * the Andromeda Services website, one tab each. Every tab is that site in its own page, so each
 * keeps where you were and stays signed in. Tap the tab you are on to go back to its first page;
 * hold a tab to reload it.
 */
public class MainActivity extends Activity {
    /** The tabs: { name on the tab, address }. Change the addresses here if the domain changes. */
    private static final String[][] SITES = {
        { "Hosting", "https://panel.thefinalhour.us/" },
        { "WoW", "https://wow.thefinalhour.us/" },
        { "Services", "https://thefinalhour.us/" },
    };
    /** Links to anywhere else (Discord, CurseForge, uMod...) open in the phone's browser. */
    private static final String HOME_DOMAIN = "thefinalhour.us";

    private static final int ACCENT = 0xFF1D9BF0;
    private static final int MUTED = 0xFF71767B;
    private static final int LINE = 0xFF2F3336;
    private static final int PICK_FILE = 1;
    private static final String STATE_TAB = "tab";

    private final WebView[] pages = new WebView[SITES.length];
    private final TextView[] tabs = new TextView[SITES.length];
    private FrameLayout holder;
    private ProgressBar progress;
    private int current = -1;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.BLACK);
        root.setFitsSystemWindows(true);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.INVISIBLE);
        root.addView(progress, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(3)));

        holder = new FrameLayout(this);
        root.addView(holder, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        View line = new View(this);
        line.setBackgroundColor(LINE);
        root.addView(line, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 1));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setBackgroundColor(Color.BLACK);
        for (int i = 0; i < SITES.length; i++) {
            final int index = i;
            TextView tab = new TextView(this);
            tab.setText(SITES[i][0]);
            tab.setGravity(Gravity.CENTER);
            tab.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            tab.setAllCaps(false);
            tab.setOnClickListener(v -> {
                if (index == current) pages[index].loadUrl(SITES[index][1]); // back to its first page
                else show(index);
            });
            tab.setOnLongClickListener(v -> {
                show(index);
                pages[index].reload();
                Toast.makeText(this, "Reloading " + SITES[index][0], Toast.LENGTH_SHORT).show();
                return true;
            });
            tabs[i] = tab;
            bar.addView(tab, new LinearLayout.LayoutParams(0, dp(54), 1f));
        }
        root.addView(bar, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));
        setContentView(root);

        CookieManager.getInstance().setAcceptCookie(true);
        int tab = saved == null ? 0 : saved.getInt(STATE_TAB, 0);
        show(tab >= 0 && tab < SITES.length ? tab : 0);
    }

    private int dp(int value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, getResources().getDisplayMetrics()));
    }

    /** Shows a tab's page. A page is only made (and its site loaded) the first time its tab is opened. */
    private void show(int index) {
        if (pages[index] == null) {
            pages[index] = newPage(index);
            holder.addView(pages[index], new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            pages[index].loadUrl(SITES[index][1]);
        }
        current = index;
        for (int i = 0; i < SITES.length; i++) {
            if (pages[i] != null) pages[i].setVisibility(i == index ? View.VISIBLE : View.GONE);
            tabs[i].setTextColor(i == index ? Color.WHITE : MUTED);
            tabs[i].setTypeface(Typeface.DEFAULT, i == index ? Typeface.BOLD : Typeface.NORMAL);
            tabs[i].setBackground(i == index ? underline() : null);
        }
        int p = pages[index].getProgress();
        progress.setProgress(p);
        progress.setVisibility(p < 100 ? View.VISIBLE : View.INVISIBLE);
    }

    /** The blue glow at the top of the tab that is open. */
    private GradientDrawable underline() {
        return new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { (ACCENT & 0x00FFFFFF) | 0x55000000, Color.TRANSPARENT });
    }

    private static boolean isOurs(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (host == null || scheme == null || !(scheme.equals("https") || scheme.equals("http"))) return false;
        host = host.toLowerCase();
        return host.equals(HOME_DOMAIN) || host.endsWith("." + HOME_DOMAIN);
    }

    private WebView newPage(final int index) {
        final WebView view = new WebView(this);
        view.setBackgroundColor(Color.BLACK);
        WebSettings s = view.getSettings();
        s.setJavaScriptEnabled(true); // the panel is a JavaScript app
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setBuiltInZoomControls(false);
        s.setSupportMultipleWindows(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // The sites sit behind Cloudflare, whose "checking your browser" step runs in a frame from its own domain.
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);

        view.setWebViewClient(new PageClient(this, index));
        view.setWebChromeClient(new PageChrome(this, index));

        // Downloads (backups, files) go to the phone's Downloads folder, signed in as you are in the app.
        view.setDownloadListener((url, userAgent, disposition, mimeType, length) -> {
            if (!URLUtil.isNetworkUrl(url)) {
                Toast.makeText(this, "This download can't be saved from the app. Open the site in your browser for it.", Toast.LENGTH_LONG).show();
                return;
            }
            try {
                String name = URLUtil.guessFileName(url, disposition, mimeType);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) request.addRequestHeader("Cookie", cookies);
                request.addRequestHeader("User-Agent", userAgent);
                request.setTitle(name);
                request.setMimeType(mimeType);
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
            } catch (RuntimeException e) {
                Toast.makeText(this, "Couldn't start the download", Toast.LENGTH_SHORT).show();
            }
        });
        return view;
    }

    /** Where links go, the loading bar, and what shows when a site can't be reached.
     *  (Static classes that are handed the activity, not inner or anonymous ones: a JDK 21 compiler
     *  marks an inner class's hidden "outer" constructor parameter in a way build-tools 34's d8 fails on.) */
    private static final class PageClient extends WebViewClient {
        private final MainActivity app;
        private final int index;

        PageClient(MainActivity app, int index) {
            this.app = app;
            this.index = index;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest request) {
            if (!request.isForMainFrame() || isOurs(request.getUrl())) return false;
            try {
                app.startActivity(new Intent(Intent.ACTION_VIEW, request.getUrl()));
            } catch (ActivityNotFoundException e) {
                Toast.makeText(app, "Nothing on this phone can open that link", Toast.LENGTH_SHORT).show();
            }
            return true;
        }

        @Override
        public void onPageStarted(WebView v, String url, Bitmap favicon) {
            if (index == app.current) app.progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView v, String url) {
            if (index == app.current) app.progress.setVisibility(View.INVISIBLE);
            CookieManager.getInstance().flush(); // stay signed in even if the app is closed right after
        }

        @Override
        public void onReceivedError(WebView v, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            // The site can't be reached (no signal, or the PC at home is off): say so, with a way to try again.
            String address = request.getUrl().toString();
            String page = "<!doctype html><meta name=viewport content='width=device-width,initial-scale=1'>"
                + "<body style='margin:0;background:#000;color:#e7e9ea;font:16px/1.5 sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center'>"
                + "<div style='padding:28px'><h2 style='margin:0 0 8px'>Can't reach " + SITES[index][0] + "</h2>"
                + "<p style='color:#71767b;margin:0 0 22px'>Check your connection. If that is fine, the PC that runs it may be off, or Andromeda Services isn't running on it.</p>"
                + "<a href='" + address.replace("'", "%27") + "' style='display:inline-block;padding:11px 24px;border-radius:99px;background:#e7e9ea;color:#0f1419;font-weight:700;text-decoration:none'>Try again</a></div>";
            v.loadDataWithBaseURL(SITES[index][1], page, "text/html", "utf-8", null);
        }
    }

    private static final class PageChrome extends WebChromeClient {
        private final MainActivity app;
        private final int index;

        PageChrome(MainActivity app, int index) {
            this.app = app;
            this.index = index;
        }

        @Override
        public void onProgressChanged(WebView v, int newProgress) {
            if (index != app.current) return;
            app.progress.setProgress(newProgress);
            app.progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.INVISIBLE);
        }

        // "Upload…" buttons on the sites (files, cover pictures) open the phone's file picker.
        @Override
        public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (app.fileCallback != null) app.fileCallback.onReceiveValue(null);
            app.fileCallback = callback;
            try {
                app.startActivityForResult(params.createIntent(), PICK_FILE);
            } catch (ActivityNotFoundException e) {
                app.fileCallback = null;
                Toast.makeText(app, "No app on this phone can pick a file", Toast.LENGTH_SHORT).show();
                return false;
            }
            return true;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_FILE || fileCallback == null) return;
        fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        fileCallback = null;
    }

    /** Back goes back inside the open tab first; from a tab's first page it leaves the app. */
    @Override
    public void onBackPressed() {
        WebView page = current >= 0 ? pages[current] : null;
        if (page != null && page.canGoBack()) page.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putInt(STATE_TAB, current);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        for (WebView page : pages) {
            if (page == null) continue;
            holder.removeView(page);
            page.destroy();
        }
        super.onDestroy();
    }
}
