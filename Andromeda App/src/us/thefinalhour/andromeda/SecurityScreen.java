package us.thefinalhour.andromeda;

import android.view.Gravity;
import android.view.View;
import android.widget.HorizontalScrollView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Security: who is connecting to the panel and who is trying things they shouldn't, from the
 * record the panel keeps. At the top, how things look right now and the last 24 hours in numbers
 * and hour by hour; below, the attempts and warnings, who is signed in, the addresses that
 * connected (the troublesome ones first) and everything that happened, newest first.
 */
final class SecurityScreen extends Screen {
    private static final String[] VIEWS = { "Attempts", "Signed in", "Addresses", "Everything" };
    private final LinearLayout page;
    private int showing = 0;
    private JSONObject data;
    private String drawn = "";

    SecurityScreen(MainActivity app) {
        super(app);
        page = scrollingPage();
        page.addView(Ui.title(app, "Security"));
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
        app.api.get("/api/security?limit=120", json -> {
            data = json;
            draw();
        }, f -> {
            if (f.status == 404) {
                data = null;
                drawn = "old";
                page.removeAllViews();
                page.addView(Ui.title(app, "Security"));
                note("The panel on the PC is older than this app", "Update it (Check for updates in Andromeda Services). The security record starts with Andromeda Hosting 2.5.0.");
            } else if (!f.offline()) app.failed(f);
        });
    }

