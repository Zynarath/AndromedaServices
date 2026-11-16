package us.thefinalhour.andromeda;

import android.app.AlertDialog;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** One full view of the app: a tab, a server's page, the sign-in screen. */
abstract class Screen {
    final MainActivity app;
    View view;

    Screen(MainActivity app) {
        this.app = app;
    }

    /** It just came on screen: ask the panel for what it shows. */
    void shown() {}

    /** Every few seconds while it is on screen. */
    void tick() {}

    /** It was taken off screen for good. */
    void closed() {}

    /** The phone's Back button. True when the screen dealt with it itself. */
    boolean back() {
        return false;
    }

    /** A page that scrolls, with the app's margins. Put the content in the returned column. */
    LinearLayout scrollingPage() {
        ScrollView scroll = new ScrollView(app);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Ui.BG);
        LinearLayout column = Ui.column(app);
        int p = Ui.dp(app, 16);
        column.setPadding(p, p, p, Ui.dp(app, 28));
        scroll.addView(column, new ScrollView.LayoutParams(Ui.MATCH, Ui.WRAP));
        view = scroll;
        return column;
    }

    static JSONObject json(Object... pairs) {
        JSONObject o = new JSONObject();
        try {
            for (int i = 0; i + 1 < pairs.length; i += 2) o.put(String.valueOf(pairs[i]), pairs[i + 1]);
        } catch (JSONException e) {
            throw new IllegalArgumentException(e);
        }
        return o;
    }

    void confirm(String title, String message, String action, Runnable then) {
        new AlertDialog.Builder(app, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle(title)
            .setMessage(message)
            .setNegativeButton("Cancel", null)
            .setPositiveButton(action, (d, w) -> then.run())
            .show();
    }
}

/** A line of text in the middle of the screen ("Connecting…"). */
final class MessageScreen extends Screen {
    MessageScreen(MainActivity app, String message) {
        super(app);
        LinearLayout box = Ui.column(app);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Ui.BG);
        ImageView logo = new ImageView(app);
        logo.setImageResource(R.drawable.ic_launcher_foreground);
        box.addView(logo, Ui.lp(Ui.dp(app, 110), Ui.dp(app, 110)));
        TextView t = Ui.muted(app, message);
        t.setGravity(Gravity.CENTER);
        box.addView(t);
        view = box;
    }
}

/** Sign in to the panel: its address, your username and password, and the 2FA code if you use one. */
final class LoginScreen extends Screen {
    private final EditText address, username, password, code;
    private final TextView error, button, codeLabel;
    private boolean busy;

