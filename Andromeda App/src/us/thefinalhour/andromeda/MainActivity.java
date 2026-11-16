package us.thefinalhour.andromeda;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.InputMethodManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * Andromeda Services on a phone, as an app of its own (no web pages): the dashboard and server
 * pages of Andromeda Hosting, and the service cards of the Andromeda Services window.
 *
 * One activity. Three tabs along the bottom (Servers, Services, Account); a server opens over
 * them. While the app is on screen, whatever is showing asks the panel for fresh numbers every
 * few seconds, like the panel's own pages do.
 */
public class MainActivity extends Activity {
    private static final int TICK_MS = 3000;
    private static final String[] TAB_NAMES = { "Servers", "Services", "Account" };

    Api api;
    JSONObject user;          // who is signed in: { username, role }
    String panelName = "Andromeda Hosting";
    String panelVersion = "";

    private FrameLayout content;
    private LinearLayout nav;
    private View navLine;
    private final TextView[] navItems = new TextView[TAB_NAMES.length];
    private final Screen[] tabs = new Screen[TAB_NAMES.length];
    private int tab = 0;
    private Screen over;      // a server page, the sign-in screen or the Cloudflare check, over the tabs
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable ticker = this::tick;
    private boolean resumed;
    private long verifiedAt;
    JSONObject pendingLogin;  // what was typed on the sign-in screen when a page had to be shown first

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        api = new Api(this);
        LinearLayout root = Ui.column(this);
        root.setBackgroundColor(Ui.BG);
        root.setFitsSystemWindows(true);
        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
        navLine = Ui.line(this);
        root.addView(navLine);
        nav = Ui.row(this);
        for (int i = 0; i < TAB_NAMES.length; i++) {
            final int index = i;
            TextView item = Ui.text(this, TAB_NAMES[i], 13.5f, Ui.MUTED, false);
            item.setGravity(Gravity.CENTER);
            item.setOnClickListener(v -> showTab(index));
            navItems[i] = item;
            nav.addView(item, new LinearLayout.LayoutParams(0, Ui.dp(this, 54), 1f));
        }
        root.addView(nav, Ui.lp(Ui.MATCH, Ui.WRAP));
        setContentView(root);
        showNav(false);
        if (saved != null) tab = Math.max(0, Math.min(TAB_NAMES.length - 1, saved.getInt("tab", 0)));
        connect();
    }

    // ---------- signing in ----------

    /** Asks the panel who we are; from there it is the tabs, the sign-in screen or the Cloudflare check. */
    void connect() {
        setOver(new MessageScreen(this, "Connecting…"));
        api.get("/api/auth/state", json -> {
            panelName = json.optString("panelName", panelName);
            panelVersion = json.optString("version", "");
            JSONObject u = json.optJSONObject("user");
            if (u != null) signedIn(u);
            else if (pendingLogin != null) finishLogin();
            else setOver(new LoginScreen(this, json.optBoolean("setupRequired") ? "This panel has no account yet. Create the first admin on the PC it runs on, then sign in here." : null));
        }, f -> {
            if (f.challenge && !justVerified()) setOver(new VerifyScreen(this, f));
            else setOver(new LoginScreen(this, f.challenge ? stillStopped(f) : f.message));
        });
    }

    /** The sign-in that was typed when a page got in the way goes through now, without typing it again. */
    private void finishLogin() {
        JSONObject body = pendingLogin;
        pendingLogin = null;
        api.post("/api/auth/login", body, json -> {
            if (json.optBoolean("totpRequired")) setOver(new LoginScreen(this, "Sign in once more, with the 6-digit code from your authenticator app."));
            else connect();
        }, f -> setOver(new LoginScreen(this, f.challenge ? stillStopped(f) : f.message)));
    }

    /** The page in front of the panel was just dealt with: don't send the user straight back to it. */
    boolean justVerified() {
        return System.currentTimeMillis() - verifiedAt < 30000;
    }

    void verified() {
        verifiedAt = System.currentTimeMillis();
        connect();
    }

    /** What to say when the page was passed and the app is stopped all the same. */
    String stillStopped(Api.Failure f) {
        return "The page in front of the panel was passed, but the app's own requests are still stopped" + (f.where.isEmpty() ? "" : " (sent to " + f.where + ")") + ". In Cloudflare, let /api/* on the panel's address through without that page, then try again.";
    }

    void signedIn(JSONObject u) {
        user = u;
        api.saveCookies();
        for (int i = 0; i < tabs.length; i++) {
            if (tabs[i] != null) content.removeView(tabs[i].view);
            tabs[i] = null;
        }
        setOver(null);
        if (tab == 1 && !isAdmin()) tab = 0;
        navItems[1].setVisibility(isAdmin() ? View.VISIBLE : View.GONE); // the services are the admin's business
        showTab(tab);
    }

    boolean isAdmin() {
        return user != null && "admin".equals(user.optString("role"));
    }

    void signOut() {
        api.post("/api/auth/logout", null, json -> signedOut(null), f -> signedOut(null));
    }

    void signedOut(String why) {
        user = null;
        api.forgetSession();
        setOver(new LoginScreen(this, why));
    }

    /** What every screen does with a request that didn't work. */
    void failed(Api.Failure f) {
        if (f.signedOut()) {
            if (user != null) signedOut("You were signed out. Sign in again.");
        } else if (f.challenge) {
            if (over instanceof VerifyScreen) return;
            if (justVerified()) Ui.toast(this, stillStopped(f));
            else setOver(new VerifyScreen(this, f));
        } else Ui.toast(this, f.message);
    }

    // ---------- what is on screen ----------

    private void showNav(boolean show) {
        nav.setVisibility(show ? View.VISIBLE : View.GONE);
        navLine.setVisibility(show ? View.VISIBLE : View.GONE);
    }

    void showTab(int index) {
        tab = index;
        if (tabs[index] == null) {
            tabs[index] = index == 0 ? new DashboardScreen(this) : index == 1 ? new ServicesScreen(this) : new AccountScreen(this);
            content.addView(tabs[index].view, 0, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        }
        for (int i = 0; i < tabs.length; i++) {
            if (tabs[i] != null) tabs[i].view.setVisibility(i == index && over == null ? View.VISIBLE : View.GONE);
            boolean on = i == index;
            navItems[i].setTextColor(on ? Color.WHITE : Ui.MUTED);
            navItems[i].setTypeface(Typeface.DEFAULT, on ? Typeface.BOLD : Typeface.NORMAL);
            navItems[i].setBackground(on ? new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { Ui.alpha(Ui.ACCENT, 0x55), Color.TRANSPARENT }) : null);
        }
        if (over == null) {
            showNav(true);
            tabs[index].shown();
        }
    }

    /** Puts a screen over the tabs (null: back to the tabs). */
    void setOver(Screen screen) {
        hideKeyboard();
        if (over != null) {
            over.closed();
            content.removeView(over.view);
        }
        over = screen;
        if (screen != null) {
            content.addView(screen.view, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
            for (Screen t : tabs) if (t != null) t.view.setVisibility(View.GONE);
            showNav(false);
            screen.shown();
        } else if (user != null && tabs[tab] != null) showTab(tab);
    }

    void openServer(String id, String name) {
        setOver(new ServerScreen(this, id, name));
    }

    void hideKeyboard() {
        View focus = getCurrentFocus();
        InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
        if (focus != null && imm != null) imm.hideSoftInputFromWindow(focus.getWindowToken(), 0);
    }

    private Screen showing() {
        return over != null ? over : user != null ? tabs[tab] : null;
    }

    private void tick() {
        handler.removeCallbacks(ticker);
        if (!resumed) return;
        Screen s = showing();
        if (s != null) s.tick();
        handler.postDelayed(ticker, TICK_MS);
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        Screen s = showing();
        if (s != null) s.shown();
        handler.removeCallbacks(ticker);
        handler.postDelayed(ticker, TICK_MS);
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        handler.removeCallbacks(ticker);
        api.saveCookies();
    }

    @Override
    public void onBackPressed() {
        if (over != null && over.back()) return;
        if (over instanceof ServerScreen) setOver(null);
        else if (over == null && tab != 0) showTab(0);
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        out.putInt("tab", tab);
    }
}
