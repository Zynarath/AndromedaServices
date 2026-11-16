package us.thefinalhour.andromeda;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.drawable.GradientDrawable;
import android.view.Gravity;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Locale;

/**
 * The panel's dashboard: the PC's CPU, memory and disk, then every server you may see, the online
 * ones first. Each card has the game's picture, the server's state, players, CPU and memory, and
 * a Start or Stop button. Tap a card to open the server.
 */
final class DashboardScreen extends Screen {
    private final LinearLayout page;
    private JSONObject system;
    private JSONArray servers;
    private String drawn = "";

    DashboardScreen(MainActivity app) {
        super(app);
        page = scrollingPage();
        page.addView(Ui.title(app, "Dashboard"));
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
        app.api.get("/api/system", json -> {
            system = json;
            draw();
        }, f -> {
            if (!f.offline()) app.failed(f);
        });
        app.api.get("/api/servers", json -> {
            servers = json.optJSONArray("servers");
            draw();
        }, f -> {
            if (f.offline()) offline(f.message);
            else app.failed(f);
        });
    }

    private void offline(String message) {
        if (drawn.equals("offline")) return;
        drawn = "offline";
        page.removeAllViews();
        page.addView(Ui.title(app, "Dashboard"));
        LinearLayout note = Ui.card(app);
        note.setBackground(Ui.box(app, Ui.BG, Ui.alpha(Ui.WARN, 0x88), 16));
        note.addView(Ui.heading(app, "Can't reach the panel"));
        note.addView(Ui.text(app, message + " The app keeps trying.", 14, Ui.TEXT_2, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 6, 0, 0));
        page.addView(note, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 0));
    }

    private void draw() {
        if (servers == null) return;
        // Drawn again only when something on the page would change, so it never jumps under your finger.
        String now = servers.toString() + (system == null ? "" : Math.round(system.optDouble("cpu")) + "|" + system.optLong("memFree") / 50_000_000L);
        if (now.equals(drawn)) return;
        drawn = now;
        page.removeAllViews();
        page.addView(Ui.title(app, "Dashboard"));
        page.addView(Ui.muted(app, system == null ? app.panelName : "Everything running on " + system.optString("hostname")));
        page.addView(Ui.gap(app, 14));

        int online = 0;
        for (int i = 0; i < servers.length(); i++) if ("running".equals(status(servers.optJSONObject(i)))) online++;
        if (system != null) {
            double total = system.optDouble("memTotal", 0), free = system.optDouble("memFree", 0);
            JSONObject disk = system.optJSONObject("disk");
            LinearLayout a = Ui.row(app), b = Ui.row(app);
            a.addView(tile(R.drawable.ic_cpu, "Host CPU", Math.round(system.optDouble("cpu", 0)) + "%", system.optInt("cores") + " threads", system.optDouble("cpu", 0) / 100), tileSize(true));
            a.addView(tile(R.drawable.ic_memory, "Host memory", Ui.bytes(total - free), "of " + Ui.bytes(total), total > 0 ? (total - free) / total : -1), tileSize(false));
            b.addView(tile(R.drawable.ic_archive, "Server drive", disk == null ? "—" : Ui.bytes(disk.optDouble("free")), disk == null ? "unknown" : "free of " + Ui.bytes(disk.optDouble("total")), disk == null || disk.optDouble("total") <= 0 ? -1 : 1 - disk.optDouble("free") / disk.optDouble("total")), tileSize(true));
            b.addView(tile(R.drawable.ic_server, "Servers online", online + " / " + servers.length(), "", -1), tileSize(false));
            page.addView(a);
            page.addView(b, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 10, 0, 0));
        }

        if (servers.length() == 0) {
            LinearLayout none = Ui.card(app);
            none.setGravity(Gravity.CENTER);
            none.addView(Ui.heading(app, "No servers yet"));
            none.addView(Ui.muted(app, app.isAdmin() ? "Create your first server on the panel's website; it then shows up here." : "An admin has not given you access to any servers yet."));
            page.addView(none, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 18, 0, 0));
            return;
        }
        group("Online", true, Ui.OK);
        group("Offline", false, Ui.MUTED);
    }

    private LinearLayout.LayoutParams tileSize(boolean first) {
        return Ui.margins(app, new LinearLayout.LayoutParams(0, Ui.MATCH, 1f), first ? 0 : 5, 0, first ? 5 : 0, 0);
    }

    /** A number with its name, like the tiles on the panel's dashboard. meter: 0..1, or below 0 for none. */
    private View tile(int icon, String label, String value, String note, double meter) {
        LinearLayout t = Ui.card(app);
        int p = Ui.dp(app, 14);
        t.setPadding(p, p, p, p);
        LinearLayout head = Ui.row(app);
        head.addView(Ui.icon(app, icon, Ui.MUTED, 15));
        head.addView(Ui.text(app, label, 12.5f, Ui.MUTED, true), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 6, 0, 0, 0));
        t.addView(head);
        t.addView(Ui.text(app, value, 24, Ui.TEXT, true));
        if (!note.isEmpty()) t.addView(Ui.text(app, note, 12.5f, Ui.MUTED, false));
        if (meter >= 0) {
            FrameLayout bar = new FrameLayout(app);
            bar.setBackground(Ui.box(app, Ui.SURFACE_HI, 0, 99));
            View fill = new View(app);
            fill.setBackground(Ui.box(app, Ui.ACCENT, 0, 99));
            LinearLayout track = Ui.row(app);
            float used = (float) Math.max(0.02, Math.min(1, meter));
            track.addView(fill, new LinearLayout.LayoutParams(0, Ui.MATCH, used));
            track.addView(new View(app), new LinearLayout.LayoutParams(0, Ui.MATCH, 1 - used));
            bar.addView(track, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
            t.addView(bar, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.dp(app, 5)), 0, 10, 0, 0));
        }
        return t;
    }

    private static String status(JSONObject s) {
        JSONObject rt = s == null ? null : s.optJSONObject("runtime");
        return rt == null ? "stopped" : rt.optString("status", "stopped");
    }

    private void group(String name, boolean onlineOnes, int dot) {
        int count = 0;
        for (int i = 0; i < servers.length(); i++) if (Ui.isOnline(status(servers.optJSONObject(i))) == onlineOnes) count++;
        if (count == 0) return;
        LinearLayout head = Ui.row(app);
        head.addView(Ui.text(app, "●", 11, dot, false));
        head.addView(Ui.groupLabel(app, name), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 8, 0, 8, 0));
        TextView n = Ui.text(app, String.valueOf(count), 12, Ui.TEXT_2, true);
        n.setBackground(Ui.box(app, Ui.SURFACE_HI, 0, 99));
        n.setPadding(Ui.dp(app, 8), Ui.dp(app, 1), Ui.dp(app, 8), Ui.dp(app, 1));
        head.addView(n);
        View rule = new View(app);
        rule.setBackgroundColor(Ui.BORDER);
        head.addView(rule, Ui.margins(app, new LinearLayout.LayoutParams(0, 1, 1f), 10, 0, 0, 0));
        page.addView(head, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 24, 0, 12));
        for (int i = 0; i < servers.length(); i++) {
            JSONObject s = servers.optJSONObject(i);
            if (s == null || Ui.isOnline(status(s)) != onlineOnes) continue;
            page.addView(card(s, onlineOnes), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 0, 0, 14));
        }
    }

    private View card(final JSONObject s, boolean online) {
        final String id = s.optString("id");
        final String name = s.optString("name");
        JSONObject rt = s.optJSONObject("runtime");
        if (rt == null) rt = new JSONObject();
        String status = rt.optString("status", "stopped");
        JSONObject players = rt.optJSONObject("players"), stats = rt.optJSONObject("stats"), job = rt.optJSONObject("job");
        boolean jobRunning = job != null && "running".equals(job.optString("status"));

        LinearLayout card = Ui.column(app);
        card.setBackground(new android.graphics.drawable.RippleDrawable(android.content.res.ColorStateList.valueOf(0x22FFFFFF), new PanelDrawable(app, Ui.BG, Ui.BORDER, 16), Ui.box(app, 0xFFFFFFFF, 0, 16)));
        card.setClipToOutline(true);
        card.setOnClickListener(v -> app.openServer(id, name));
        if (!online) card.setAlpha(0.9f);

        FrameLayout art = Art.banner(app, s, 96, 30);
        FrameLayout.LayoutParams at = new FrameLayout.LayoutParams(Ui.WRAP, Ui.WRAP, Gravity.TOP | Gravity.END);
        at.setMargins(0, Ui.dp(app, 10), Ui.dp(app, 10), 0);
        art.addView(Ui.pill(app, Ui.statusLabel(status), Ui.statusColor(status)), at);
        card.addView(art, Ui.lp(Ui.MATCH, Ui.dp(app, 96)));

        LinearLayout body = Ui.column(app);
        int p = Ui.dp(app, 16);
        body.setPadding(p, Ui.dp(app, 12), p, Ui.dp(app, 12));
        JSONObject summary = s.optJSONObject("summary");
        body.addView(Ui.heading(app, name));
        if (summary != null) {
            body.addView(Ui.text(app, summary.optString("game"), 13, Ui.TEXT_2, false));
            body.addView(Ui.text(app, summary.optString("detail"), 13, Ui.MUTED, false));
        }
        if (jobRunning) {
            body.addView(Ui.text(app, job.optString("label") + (job.optString("progressLabel").isEmpty() ? "" : " · " + job.optString("progressLabel")), 13, Ui.ACCENT, true), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 10, 0, 0));
        } else {
            LinearLayout numbers = Ui.row(app);
            numbers.addView(stat("Players", Art.players(players, "/")), Ui.weight(1));
            numbers.addView(stat("CPU", online && stats != null ? String.format(Locale.US, "%.1f%%", stats.optDouble("cpu")) : "—"), Ui.weight(1));
            numbers.addView(stat("RAM", online && stats != null ? Ui.bytes(stats.optDouble("mem")) : "—"), Ui.weight(1));
            body.addView(numbers, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 12, 0, 0));
            String idle = Art.stopsIn(players);
            if (!idle.isEmpty()) body.addView(Ui.text(app, "Empty · " + idle, 12.5f, Ui.WARN, true), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 6, 0, 0));
        }
        if (!s.optBoolean("installed") && !jobRunning && !s.isNull("lastInstallError")) body.addView(Ui.text(app, "Install failed — open the server for details", 12.5f, Ui.BAD, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 8, 0, 0));
        card.addView(body);
        card.addView(Ui.line(app));

        LinearLayout actions = Ui.row(app);
        actions.setPadding(Ui.dp(app, 12), Ui.dp(app, 10), Ui.dp(app, 12), Ui.dp(app, 10));
        final String connect = s.isNull("connect") ? "" : s.optString("connect");
        TextView address = Ui.mono(app, connect, 12.5f, Ui.TEXT_2);
        if (!connect.isEmpty()) address.setOnClickListener(v -> Ui.copy(app, connect));
        actions.addView(address, Ui.weight(1));
        boolean canControl = Art.can(s, "control") && s.optBoolean("installed");
        if (canControl) {
            final boolean live = Ui.isOnline(status);
            TextView power = Ui.button(app, live ? "Stop" : "Start", live ? Ui.Kind.SECONDARY : Ui.Kind.PRIMARY);
            Ui.enable(power, live ? !"stopping".equals(status) : !jobRunning);
            power.setOnClickListener(v -> {
                Ui.enable(power, false);
                app.api.post("/api/servers/" + id + "/power", json("action", live ? "stop" : "start"), json -> view.postDelayed(this::load, 600), f -> {
                    Ui.enable(power, true);
                    app.failed(f);
                });
            });
            actions.addView(power, Ui.margins(app, Ui.lp(Ui.WRAP, Ui.dp(app, 36)), 8, 0, 0, 0));
        }
        card.addView(actions);
        return card;
    }

    private View stat(String label, String value) {
        LinearLayout c = Ui.column(app);
        TextView l = Ui.text(app, label.toUpperCase(Locale.US), 10.5f, Ui.MUTED, true);
        l.setLetterSpacing(0.06f);
        c.addView(l);
        c.addView(Ui.text(app, value, 14.5f, Ui.TEXT, true));
        return c;
    }
}