    LoginScreen(MainActivity app, String message) {
        super(app);
        LinearLayout page = scrollingPage();
        page.setGravity(Gravity.CENTER_HORIZONTAL);
        page.addView(Ui.gap(app, 24));
        ImageView logo = new ImageView(app);
        logo.setImageResource(R.drawable.ic_launcher_foreground);
        page.addView(logo, Ui.lp(Ui.dp(app, 120), Ui.dp(app, 120)));
        TextView name = Ui.title(app, "Andromeda Hosting");
        name.setGravity(Gravity.CENTER);
        page.addView(name);
        TextView company = Ui.text(app, "ANDROMEDA SERVICES", 10.5f, Ui.MUTED, true);
        company.setLetterSpacing(0.18f);
        company.setGravity(Gravity.CENTER);
        page.addView(company);
        page.addView(Ui.gap(app, 22));

        LinearLayout card = Ui.card(app);
        error = Ui.text(app, "", 13.5f, Ui.BAD, false);
        error.setBackground(Ui.box(app, Ui.alpha(Ui.BAD, 0x22), 0, 10));
        error.setPadding(Ui.dp(app, 12), Ui.dp(app, 9), Ui.dp(app, 12), Ui.dp(app, 9));
        card.addView(error, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 12));
        address = field(card, "Panel address", "panel.example.com", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setText(app.api.address());
        username = field(card, "Username", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        password = field(card, "Password", "", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_PASSWORD);
        codeLabel = Ui.text(app, "Code from your authenticator app", 13, Ui.TEXT_2, true);
        card.addView(codeLabel, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 6));
        code = Ui.input(app, "6 digits", InputType.TYPE_CLASS_NUMBER);
        card.addView(code, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 14));
        codeLabel.setVisibility(View.GONE);
        code.setVisibility(View.GONE);
        button = Ui.button(app, "Sign in", Ui.Kind.PRIMARY);
        button.setOnClickListener(v -> submit());
        card.addView(button, Ui.lp(Ui.MATCH, Ui.dp(app, 44)));
        password.setImeOptions(EditorInfo.IME_ACTION_GO);
        password.setOnEditorActionListener((v, action, event) -> {
            submit();
            return true;
        });
        page.addView(card, Ui.lp(Ui.MATCH, Ui.WRAP));
        TextView note = Ui.muted(app, "The same account you use on the panel's website.");
        note.setGravity(Gravity.CENTER);
        page.addView(note, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 0));
        say(message);
    }

    private EditText field(LinearLayout into, String label, String hint, int type) {
        into.addView(Ui.text(app, label, 13, Ui.TEXT_2, true), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 6));
        EditText e = Ui.input(app, hint, type);
        into.addView(e, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 14));
        return e;
    }

    private void say(String message) {
        error.setText(message == null ? "" : message);
        error.setVisibility(message == null || message.isEmpty() ? View.GONE : View.VISIBLE);
    }

    private void submit() {
        if (busy) return;
        if (app.api.setAddress(address.getText().toString()) == null) {
            say("That doesn't look like an address. It should be like panel.example.com");
            return;
        }
        address.setText(app.api.address());
        String name = username.getText().toString().trim();
        if (name.isEmpty() || password.getText().length() == 0) {
            say("Enter your username and password.");
            return;
        }
        busy = true;
        button.setText("Signing in…");
        Ui.enable(button, false);
        say(null);
        JSONObject body = json("username", name, "password", password.getText().toString());
        if (code.getVisibility() == View.VISIBLE && code.getText().length() > 0) {
            try {
                body.put("code", code.getText().toString().trim());
            } catch (JSONException ignored) {
                // a string always fits
            }
        }
        app.api.post("/api/auth/login", body, json -> {
            idle();
            if (json.optBoolean("totpRequired")) {
                codeLabel.setVisibility(View.VISIBLE);
                code.setVisibility(View.VISIBLE);
                code.requestFocus();
                say("Enter the 6-digit code from your authenticator app.");
            } else app.connect();
        }, f -> {
            idle();
            if (f.challenge && !app.justVerified()) {
                app.pendingLogin = body; // finished by itself once the page is dealt with
                app.failed(f);
            } else say(f.challenge ? app.stillStopped(f) : f.message);
        });
    }

    private void idle() {
        busy = false;
        button.setText("Sign in");
        Ui.enable(button, true);
    }
}

/**
 * When something in front of the panel (Cloudflare) wants a page shown before it lets anything
 * through — its "checking your browser" step, or a Cloudflare Access sign-in — that page has to be
 * dealt with once. This screen shows it; as soon as the panel answers the app again, it closes by
 * itself, and what the page set (its cookies) covers the app's own requests from then on. It is
 * the only web page in the app.
 */
final class VerifyScreen extends Screen {
    private WebView web;

    VerifyScreen(MainActivity app, Api.Failure why) {
        super(app);
        LinearLayout box = Ui.column(app);
        box.setBackgroundColor(Ui.BG);
        int p = Ui.dp(app, 16);
        LinearLayout head = Ui.column(app);
        head.setPadding(p, p, p, p);
        boolean signIn = why != null && !why.where.isEmpty();
        head.addView(Ui.heading(app, signIn ? "One more step to reach your panel" : "Checking the connection"));
        head.addView(Ui.muted(app, signIn
            ? "Your panel's address sends visitors to " + why.where + " first. Do what the page below asks (usually a sign-in). The app carries on by itself, and only asks again when that sign-in runs out."
            : "Cloudflare, which sits in front of your panel, wants to check this phone once. It usually takes a few seconds; tick the box below if it asks. The app carries on by itself."));
        box.addView(head);
        web = new WebView(app);
        web.setBackgroundColor(Color.BLACK);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient());
        android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        box.addView(web, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
        TextView cancel = Ui.button(app, "Use another address", Ui.Kind.GHOST);
        cancel.setOnClickListener(v -> {
            app.pendingLogin = null;
            app.signedOut(null);
        });
        box.addView(cancel, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.dp(app, 44)), 16, 8, 16, 8));
        view = box;
        web.loadUrl(app.api.address() + "/");
    }

    @Override
    void tick() {
        app.api.get("/api/auth/state", json -> app.verified(), null);
    }

    @Override
    void closed() {
        if (web == null) return;
        ((LinearLayout) view).removeView(web);
        web.destroy();
        web = null;
    }
}

