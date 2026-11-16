package us.thefinalhour.andromeda;

import android.graphics.Typeface;
import android.text.InputType;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.TextUtils;
import android.text.style.ForegroundColorSpan;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * One server, like its page on the panel: its state and power buttons at the top, then tabs for
 * Overview (how to connect, players, CPU and memory), Console, Settings and Backups. Which tabs
 * and buttons show depends on what your account may do with this server.
 */
final class ServerScreen extends Screen {
    private static final String[] TABS = { "Overview", "Console", "Settings", "Backups" };
    private static final String[] TAB_PERM = { null, "console", "settings", "backups" };

    private final String id;
    private JSONObject s;                 // the server as the panel describes it
    private final TextView title, pill;
    private final LinearLayout power, tabStrip;
    private final FrameLayout body;
    private final List<TextView> tabButtons = new ArrayList<>();
    private int tab = 0;
    private String drawnOverview = "", drawnTabs = "", drawnPower = "";

    // Overview
    private LinearLayout overview;
    // Console
    private View consoleView;
    private TextView consoleText;
    private ScrollView consoleScroll;
    private EditText commandInput;
    private TextView sendButton;
    private String consoleMark = "";
    // Settings and Backups
    private SettingsForm settings;
    private LinearLayout backups;
    private String drawnBackups = "";