    private void note(String title, String text) {
        LinearLayout card = Ui.card(app);
        card.addView(Ui.heading(app, title));
        card.addView(Ui.text(app, text, 14, Ui.TEXT_2, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 6, 0, 0));
        page.addView(card, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 0));
    }

    private static int color(String severity) {
        return "threat".equals(severity) ? Ui.BAD : "warn".equals(severity) ? Ui.WARN : Ui.TEXT_2;
    }

    private static String plural(int n, String one) {
        return n + " " + one + (n == 1 ? "" : "s");
    }

    private void draw() {
        if (data == null) return;
        JSONObject sum = data.optJSONObject("summary");
        if (sum == null) return;
        app.securityLevel(sum.optString("level"));
        // Times ("3 min ago") move on without anything having happened: they don't count as a change.
        String now = showing + data.toString().replaceAll("\"(t|last|since)\":\\d+", "");
        if (now.equals(drawn)) return;
        drawn = now;
        page.removeAllViews();
        page.addView(Ui.title(app, "Security"));
        page.addView(Ui.muted(app, "Who is connecting to your panel, and who is trying things they shouldn't"));

        // How things look right now.
        String level = sum.optString("level");
        int tone = level.equals("alert") ? Ui.BAD : level.equals("watch") ? Ui.WARN : Ui.OK;
        int failed = sum.optInt("failed"), lockouts = sum.optInt("lockouts"), probes = sum.optInt("probes"), refused = sum.optInt("refused");
        LinearLayout banner = Ui.card(app);
        banner.setBackground(new PanelDrawable(app, Ui.BG, Ui.alpha(tone, 0xA0), 16));
        LinearLayout head = Ui.row(app);
        head.addView(Ui.icon(app, level.equals("quiet") ? R.drawable.ic_shield : R.drawable.ic_alert, tone, 26));
        LinearLayout words = Ui.column(app);
        words.addView(Ui.text(app, level.equals("alert") ? "Alert" : level.equals("watch") ? "Worth a look" : "All quiet", 20, tone, true));
        words.addView(Ui.text(app, level.equals("quiet") ? "Nobody has tried anything in the last 24 hours."
            : (lockouts > 0 ? "Someone was locked out after repeated failed sign-ins. " : "") + "In the last 24 hours: " + plural(failed, "failed sign-in") + ", " + plural(probes, "probe") + ", " + plural(refused, "refused request") + ".", 13.5f, Ui.TEXT_2, false));
        head.addView(words, Ui.margins(app, Ui.weight(1), 12, 0, 0, 0));
        banner.addView(head);
        page.addView(banner, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 14, 0, 0));

        // The last 24 hours in numbers.
        JSONArray sessions = data.optJSONArray("sessions");
        LinearLayout a = Ui.row(app), b = Ui.row(app);
        a.addView(tile(R.drawable.ic_globe, "Addresses", sum.optInt("addresses"), sum.optInt("outside") + " from outside", Ui.TEXT), cell(0));
        a.addView(tile(R.drawable.ic_key, "Failed sign-ins", failed, plural(lockouts, "lock-out"), failed > 0 ? Ui.WARN : Ui.TEXT), cell(1));
        a.addView(tile(R.drawable.ic_alert, "Probes", probes, plural(refused, "refused request"), probes > 0 ? Ui.BAD : Ui.TEXT), cell(2));
        b.addView(tile(R.drawable.ic_users, "Signed in now", sessions == null ? 0 : sessions.length(), plural(sum.optInt("signins"), "sign-in") + " today", Ui.TEXT), cell(0));
        b.addView(tile(R.drawable.ic_activity, "Requests", sum.optInt("requests"), "in 24 hours", Ui.TEXT), cell(1));
        b.addView(tile(R.drawable.ic_server, "Players joined", sum.optInt("players"), "game servers", Ui.TEXT), cell(2));
        page.addView(a, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 12, 0, 0));
        page.addView(b, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 8, 0, 0));

        // Hour by hour.
        JSONArray hourly = sum.optJSONArray("hourly");
        if (hourly != null && hourly.length() > 0) {
            LinearLayout chart = Ui.card(app);
            LinearLayout top = Ui.row(app);
            top.addView(Ui.heading(app, "Last 24 hours"), Ui.weight(1));
            top.addView(Ui.text(app, "●", 10, Ui.BAD, false));
            top.addView(Ui.text(app, " attempts   ", 12, Ui.MUTED, false));
            top.addView(Ui.text(app, "●", 10, Ui.ACCENT, false));
            top.addView(Ui.text(app, " requests", 12, Ui.MUTED, false));
            chart.addView(top);
            int n = hourly.length();
            double[] heights = new double[n];
            int[] colors = new int[n];
            for (int i = 0; i < n; i++) {
                JSONObject h = hourly.optJSONObject(i);
                int threats = h == null ? 0 : h.optInt("threats"), warns = h == null ? 0 : h.optInt("warns");
                heights[i] = h == null ? 0 : Math.sqrt(h.optInt("requests")); // a busy hour shouldn't flatten the others
                colors[i] = threats > 0 ? Ui.BAD : warns > 0 ? Ui.WARN : Ui.alpha(Ui.ACCENT, 0xB0);
            }
            Bars bars = new Bars(app);
            bars.set(heights, colors);
            chart.addView(bars, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.dp(app, 64)), 0, 12, 0, 6));
            LinearLayout ends = Ui.row(app);
            ends.addView(Ui.text(app, "24 h ago", 11.5f, Ui.MUTED, false), Ui.weight(1));
            ends.addView(Ui.text(app, "now", 11.5f, Ui.MUTED, false));
            chart.addView(ends);
            page.addView(chart, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 12, 0, 0));
        }

        // Which list to show.
        HorizontalScrollView scroller = new HorizontalScrollView(app);
        scroller.setHorizontalScrollBarEnabled(false);
        LinearLayout picker = Ui.row(app);
        picker.setBackground(Ui.box(app, Ui.BG, Ui.BORDER_HI, 14));
        picker.setPadding(Ui.dp(app, 3), Ui.dp(app, 3), Ui.dp(app, 3), Ui.dp(app, 3));
        JSONArray threats = data.optJSONArray("threats");
        int[] counts = { threats == null ? 0 : threats.length(), sessions == null ? 0 : sessions.length(), sum.optInt("addresses"), -1 };
        for (int i = 0; i < VIEWS.length; i++) {
            final int index = i;
            boolean on = i == showing;
            TextView t = Ui.text(app, VIEWS[i] + (counts[i] >= 0 ? "  " + counts[i] : ""), 13, on ? 0xFF0F1419 : Ui.TEXT_2, true);
            t.setGravity(Gravity.CENTER);
            t.setPadding(Ui.dp(app, 13), 0, Ui.dp(app, 13), 0);
            t.setBackground(on ? Ui.box(app, Ui.TEXT, 0, 11) : null);
            t.setOnClickListener(v -> {
                showing = index;
                draw();
            });
            picker.addView(t, Ui.lp(Ui.WRAP, Ui.dp(app, 34)));
        }
        scroller.addView(picker);
        page.addView(scroller, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 18, 0, 10));

        LinearLayout list = Ui.card(app);
        list.setPadding(0, Ui.dp(app, 2), 0, Ui.dp(app, 2));
        if (showing == 0) events(list, threats, "Nothing. Nobody has tried anything.");
        else if (showing == 3) events(list, data.optJSONArray("events"), "Nothing has happened yet.");
        else if (showing == 1) {
            if (sessions == null || sessions.length() == 0) empty(list, "Nobody is signed in.");
            for (int i = 0; sessions != null && i < sessions.length(); i++) {
                JSONObject s = sessions.optJSONObject(i);
                if (s == null) continue;
                row(list, i > 0, Ui.OK, s.optString("user") + ("admin".equals(s.optString("role")) ? "  (admin)" : ""), s.optString("ip"), device(s.optString("ua")), "active " + Ui.ago(s.optLong("last")));
            }
        } else {
            JSONArray addresses = data.optJSONArray("addresses");
            if (addresses == null || addresses.length() == 0) empty(list, "Nobody has connected yet.");
            for (int i = 0; addresses != null && i < addresses.length() && i < 60; i++) {
                JSONObject c = addresses.optJSONObject(i);
                if (c == null) continue;
                int t = c.optInt("threats"), f = c.optInt("failures");
                String who = c.optString("ip") + (c.optString("country").isEmpty() ? "" : "  " + c.optString("country")) + (c.optString("local").isEmpty() ? "" : "  (" + c.optString("local") + ")");
                String did = plural(c.optInt("requests"), "request") + (f > 0 ? " · " + plural(f, "failed sign-in") : "") + (t > 0 ? " · " + plural(t, "attempt") : "") + (c.optString("user").isEmpty() ? "" : " · signed in as " + c.optString("user"));
                row(list, i > 0, t > 0 ? Ui.BAD : f > 0 ? Ui.WARN : Ui.MUTED, who, did, device(c.optString("ua")), Ui.ago(c.optLong("last")));
            }
        }
        page.addView(list, Ui.lp(Ui.MATCH, Ui.WRAP));
        page.addView(Ui.muted(app, "The panel keeps this record while it runs. Sign-ins are limited to 8 tries per address every 15 minutes; this page shows who ran into that. Nothing is blocked beyond that."), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 4, 12, 4, 0));
    }

    private LinearLayout.LayoutParams cell(int index) {
        return Ui.margins(app, new LinearLayout.LayoutParams(0, Ui.MATCH, 1f), index == 0 ? 0 : 4, 0, index == 2 ? 0 : 4, 0);
    }

    private View tile(int icon, String label, int value, String note, int valueColor) {
        LinearLayout t = Ui.card(app);
        int p = Ui.dp(app, 12);
        t.setPadding(p, p, p, p);
        t.addView(Ui.icon(app, icon, Ui.MUTED, 16));
        t.addView(Ui.text(app, String.valueOf(value), 22, valueColor, true), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 0, 4, 0, 0));
        t.addView(Ui.text(app, label, 12.5f, Ui.TEXT_2, true));
        t.addView(Ui.text(app, note, 11.5f, Ui.MUTED, false));
        return t;
    }

    private void empty(LinearLayout into, String text) {
        TextView t = Ui.text(app, text, 14, Ui.OK, false);
        t.setPadding(Ui.dp(app, 14), Ui.dp(app, 14), Ui.dp(app, 14), Ui.dp(app, 14));
        into.addView(t);
    }

    private void events(LinearLayout into, JSONArray list, String none) {
        if (list == null || list.length() == 0) {
            empty(into, none);
            return;
        }
        for (int i = 0; i < list.length() && i < 80; i++) {
            JSONObject e = list.optJSONObject(i);
            if (e == null) continue;
            String from = e.optString("ip") + (e.optString("country").isEmpty() ? "" : "  " + e.optString("country")) + (e.optString("local").isEmpty() ? "" : "  (" + e.optString("local") + ")");
            if (from.trim().isEmpty()) from = e.optString("where");
            String detail = (e.optString("user").isEmpty() || e.optString("detail").contains(e.optString("user")) ? "" : e.optString("user") + " · ") + e.optString("detail");
            row(into, i > 0, color(e.optString("severity")), e.optString("title") + (e.optInt("count", 1) > 1 ? "  ×" + e.optInt("count") : ""), from, detail, Ui.ago(e.optLong("t")));
        }
    }

    /** One line of a list: a coloured dot, what it is, where from, the detail, and when. */
    private void row(LinearLayout into, boolean divider, int dot, String title, String from, String detail, String when) {
        if (divider) into.addView(Ui.line(app));
        LinearLayout row = Ui.row(app);
        row.setGravity(Gravity.TOP);
        row.setPadding(Ui.dp(app, 14), Ui.dp(app, 11), Ui.dp(app, 14), Ui.dp(app, 11));
        TextView mark = Ui.text(app, "●", 11, dot, false);
        row.addView(mark, Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 0, 3, 10, 0));
        LinearLayout text = Ui.column(app);
        LinearLayout top = Ui.row(app);
        top.addView(Ui.text(app, title, 14.5f, dot == Ui.MUTED || dot == Ui.TEXT_2 || dot == Ui.OK ? Ui.TEXT : dot, true), Ui.weight(1));
        top.addView(Ui.text(app, when, 12, Ui.MUTED, false), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 8, 0, 0, 0));
        text.addView(top);
        if (!from.trim().isEmpty()) text.addView(Ui.mono(app, from, 12.5f, Ui.TEXT_2));
        if (!detail.trim().isEmpty()) text.addView(Ui.text(app, detail, 13, Ui.MUTED, false));
        row.addView(text, Ui.weight(1));
        into.addView(row);
    }

    /** "Chrome on Windows" from a browser's long description of itself; the start of it otherwise. */
    private static String device(String ua) {
        if (ua == null || ua.isEmpty()) return "";
        String on = ua.contains("Android") ? "Android" : ua.contains("iPhone") || ua.contains("iPad") ? "iOS" : ua.contains("Windows") ? "Windows" : ua.contains("Mac OS") ? "Mac" : ua.contains("Linux") ? "Linux" : "";
        String what = ua.contains("; wv)") ? "Andromeda app" : ua.contains("Edg/") ? "Edge" : ua.contains("Firefox/") ? "Firefox" : ua.contains("Chrome/") ? "Chrome" : ua.contains("Safari/") ? "Safari" : "";
        if (what.isEmpty()) return ua.length() > 48 ? ua.substring(0, 47) + "…" : ua;
        return on.isEmpty() ? what : what + " on " + on;
    }
}
