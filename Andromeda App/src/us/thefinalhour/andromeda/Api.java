package us.thefinalhour.andromeda;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.widget.ImageView;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Talks to Andromeda Hosting: the same JSON API the panel's own pages use, signed in with the same
 * session cookie. Requests run in the background; the answer comes back on the main thread.
 *
 * Cookies are kept in the phone's web cookie store and requests carry the phone's web user agent.
 * That way, when the panel sits behind Cloudflare and it wants to check the "browser" first, the
 * check done once on the Verify screen also covers every request made here.
 */
final class Api {
    static final String DEFAULT_ADDRESS = "https://panel.thefinalhour.us";
    private static final String PREFS = "andromeda";
    private static final String KEY_ADDRESS = "address";

    /** What to do with the panel's answer. (Two small interfaces so callers can use lambdas.) */
    interface Ok {
        void ok(JSONObject json);
    }

    interface Fail {
        void fail(Failure failure);
    }

    /** Why a request didn't work. */
    static final class Failure {
        final int status;        // HTTP status, 0 when the panel wasn't reached at all
        final String message;    // ready to show
        final boolean challenge; // Cloudflare wants to check the browser first

        Failure(int status, String message, boolean challenge) {
            this.status = status;
            this.message = message;
            this.challenge = challenge;
        }

        boolean signedOut() {
            return status == 401;
        }

        boolean offline() {
            return status == 0;
        }
    }

    private final Context context;
    private final SharedPreferences prefs;
    private final String userAgent;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Pictures images = new Pictures();

    /** Pictures already fetched, up to 12 MB. */
    private static final class Pictures extends LruCache<String, Bitmap> {
        Pictures() {
            super(12 * 1024 * 1024);
        }

        @Override
        protected int sizeOf(String key, Bitmap value) {
            return value.getByteCount();
        }
    }

    Api(Context context) {
        this.context = context.getApplicationContext();
        this.prefs = this.context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String agent;
        try {
            agent = WebSettings.getDefaultUserAgent(this.context);
        } catch (RuntimeException e) { // no WebView on this phone: any honest agent will do
            agent = "Mozilla/5.0 (Linux; Android) AndromedaApp";
        }
        this.userAgent = agent;
        CookieManager.getInstance().setAcceptCookie(true);
    }

    String userAgent() {
        return userAgent;
    }

    /** The panel's address without a slash at the end: "https://panel.example.com". */
    String address() {
        return prefs.getString(KEY_ADDRESS, DEFAULT_ADDRESS);
    }

    /** Tidies what was typed ("panel.example.com/") and remembers it. Returns null when it isn't an address. */
    String setAddress(String typed) {
        String a = typed == null ? "" : typed.trim();
        if (a.isEmpty()) a = DEFAULT_ADDRESS;
        if (!a.matches("(?i)^https?://.*")) a = "https://" + a;
        while (a.endsWith("/")) a = a.substring(0, a.length() - 1);
        if (!a.matches("(?i)^https?://[a-z0-9.\\-\\[\\]:]+(:\\d+)?$")) return null;
        prefs.edit().putString(KEY_ADDRESS, a).apply();
        return a;
    }

    void get(String path, Ok ok, Fail fail) {
        call("GET", path, null, ok, fail);
    }

    void post(String path, JSONObject body, Ok ok, Fail fail) {
        call("POST", path, body == null ? new JSONObject() : body, ok, fail);
    }

    void put(String path, JSONObject body, Ok ok, Fail fail) {
        call("PUT", path, body, ok, fail);
    }

    void patch(String path, JSONObject body, Ok ok, Fail fail) {
        call("PATCH", path, body, ok, fail);
    }

    void delete(String path, Ok ok, Fail fail) {
        call("DELETE", path, null, ok, fail);
    }