/** Who is signed in, which panel, and signing out. */
final class AccountScreen extends Screen {
    private final LinearLayout page;

    AccountScreen(MainActivity app) {
        super(app);
        page = scrollingPage();
    }

    @Override
    void shown() {
        page.removeAllViews();
        page.addView(Ui.title(app, "Account"));
        page.addView(Ui.gap(app, 14));

        LinearLayout me = Ui.card(app);
        LinearLayout who = Ui.row(app);
        who.addView(Ui.heading(app, app.user == null ? "" : app.user.optString("username")));
        who.addView(Ui.tag(app, app.isAdmin() ? "admin" : "user", app.isAdmin() ? Ui.ACCENT : Ui.MUTED), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 10, 0, 0, 0));
        me.addView(who);
        me.addView(Ui.muted(app, "Signed in on this phone until you sign out."), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 4, 0, 14));
        TextView out = Ui.button(app, "Sign out", Ui.Kind.DANGER);
        out.setOnClickListener(v -> confirm("Sign out?", "You will need your password to sign in again.", "Sign out", app::signOut));
        me.addView(out, Ui.lp(Ui.WRAP, Ui.dp(app, 40)));
        page.addView(me, Ui.lp(Ui.MATCH, Ui.WRAP));
        page.addView(Ui.gap(app, 14));

        LinearLayout panel = Ui.card(app);
        panel.addView(Ui.heading(app, app.panelName));
        panel.addView(Ui.gap(app, 8));
        fact(panel, "Address", app.api.address());
        fact(panel, "Panel version", app.panelVersion.isEmpty() ? "—" : app.panelVersion);
        fact(panel, "App version", appVersion());
        page.addView(panel, Ui.lp(Ui.MATCH, Ui.WRAP));
        page.addView(Ui.muted(app, "Mods, files, schedules and who may use each server are set up on the panel's website for now."), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 4, 14, 4, 0));
    }

    private void fact(LinearLayout into, String name, String value) {
        LinearLayout row = Ui.row(app);
        row.addView(Ui.muted(app, name), Ui.lp(Ui.dp(app, 120), Ui.WRAP));
        TextView v = Ui.body(app, value);
        row.addView(v, Ui.weight(1));
        into.addView(row, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 3, 0, 3));
    }

    private String appVersion() {
        try {
            return app.getPackageManager().getPackageInfo(app.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException e) {
            return "";
        }
    }
}

/**
 * The Andromeda Services window, on the phone: a card for each program it runs (Andromeda Hosting
 * and the websites) with its version and state and Start / Stop / Restart. The panel passes these
 * on to the Windows app, which has to be open on the PC.
 */
final class ServicesScreen extends Screen {
    private final LinearLayout page;
    private String drawn = "";

    ServicesScreen(MainActivity app) {
        super(app);
        page = scrollingPage();
        page.addView(Ui.muted(app, "Loading…"));
    }

    @Override
    void shown() {
        load();
    }

    @Override
    void tick() {
        load();
    }

    private void load() {
        app.api.get("/api/services", this::draw, f -> {
            if (f.status == 404) draw(json("available", false, "reason", "The panel on the PC is older than this app. Update it (Check for updates in Andromeda Services), then look here again."));
            else if (f.offline()) draw(json("available", false, "reason", f.message));
            else app.failed(f);
        });
    }