/** A game's picture and the small things every server view needs to read from the panel's answer. */
final class Art {
    private Art() {}

    /** The two colours behind a game's name, as on the panel, for when there's no cover picture. */
    static int[] colors(JSONObject s) {
        String t = s.optString("template");
        String game = s.optString("game");
        if (t.startsWith("ark")) return new int[] { 0xFF1F3B34, 0xFF4E3A24 };
        if (t.startsWith("cod")) return new int[] { 0xFF1C1F24, 0xFF6B5A2A };
        if (t.startsWith("wow")) return new int[] { 0xFF0B1D3A, 0xFF2A4F7A };
        if (game.equals("satisfactory")) return new int[] { 0xFF1D2430, 0xFFE08A2C };
        if (game.equals("sdtd")) return new int[] { 0xFF16120F, 0xFF7A2C1C };
        if (game.equals("valheim")) return new int[] { 0xFF0F1D22, 0xFF5F8A83 };
        if (game.equals("rust")) return new int[] { 0xFF1C1410, 0xFF9A4A22 };
        return new int[] { 0xFF3C7D2A, 0xFF5B3B22 };
    }

    static String label(JSONObject s, boolean small) {
        String game = s.optString("game");
        if (s.has("ark")) return "ARK";
        JSONObject cod = s.optJSONObject("cod");
        if (cod != null) return cod.optString("short", "CoD");
        if (s.has("wow")) return "WoW";
        if (game.equals("satisfactory")) return small ? "SF" : "Satisfactory";
        if (game.equals("sdtd")) return small ? "7D" : "7 Days";
        if (game.equals("valheim")) return small ? "VH" : "Valheim";
        if (game.equals("rust")) return "Rust";
        return "MC";
    }