    void call(final String method, final String path, final JSONObject body, final Ok ok, final Fail fail) {
        pool.execute(() -> {
            JSONObject json = null;
            Failure failure = null;
            try {
                Response r = request(method, path, body == null ? null : body.toString().getBytes(StandardCharsets.UTF_8));
                String text = new String(r.body, StandardCharsets.UTF_8);
                boolean challenge = "challenge".equalsIgnoreCase(r.header("cf-mitigated"))
                    || ((r.status == 403 || r.status == 503) && (text.contains("Just a moment") || text.contains("challenge-platform")));
                JSONObject parsed = null;
                try {
                    parsed = new JSONObject(text);
                } catch (Exception notJson) {
                    // an error page from something in between (Cloudflare, a proxy)
                }
                if (challenge) failure = new Failure(r.status, "Cloudflare wants to check this phone before it lets the app through.", true);
                else if (r.status >= 200 && r.status < 300 && parsed != null) json = parsed;
                else if (parsed != null && parsed.has("error")) failure = new Failure(r.status, parsed.optString("error"), false);
                else if (r.status == 401) failure = new Failure(401, "Please sign in", false);
                else if (r.status == 502 || r.status == 503 || r.status == 504 || r.status == 530) failure = new Failure(0, "The panel isn't answering. The PC may be off, or Andromeda Hosting isn't running.", false);
                else failure = new Failure(r.status, "The panel gave an answer the app doesn't understand (" + r.status + ").", false);
            } catch (IOException e) {
                failure = new Failure(0, "Can't reach the panel. Check your connection and the address.", false);
            } catch (RuntimeException e) {
                failure = new Failure(0, "Couldn't ask the panel: " + e.getMessage(), false);
            }
            final JSONObject okJson = json;
            final Failure why = failure;
            main.post(() -> {
                if (okJson != null) ok.ok(okJson);
                else if (fail != null) fail.fail(why);
            });
        });
    }

    private static final class Response {
        int status;
        byte[] body;
        Map<String, List<String>> headers;

        String header(String name) {
            for (Map.Entry<String, List<String>> e : headers.entrySet()) {
                if (name.equalsIgnoreCase(e.getKey()) && !e.getValue().isEmpty()) return e.getValue().get(0);
            }
            return null;
        }
    }

    private Response request(String method, String path, byte[] body) throws IOException {
        String url = path.startsWith("http") ? path : address() + path;
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(10000);
            c.setReadTimeout(25000);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty("User-Agent", userAgent);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("X-Requested-With", "AndromedaHosting"); // the panel's guard against forged requests
            String cookies = CookieManager.getInstance().getCookie(url);
            if (cookies != null) c.setRequestProperty("Cookie", cookies);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                c.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body);
                }
            }
            Response r = new Response();
            r.status = c.getResponseCode();
            r.headers = c.getHeaderFields();
            for (Map.Entry<String, List<String>> e : r.headers.entrySet()) {
                if (!"Set-Cookie".equalsIgnoreCase(e.getKey())) continue;
                for (String cookie : e.getValue()) CookieManager.getInstance().setCookie(url, cookie);
            }
            InputStream in = r.status >= 400 ? c.getErrorStream() : c.getInputStream();
            r.body = in == null ? new byte[0] : readAll(in, 8 * 1024 * 1024);
            return r;
        } finally {
            c.disconnect();
        }
    }

    private static byte[] readAll(InputStream in, int limit) throws IOException {
        try (InputStream stream = in) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = stream.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > limit) throw new IOException("Answer is too large");
            }
            return out.toByteArray();
        }
    }

    void saveCookies() {
        CookieManager.getInstance().flush();
    }

    /** Signs out on this phone even when the panel can't be told. */
    void forgetSession() {
        CookieManager.getInstance().setCookie(address(), "hp_session=; Max-Age=0; Path=/"); // the panel's session cookie
        saveCookies();
    }

    /** Shows a picture the panel serves (a game's cover) in the view, once it has arrived. */
    void image(final String path, final ImageView into) {
        into.setTag(path);
        Bitmap have = images.get(path);
        if (have != null) {
            into.setImageBitmap(have);
            return;
        }
        pool.execute(() -> {
            Bitmap bitmap = null;
            try {
                Response r = request("GET", path, null);
                if (r.status == 200) {
                    BitmapFactory.Options size = new BitmapFactory.Options();
                    size.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(r.body, 0, r.body.length, size);
                    BitmapFactory.Options o = new BitmapFactory.Options();
                    o.inSampleSize = Math.max(1, Math.min(size.outWidth / 700, size.outHeight / 350)); // covers are only shown small
                    bitmap = BitmapFactory.decodeByteArray(r.body, 0, r.body.length, o);
                }
            } catch (IOException | RuntimeException e) {
                // no picture: the game's colours stay
            }
            final Bitmap result = bitmap;
            if (result == null) return;
            images.put(path, result);
            main.post(() -> {
                if (path.equals(into.getTag())) into.setImageBitmap(result);
            });
        });
    }
}