    ServerScreen(MainActivity app, String id, String name) {
        super(app);
        this.id = id;
        LinearLayout root = Ui.column(app);
        root.setBackgroundColor(Ui.BG);

        LinearLayout top = Ui.row(app);
        top.setPadding(Ui.dp(app, 6), Ui.dp(app, 8), Ui.dp(app, 14), Ui.dp(app, 6));
        TextView backButton = Ui.text(app, "←", 22, Ui.TEXT, false);
        backButton.setGravity(Gravity.CENTER);
        backButton.setBackground(Ui.pressable(app, 0, 0, 99));
        backButton.setOnClickListener(v -> app.setOver(null));
        top.addView(backButton, Ui.lp(Ui.dp(app, 44), Ui.dp(app, 44)));
        title = Ui.text(app, name, 19, Ui.TEXT, true);
        title.setSingleLine(true);
        title.setEllipsize(TextUtils.TruncateAt.END);
        top.addView(title, Ui.margins(app, Ui.weight(1), 4, 0, 8, 0));
        pill = Ui.pill(app, "…", Ui.MUTED);
        top.addView(pill);
        root.addView(top);

        power = Ui.row(app);
        power.setPadding(Ui.dp(app, 16), 0, Ui.dp(app, 16), Ui.dp(app, 10));
        root.addView(power);

        HorizontalScrollView strip = new HorizontalScrollView(app);
        strip.setHorizontalScrollBarEnabled(false);
        tabStrip = Ui.row(app);
        tabStrip.setPadding(Ui.dp(app, 10), 0, Ui.dp(app, 10), 0);
        strip.addView(tabStrip);
        root.addView(strip);
        root.addView(Ui.line(app));

        body = new FrameLayout(app);
        root.addView(body, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
        view = root;
        showBody(Ui.muted(app, "  Loading…"));
    }

    @Override
    void shown() {
        load();
    }

    @Override
    void tick() {
        load();
    }

    private boolean can(String perm) {
        return s != null && Art.can(s, perm);
    }

    private JSONObject runtime() {
        JSONObject rt = s == null ? null : s.optJSONObject("runtime");
        return rt == null ? new JSONObject() : rt;
    }

    private String status() {
        return runtime().optString("status", "stopped");
    }

    private void load() {
        app.api.get("/api/servers/" + id, json -> {
            boolean first = s == null;
            s = json.optJSONObject("server");
            if (s == null) return;
            title.setText(s.optString("name"));
            Ui.setPill(pill, Ui.statusLabel(status()), Ui.statusColor(status()));
            drawPower();
            drawTabs();
            if (first) open(0);
            else refreshTab();
        }, f -> {
            if (f.status == 404) {
                Ui.toast(app, "This server was deleted");
                app.setOver(null);
            } else if (!f.offline()) app.failed(f);
        });
    }

    // ---------- power ----------

    private void drawPower() {
        String st = status();
        JSONObject job = runtime().optJSONObject("job");
        boolean busy = job != null && "running".equals(job.optString("status"));
        boolean live = Ui.isOnline(st);
        boolean show = can("control") && s.optBoolean("installed");
        String now = st + busy + show;
        if (now.equals(drawnPower)) return;
        drawnPower = now;
        power.removeAllViews();
        power.setVisibility(show ? View.VISIBLE : View.GONE);
        if (!show) return;
        if (!live) powerButton("Start", "start", Ui.Kind.PRIMARY, !busy, null);
        else {
            powerButton("Restart", "restart", Ui.Kind.SECONDARY, st.equals("running"), null);
            powerButton("Stop", "stop", Ui.Kind.SECONDARY, !st.equals("stopping"), null);
            powerButton("Kill", "kill", Ui.Kind.DANGER, true, "The server is ended at once. Anything not saved yet is lost.");
        }
    }

    private void powerButton(String label, final String action, Ui.Kind kind, boolean enabled, final String warning) {
        final TextView b = Ui.button(app, label, kind);
        Ui.enable(b, enabled);
        b.setOnClickListener(v -> {
            Runnable go = () -> {
                Ui.enable(b, false);
                app.api.post("/api/servers/" + id + "/power", json("action", action), json -> view.postDelayed(this::load, 500), f -> {
                    Ui.enable(b, true);
                    app.failed(f);
                });
            };
            if (warning != null) confirm(label + " the server?", warning, label, go);
            else go.run();
        });
        power.addView(b, Ui.margins(app, Ui.lp(Ui.WRAP, Ui.dp(app, 40)), 0, 0, 8, 0));
    }

    // ---------- tabs ----------

    private void drawTabs() {
        StringBuilder allowed = new StringBuilder();
        for (int i = 0; i < TABS.length; i++) if (TAB_PERM[i] == null || can(TAB_PERM[i])) allowed.append(i);
        if (allowed.toString().equals(drawnTabs)) return;
        drawnTabs = allowed.toString();
        tabStrip.removeAllViews();
        tabButtons.clear();
        for (int i = 0; i < TABS.length; i++) {
            final int index = i;
            TextView b = Ui.text(app, TABS[i], 14, Ui.TEXT_2, false);
            b.setGravity(Gravity.CENTER);
            b.setPadding(Ui.dp(app, 14), 0, Ui.dp(app, 14), 0);
            b.setOnClickListener(v -> open(index));
            b.setVisibility(drawnTabs.indexOf(String.valueOf(i)) >= 0 ? View.VISIBLE : View.GONE);
            tabButtons.add(b);
            tabStrip.addView(b, Ui.lp(Ui.WRAP, Ui.dp(app, 44)));
        }
        markTab();
    }

    private void markTab() {
        for (int i = 0; i < tabButtons.size(); i++) {
            boolean on = i == tab;
            TextView b = tabButtons.get(i);
            b.setTextColor(on ? Ui.TEXT : Ui.TEXT_2);
            b.setTypeface(Typeface.DEFAULT, on ? Typeface.BOLD : Typeface.NORMAL);
            b.setBackground(on ? new android.graphics.drawable.GradientDrawable(android.graphics.drawable.GradientDrawable.Orientation.BOTTOM_TOP, new int[] { Ui.alpha(Ui.ACCENT, 0x66), 0 }) : null);
        }
    }

    private void showBody(View v) {
        body.removeAllViews();
        body.addView(v, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
    }

    private void open(int index) {
        app.hideKeyboard();
        tab = index;
        markTab();
        if (index == 0) {
            if (overview == null) {
                ScrollView scroll = new ScrollView(app);
                overview = Ui.column(app);
                int p = Ui.dp(app, 16);
                overview.setPadding(p, p, p, Ui.dp(app, 28));
                scroll.addView(overview);
                overview.setTag(scroll);
            }
            showBody((View) overview.getTag());
            drawnOverview = "";
            drawOverview();
        } else if (index == 1) {
            if (consoleView == null) buildConsole();
            showBody(consoleView);
            consoleMark = "";
            loadConsole();
        } else if (index == 2) {
            if (settings == null) settings = new SettingsForm(app, id);
            showBody(settings.view);
            settings.load();
        } else {
            if (backups == null) {
                ScrollView scroll = new ScrollView(app);
                backups = Ui.column(app);
                int p = Ui.dp(app, 16);
                backups.setPadding(p, p, p, Ui.dp(app, 28));
                scroll.addView(backups);
                backups.setTag(scroll);
            }
            showBody((View) backups.getTag());
            drawnBackups = "";
            loadBackups();
        }
    }

    private void refreshTab() {
        if (tab == 0) drawOverview();
        else if (tab == 1) loadConsole();
        else if (tab == 3) loadBackups();
    }

    @Override
    boolean back() {
        return tab == 2 && settings != null && settings.back();
    }

    // ---------- Overview ----------

    private void drawOverview() {
        if (overview == null || s == null) return;
        JSONObject rt = runtime();
        JSONArray hist = s.optJSONArray("statsHistory");
        // Uptime ticks along on its own; everything else redraws when the panel's answer changes.
        JSONObject copy;
        try {
            copy = new JSONObject(s.toString());
            copy.remove("statsHistory");
        } catch (org.json.JSONException e) {
            copy = s;
        }
        String now = copy.toString() + (hist == null ? 0 : hist.length());
        if (now.equals(drawnOverview)) return;
        drawnOverview = now;
        overview.removeAllViews();
        String st = status();
        boolean live = Ui.isOnline(st);

        FrameLayout banner = Art.banner(app, s, 110, 34);
        ((android.graphics.drawable.GradientDrawable) banner.getBackground()).setCornerRadius(Ui.dp(app, 16));
        banner.setClipToOutline(true); // the picture gets the same rounded corners as the cards
        overview.addView(banner, Ui.lp(Ui.MATCH, Ui.dp(app, 110)));
        JSONObject summary = s.optJSONObject("summary");
        if (summary != null) overview.addView(Ui.muted(app, summary.optString("game") + " · " + summary.optString("detail")), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 2, 8, 0, 0));

        JSONObject job = rt.optJSONObject("job");
        if (job != null && ("running".equals(job.optString("status")) || "failed".equals(job.optString("status")))) {
            LinearLayout j = section(job.optString("label"));
            boolean running = "running".equals(job.optString("status"));
            j.addView(Ui.pill(app, running ? "In progress" : "Failed", running ? Ui.ACCENT : Ui.BAD));
            String progress = job.optString("progressLabel") + (job.isNull("progress") ? "" : " · " + Math.round(job.optDouble("progress")) + "%");
            if (running && progress.length() > 3) j.addView(Ui.muted(app, progress), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 6, 0, 0));
            if (!job.isNull("error") && !job.optString("error").isEmpty()) j.addView(Ui.text(app, job.optString("error"), 13.5f, Ui.BAD, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 6, 0, 0));
            JSONArray log = job.optJSONArray("log");
            StringBuilder tail = new StringBuilder();
            for (int i = Math.max(0, (log == null ? 0 : log.length()) - 6); log != null && i < log.length(); i++) tail.append(log.optJSONObject(i) == null ? "" : log.optJSONObject(i).optString("line")).append('\n');
            if (tail.length() > 0) j.addView(Ui.mono(app, tail.toString().trim(), 11.5f, Ui.TEXT_2), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 8, 0, 0));
        }
        if (!s.optBoolean("installed") && !s.isNull("lastInstallError") && !s.optString("lastInstallError").isEmpty()) {
            LinearLayout bad = section("Install failed");
            bad.addView(Ui.text(app, s.optString("lastInstallError"), 13.5f, Ui.BAD, false));
        }