    /** The game's cover picture with its name over it (the game's colours until the picture arrives). */
    static FrameLayout banner(MainActivity app, JSONObject s, int heightDp, float labelSp) {
        FrameLayout f = new FrameLayout(app);
        f.setBackground(new GradientDrawable(GradientDrawable.Orientation.TL_BR, colors(s)));
        JSONObject cover = s.optJSONObject("cover");
        if (cover != null && !cover.optString("url").isEmpty()) {
            ImageView picture = new ImageView(app);
            picture.setScaleType(ImageView.ScaleType.CENTER_CROP);
            f.addView(picture, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
            app.api.image(cover.optString("url"), picture);
            View shade = new View(app); // keeps the name and the status readable on any picture
            shade.setBackground(new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, new int[] { 0x33000000, 0x99000000 }));
            f.addView(shade, new FrameLayout.LayoutParams(Ui.MATCH, Ui.MATCH));
        }
        String text = label(s, heightDp < 80);
        TextView name = Ui.text(app, text, text.length() > 8 ? labelSp * 0.8f : labelSp, Color.WHITE, true);
        name.setLetterSpacing(0.08f);
        name.setShadowLayer(12, 0, 2, 0xCC000000);
        f.addView(name, new FrameLayout.LayoutParams(Ui.WRAP, Ui.WRAP, Gravity.CENTER));
        return f;
    }