    private void draw(JSONObject data) {
        String now = data.toString();
        if (now.equals(drawn)) return; // nothing changed: leave the page (and where it's scrolled to) alone
        drawn = now;
        page.removeAllViews();
        LinearLayout head = Ui.row(app);
        ImageView logo = new ImageView(app);
        logo.setImageResource(R.drawable.ic_launcher_foreground);
        logo.setBackground(Ui.box(app, 0xFF0B0D10, Ui.BORDER, 14));
        head.addView(logo, Ui.lp(Ui.dp(app, 56), Ui.dp(app, 56)));
        LinearLayout names = Ui.column(app);
        names.addView(Ui.title(app, "Andromeda Services"));
        String about = data.optString("about");
        names.addView(Ui.muted(app, !about.isEmpty() ? about : data.optBoolean("available") ? "Version " + data.optString("version") : "On your PC"));
        head.addView(names, Ui.margins(app, Ui.weight(1), 12, 0, 0, 0));
        page.addView(head);
        page.addView(Ui.gap(app, 16));

        if (!data.optBoolean("available")) {
            LinearLayout note = Ui.card(app);
            note.setBackground(Ui.box(app, Ui.BG, Ui.alpha(Ui.WARN, 0x88), 16));
            note.addView(Ui.heading(app, "Not connected to Andromeda Services"));
            note.addView(Ui.text(app, data.optString("reason"), 14, Ui.TEXT_2, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 6, 0, 0));
            page.addView(note, Ui.lp(Ui.MATCH, Ui.WRAP));
            return;
        }
        if (data.optBoolean("updating")) {
            TextView busy = Ui.text(app, "Installing an update on the PC…", 14, Ui.ACCENT, true);
            page.addView(busy, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 2, 0, 0, 12));
        }
        JSONArray services = data.optJSONArray("services");
        for (int i = 0; services != null && i < services.length(); i++) {
            page.addView(card(services.optJSONObject(i), data.optBoolean("updating")), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 14));
        }
        page.addView(Ui.muted(app, "Starting and stopping happens on the PC within a second or two. Andromeda Hosting can be restarted from here but not stopped: it is what this app talks to."), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 4, 2, 4, 0));
    }

    private View card(JSONObject s, boolean updating) {
        final String key = s.optString("key");
        final String name = s.optString("name");
        String state = s.optString("state");
        boolean alive = state.equals("running") || state.equals("starting") || state.equals("waiting") || state.equals("stopping");
        LinearLayout card = Ui.card(app);
        LinearLayout top = Ui.row(app);
        top.addView(Ui.heading(app, name));
        top.addView(Ui.muted(app, s.optString("version")), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 8, 0, 0, 0));
        card.addView(top);

        String label;
        int color;
        switch (state) {
            case "starting": label = "Starting…"; color = Ui.WARN; break;
            case "running": label = "Running"; color = Ui.OK; break;
            case "stopping": label = key.equals("panel") ? "Stopping (saving game servers)…" : "Stopping…"; color = Ui.WARN; break;
            case "external": label = "Running outside Andromeda Services"; color = Ui.ACCENT; break;
            case "crashed": label = "Stopped unexpectedly — see the log on the PC"; color = Ui.BAD; break;
            case "waiting": label = "Waiting: choose the SPP folder in Settings"; color = Ui.WARN; break;
            default: label = "Stopped"; color = Ui.MUTED;
        }
        if (updating && !alive) {
            label = "Updating…";
            color = Ui.ACCENT;
        }
        card.addView(Ui.pill(app, label, color), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 0, 10, 0, 10));
        card.addView(Ui.text(app, s.optString("description"), 13.5f, Ui.TEXT_2, false));
        final String address = s.optString("address");
        if (!address.isEmpty()) {
            TextView link = Ui.text(app, address, 13.5f, Ui.ACCENT, false);
            link.setOnClickListener(v -> Ui.copy(app, address));
            card.addView(link, Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 0, 4, 0, 0));
        }

        LinearLayout buttons = Ui.row(app);
        boolean canStop = s.optBoolean("canStop", true);
        TextView main = Ui.button(app, alive ? "Stop" : "Start", alive ? Ui.Kind.SECONDARY : Ui.Kind.PRIMARY);
        Ui.enable(main, !updating && !state.equals("stopping") && !state.equals("external") && (!alive || canStop));
        main.setOnClickListener(v -> {
            if (alive) confirm("Stop " + name + "?", "It stays stopped until it is started again.", "Stop", () -> ask(key, "stop", name));
            else ask(key, "start", name);
        });
        TextView restart = Ui.button(app, "Restart", Ui.Kind.SECONDARY);
        Ui.enable(restart, !updating && state.equals("running"));
        restart.setOnClickListener(v -> confirm("Restart " + name + "?", key.equals("panel") ? "Running game servers are saved and stopped, then started again. The app loses the panel for a moment." : "It is back in a few seconds.", "Restart", () -> ask(key, "restart", name)));
        buttons.addView(main, Ui.lp(Ui.WRAP, Ui.dp(app, 40)));
        buttons.addView(restart, Ui.margins(app, Ui.lp(Ui.WRAP, Ui.dp(app, 40)), 8, 0, 0, 0));
        card.addView(buttons, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 0));
        return card;
    }

    private void ask(String key, String action, String name) {
        app.api.post("/api/services/" + key + "/" + action, null, json -> {
            Ui.toast(app, "Asked the PC to " + action + " " + name);
            view.postDelayed(this::load, 1500);
        }, app::failed);
    }
}