        // Connect
        LinearLayout connect = section("Connect");
        JSONObject wow = s.optJSONObject("wow");
        final String address = wow != null ? "set realmlist " + (wow.isNull("address") || wow.optString("address").isEmpty() ? "127.0.0.1" : wow.optString("address")) : s.isNull("connect") ? "" : s.optString("connect");
        if (wow != null) connect.addView(Ui.text(app, "Everyone puts this one line in Data\\enUS\\realmlist.wtf in their WoW 3.3.5a folder:", 13.5f, Ui.TEXT_2, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 8));
        if (address.isEmpty()) connect.addView(Ui.muted(app, "Set your public IP or domain under Panel settings on the website to show an address to share."));
        else connect.addView(copyBox(address));
        for (String key : new String[] { "ark", "cod", "sf", "sdtd", "vh" }) {
            JSONObject g = s.optJSONObject(key);
            if (g == null || !g.has("joinPassword")) continue;
            final String pw = g.optString("joinPassword");
            if (pw.isEmpty()) connect.addView(Ui.text(app, "No join password: anyone with the address can join.", 13, Ui.WARN, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 8, 0, 0));
            else {
                connect.addView(Ui.muted(app, "Join password"), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 10, 0, 4));
                connect.addView(copyBox(pw));
            }
        }
        JSONArray ports = s.optJSONArray("ports");
        StringBuilder forward = new StringBuilder();
        for (int i = 0; ports != null && i < ports.length(); i++) {
            JSONObject p = ports.optJSONObject(i);
            if (p == null || !p.optBoolean("forward")) continue;
            forward.append(p.optInt("port")).append("  ").append(p.optString("proto")).append("  ").append(p.optString("label")).append('\n');
        }
        if (forward.length() > 0) {
            connect.addView(Ui.groupLabel(app, "Ports to forward on your router"), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 6));
            connect.addView(Ui.mono(app, forward.toString().trim(), 12.5f, Ui.TEXT_2));
        }

        // Status
        LinearLayout stat = section("Status");
        JSONObject players = rt.optJSONObject("players");
        fact(stat, "State", Ui.statusLabel(st));
        long started = rt.optLong("startedAt", 0);
        fact(stat, "Uptime", live && started > 0 ? Ui.duration(System.currentTimeMillis() - started) : "—");
        String idle = Art.stopsIn(players);
        fact(stat, "Players", Art.players(players, " / ") + (idle.isEmpty() ? "" : " · empty, " + idle));
        if (players != null && !players.isNull("map") && !players.optString("map").isEmpty()) fact(stat, "Map", players.optString("map"));
        JSONArray names = players == null ? null : players.optJSONArray("players");
        if (names != null && names.length() > 0) {
            StringBuilder who = new StringBuilder();
            for (int i = 0; i < names.length(); i++) who.append(i == 0 ? "" : ", ").append(names.optString(i));
            stat.addView(Ui.text(app, who.toString(), 13.5f, Ui.TEXT_2, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 6, 0, 0));
        }
        if (can("settings")) {
            stat.addView(Ui.line(app), Ui.margins(app, Ui.lp(Ui.MATCH, 1), 0, 12, 0, 6));
            flag(stat, "Start when the panel starts", "autoStart");
            flag(stat, "Restart automatically after a crash", "autoRestart");
            flag(stat, "Stop when nobody has been on for 10 minutes", "stopWhenEmpty");
        }

        // CPU and memory
        JSONObject stats = rt.optJSONObject("stats");
        int n = hist == null ? 0 : hist.length();
        double[] cpu = new double[n], mem = new double[n];
        for (int i = 0; i < n; i++) {
            JSONObject h = hist.optJSONObject(i);
            cpu[i] = h == null ? 0 : h.optDouble("cpu", 0);
            mem[i] = h == null ? 0 : h.optDouble("mem", 0) / 1073741824.0;
        }
        chart("CPU", live && stats != null ? String.format(Locale.US, "%.1f%%", stats.optDouble("cpu")) : "—", cpu, 25, "Share of the whole PC (" + s.optInt("cores") + " threads), last 6 minutes");
        chart("Memory", live && stats != null ? Ui.bytes(stats.optDouble("mem")) : "—", mem, 4, "Working set, last 6 minutes");
    }

    private LinearLayout section(String name) {
        LinearLayout card = Ui.card(app);
        card.addView(Ui.heading(app, name), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 10));
        overview.addView(card, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 0));
        return card;
    }

    private View copyBox(final String what) {
        LinearLayout box = Ui.row(app);
        box.setBackground(Ui.box(app, Ui.BG, Ui.BORDER, 10));
        box.setPadding(Ui.dp(app, 12), Ui.dp(app, 6), Ui.dp(app, 6), Ui.dp(app, 6));
        box.addView(Ui.mono(app, what, 14, Ui.TEXT), Ui.weight(1));
        TextView copy = Ui.button(app, "Copy", Ui.Kind.SECONDARY);
        copy.setOnClickListener(v -> Ui.copy(app, what));
        box.addView(copy, Ui.lp(Ui.WRAP, Ui.dp(app, 34)));
        return box;
    }

    private void fact(LinearLayout into, String name, String value) {
        LinearLayout row = Ui.row(app);
        row.addView(Ui.muted(app, name), Ui.lp(Ui.dp(app, 86), Ui.WRAP));
        row.addView(Ui.body(app, value), Ui.weight(1));
        into.addView(row, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 3, 0, 3));
    }

    private void flag(LinearLayout into, String label, final String key) {
        final Switch sw = new Switch(app);
        sw.setText(label);
        sw.setTextColor(Ui.TEXT);
        sw.setTextSize(14);
        sw.setChecked(s.optBoolean(key));
        sw.setOnCheckedChangeListener((CompoundButton b, boolean on) -> app.api.patch("/api/servers/" + id, json(key, on), json -> {
            try {
                s.put(key, on);
            } catch (org.json.JSONException ignored) {
                // a boolean always fits
            }
            Ui.toast(app, "Saved");
        }, f -> {
            app.failed(f);
            drawnOverview = ""; // put the switch back to what the panel has
            drawOverview();
        }));
        into.addView(sw, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 6, 0, 6));
    }

    private void chart(String name, String value, double[] values, double max, String note) {
        LinearLayout card = Ui.card(app);
        LinearLayout head = Ui.row(app);
        head.addView(Ui.heading(app, name), Ui.weight(1));
        head.addView(Ui.text(app, value, 19, Ui.TEXT, true));
        card.addView(head);
        if (values.length >= 2) {
            Sparkline line = new Sparkline(app);
            line.set(values, max);
            card.addView(line, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.dp(app, 56)), 0, 8, 0, 6));
        } else card.addView(Ui.muted(app, "Waiting for data…"), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 14));
        card.addView(Ui.text(app, note, 12.5f, Ui.MUTED, false));
        overview.addView(card, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 0));
    }

    // ---------- Console ----------

    private String[][] quickCommands() {
        if (s.has("wow")) return new String[][] { { "Save all", "saveall" }, { "Server info", "server info" }, { "Who is online", "account onlinelist" }, { "Announce…", "announce " } };
        if (s.has("cod")) return new String[][] { { "Status", "status" }, { "Next map", "map_rotate" }, { "Restart map", "fast_restart" }, { "Say…", "say " } };
        if (s.has("sdtd")) return new String[][] { { "List players", "lp" }, { "Save world", "saveworld" }, { "Game time", "gettime" }, { "Say…", "say \"" } };
        if (s.has("rust")) return new String[][] { { "Save world", "server.save" }, { "Players", "playerlist" }, { "Plugins", "oxide.plugins" }, { "Say…", "say \"" } };
        if (s.has("sf") || s.has("vh")) return new String[0][];
        if (s.has("ark")) return new String[][] { { "Save world", "SaveWorld" }, { "List players", "ListPlayers" }, { "Wipe wild dinos", "DestroyWildDinos" }, { "Broadcast…", "Broadcast " } };
        return new String[][] { { "List players", "list" }, { "Save world", "save-all" }, { "Whitelist add…", "whitelist add " }, { "Say…", "say " } };
    }

    private void buildConsole() {
        LinearLayout box = Ui.column(app);
        HorizontalScrollView quickScroll = new HorizontalScrollView(app);
        quickScroll.setHorizontalScrollBarEnabled(false);
        LinearLayout quick = Ui.row(app);
        quick.setPadding(Ui.dp(app, 12), Ui.dp(app, 8), Ui.dp(app, 12), Ui.dp(app, 4));
        for (final String[] q : quickCommands()) {
            TextView b = Ui.button(app, q[0], Ui.Kind.GHOST);
            b.setTextSize(13);
            b.setOnClickListener(v -> {
                if (q[1].endsWith(" ") || q[1].endsWith("\"")) {
                    commandInput.setText(q[1]);
                    commandInput.setSelection(q[1].length());
                    commandInput.requestFocus();
                } else send(q[1]);
            });
            quick.addView(b, Ui.lp(Ui.WRAP, Ui.dp(app, 34)));
        }
        quickScroll.addView(quick);
        box.addView(quickScroll);

        consoleScroll = new ScrollView(app);
        consoleScroll.setBackground(Ui.box(app, 0xFF050607, Ui.BORDER, 14));
        consoleText = Ui.mono(app, "", 11.5f, 0xFFC5CEDB);
        consoleText.setTextIsSelectable(true);
        int p = Ui.dp(app, 10);
        consoleText.setPadding(p, p, p, p);
        consoleScroll.addView(consoleText);
        box.addView(consoleScroll, Ui.margins(app, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f), 12, 4, 12, 8));

        LinearLayout inputRow = Ui.row(app);
        inputRow.setPadding(Ui.dp(app, 12), 0, Ui.dp(app, 12), Ui.dp(app, 10));
        commandInput = Ui.input(app, s.has("vh") ? "Valheim has no server console" : "Command", InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        commandInput.setTypeface(Typeface.MONOSPACE);
        commandInput.setImeOptions(EditorInfo.IME_ACTION_SEND);
        commandInput.setOnEditorActionListener((v, action, event) -> {
            send(commandInput.getText().toString());
            return true;
        });
        inputRow.addView(commandInput, Ui.weight(1));
        sendButton = Ui.button(app, "Send", Ui.Kind.PRIMARY);
        sendButton.setOnClickListener(v -> send(commandInput.getText().toString()));
        inputRow.addView(sendButton, Ui.margins(app, Ui.lp(Ui.WRAP, Ui.dp(app, 44)), 8, 0, 0, 0));
        box.addView(inputRow);
        consoleView = box;
    }

    private void send(String command) {
        final String c = command.trim();
        if (c.isEmpty()) return;
        if (!(status().equals("running") || status().equals("starting"))) {
            Ui.toast(app, "The server is not running");
            return;
        }
        commandInput.setText("");
        app.api.post("/api/servers/" + id + "/command", json("command", c), json -> view.postDelayed(this::loadConsole, 400), app::failed);
    }

    private void loadConsole() {
        if (consoleView == null) return;
        boolean live = (status().equals("running") || status().equals("starting")) && !s.has("vh");
        Ui.enable(sendButton, live);
        commandInput.setEnabled(live);
        app.api.get("/api/servers/" + id + "/console", json -> {
            JSONArray lines = json.optJSONArray("lines");
            int n = lines == null ? 0 : lines.length();
            JSONObject last = n == 0 ? null : lines.optJSONObject(n - 1);
            String mark = n + "|" + (last == null ? "" : last.optLong("t") + last.optString("line"));
            if (mark.equals(consoleMark)) return;
            consoleMark = mark;
            // Stay at the newest line unless you scrolled up to read something.
            boolean atEnd = consoleScroll.getScrollY() + consoleScroll.getHeight() >= consoleText.getBottom() - Ui.dp(app, 60);
            SpannableStringBuilder text = new SpannableStringBuilder();
            for (int i = Math.max(0, n - 400); i < n; i++) {
                JSONObject entry = lines.optJSONObject(i);
                String line = entry == null ? "" : entry.optString("line");
                int from = text.length();
                text.append(line).append('\n');
                int color = lineColor(line);
                if (color != 0) text.setSpan(new ForegroundColorSpan(color), from, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
            }
            if (n == 0) text.append("Nothing yet. The console fills up when the server starts.");
            consoleText.setText(text);
            if (atEnd) consoleScroll.post(() -> consoleScroll.fullScroll(View.FOCUS_DOWN));
        }, f -> {
            if (!f.offline()) app.failed(f);
        });
    }

    /** The same colours as the panel's console: its own lines blue, errors red, warnings amber, what you typed orange. */
    private static int lineColor(String l) {
        if (l.startsWith("[panel]") || l.matches("^\\[(install|update|backup|restore|schedule|files|mods|rcon|mod config)\\].*")) return 0xFF79B8FF;
        if (l.matches(".*\\b(ERROR|FATAL|SEVERE|Exception)\\b.*")) return 0xFFFF8085;
        if (l.matches(".*\\bWARN(ING)?\\b.*")) return 0xFFFFC861;
        if (l.startsWith("> ")) return 0xFFFFA07A;
        return 0;
    }

    // ---------- Backups ----------

    private void loadBackups() {
        if (backups == null) return;
        app.api.get("/api/servers/" + id + "/backups", json -> {
            String now = json.toString() + status();
            if (now.equals(drawnBackups)) return;
            drawnBackups = now;
            backups.removeAllViews();
            LinearLayout head = Ui.row(app);
            head.addView(Ui.heading(app, "Backups"), Ui.weight(1));
            TextView make = Ui.button(app, "Back up now", Ui.Kind.PRIMARY);
            make.setOnClickListener(v -> {
                Ui.enable(make, false);
                app.api.post("/api/servers/" + id + "/backups", null, r -> {
                    Ui.toast(app, "Backup started");
                    view.postDelayed(this::load, 800);
                }, f -> {
                    Ui.enable(make, true);
                    app.failed(f);
                });
            });
            head.addView(make, Ui.lp(Ui.WRAP, Ui.dp(app, 38)));
            backups.addView(head);
            backups.addView(Ui.muted(app, "The newest " + json.optInt("keep", 10) + " are kept. Restoring needs the server stopped."), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 4, 0, 10));
            JSONArray list = json.optJSONArray("backups");
            if (list == null || list.length() == 0) backups.addView(Ui.muted(app, "No backups yet."));
            for (int i = 0; list != null && i < list.length(); i++) {
                final JSONObject b = list.optJSONObject(i);
                if (b == null) continue;
                final String name = b.optString("name");
                LinearLayout card = Ui.card(app);
                String when = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(new java.util.Date(b.optLong("createdAt")));
                card.addView(Ui.text(app, when, 15, Ui.TEXT, true));
                card.addView(Ui.muted(app, Ui.bytes(b.optDouble("size")) + (b.optString("reason").isEmpty() ? "" : " · " + b.optString("reason"))));
                LinearLayout buttons = Ui.row(app);
                TextView restore = Ui.button(app, "Restore", Ui.Kind.SECONDARY);
                restore.setOnClickListener(v -> confirm("Restore this backup?", "The server's world and settings go back to how they were on " + when + ". What changed since then is lost.", "Restore", () -> app.api.post("/api/servers/" + id + "/backups/" + name + "/restore", null, r -> {
                    Ui.toast(app, "Restore started");
                    open(0);
                }, app::failed)));
                TextView delete = Ui.button(app, "Delete", Ui.Kind.DANGER);
                delete.setOnClickListener(v -> confirm("Delete this backup?", "The backup from " + when + " is removed for good.", "Delete", () -> app.api.delete("/api/servers/" + id + "/backups/" + name, r -> {
                    drawnBackups = "";
                    loadBackups();
                }, app::failed)));
                buttons.addView(restore, Ui.lp(Ui.WRAP, Ui.dp(app, 36)));
                buttons.addView(delete, Ui.margins(app, Ui.lp(Ui.WRAP, Ui.dp(app, 36)), 8, 0, 0, 0));
                card.addView(buttons, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 10, 0, 0));
                backups.addView(card, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 12));
            }
        }, f -> {
            if (!f.offline()) app.failed(f);
        });
    }
}