    static boolean can(JSONObject s, String perm) {
        JSONArray perms = s.optJSONArray("perms");
        for (int i = 0; perms != null && i < perms.length(); i++) {
            String p = perms.optString(i);
            if (p.equals(perm) || p.equals("admin")) return true;
        }
        return false;
    }

    /** "3/50 +12 bots", or a dash when the game hasn't said. */
    static String players(JSONObject p, String sep) {
        if (p == null) return "—";
        String out = String.valueOf(p.optInt("online"));
        if (!p.isNull("max") && p.optInt("max") > 0) out += sep + p.optInt("max");
        if (p.optInt("bots") > 0) out += " +" + p.optInt("bots") + " bots";
        return out;
    }

    /** "stops in 7 min" for a running server nobody is on ("" when it won't be stopped). */
    static String stopsIn(JSONObject p) {
        if (p == null || p.isNull("stopsIn")) return "";
        int s = p.optInt("stopsIn");
        return s < 60 ? "stops in under a minute" : "stops in " + (int) Math.ceil(s / 60.0) + " min";
    }
}

/** A small line chart of the last few minutes (CPU, memory). */
final class Sparkline extends View {
    private final Paint line = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private double[] values = new double[0];
    private double top = 1;

    Sparkline(Context c) {
        super(c);
        line.setStyle(Paint.Style.STROKE);
        line.setStrokeWidth(Ui.dp(c, 2));
        line.setColor(Ui.ACCENT);
        line.setStrokeJoin(Paint.Join.ROUND);
        fill.setStyle(Paint.Style.FILL);
        fill.setColor(Ui.alpha(Ui.ACCENT, 0x22));
    }

    /** max: the top of the chart unless a value is higher. */
    void set(double[] values, double max) {
        this.values = values;
        double t = max;
        for (double v : values) t = Math.max(t, v);
        this.top = t <= 0 ? 1 : t;
        invalidate();
    }

    @Override
    protected void onDraw(Canvas canvas) {
        int n = values.length;
        float w = getWidth(), h = getHeight();
        if (n < 2 || w <= 0 || h <= 0) return;
        float pad = line.getStrokeWidth();
        path.reset();
        for (int i = 0; i < n; i++) {
            float x = i * w / (n - 1);
            float y = h - pad - (float) (values[i] / top) * (h - pad * 3);
            if (i == 0) path.moveTo(x, y);
            else path.lineTo(x, y);
        }
        Path area = new Path(path);
        area.lineTo(w, h);
        area.lineTo(0, h);
        area.close();
        canvas.drawPath(area, fill);
        canvas.drawPath(path, line);
    }
}
