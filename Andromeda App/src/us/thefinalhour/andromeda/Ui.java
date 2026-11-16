package us.thefinalhour.andromeda;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * The app's look, in one place: the same black canvas, hairline borders, white pill buttons and
 * blue accent as the panel and the Andromeda Services window. Everything is built from these.
 */
final class Ui {
    static final int BG = 0xFF000000;
    static final int SURFACE = 0xFF0D0F11;
    static final int SURFACE_HI = 0xFF16181C;
    static final int BORDER = 0xFF2F3336;
    static final int BORDER_HI = 0xFF3E4347;
    static final int TEXT = 0xFFE7E9EA;
    static final int TEXT_2 = 0xFFB1B6BB;
    static final int MUTED = 0xFF71767B;
    static final int ACCENT = 0xFF1D9BF0;
    static final int OK = 0xFF00BA7C;
    static final int WARN = 0xFFFFD400;
    static final int BAD = 0xFFF4212E;

    static final int MATCH = ViewGroup.LayoutParams.MATCH_PARENT;
    static final int WRAP = ViewGroup.LayoutParams.WRAP_CONTENT;

    enum Kind { PRIMARY, SECONDARY, DANGER, GHOST }

    private Ui() {}

    static int dp(Context c, float value) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, c.getResources().getDisplayMetrics()));
    }

    static int alpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (alpha << 24);
    }

    static GradientDrawable box(Context c, int fill, int stroke, float radiusDp) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(fill);
        d.setCornerRadius(dp(c, radiusDp));
        if (stroke != 0) d.setStroke(Math.max(1, dp(c, 1)), stroke);
        return d;
    }

    /** A background that also shows a ripple when pressed. */
    static Drawable pressable(Context c, int fill, int stroke, float radiusDp) {
        return new RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), box(c, fill, stroke, radiusDp), box(c, Color.WHITE, 0, radiusDp));
    }

    static TextView text(Context c, CharSequence s, float sp, int color, boolean bold) {
        TextView t = new TextView(c);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        t.setLineSpacing(0, 1.15f);
        return t;
    }

    static TextView title(Context c, CharSequence s) {
        TextView t = text(c, s, 26, TEXT, true);
        t.setLetterSpacing(-0.02f);
        return t;
    }

    /** One of the app's line icons (R.drawable.ic_*), in the given colour and size. */
    static android.widget.ImageView icon(Context c, int drawable, int color, float sizeDp) {
        android.widget.ImageView v = new android.widget.ImageView(c);
        v.setImageResource(drawable);
        v.setImageTintList(ColorStateList.valueOf(color));
        v.setLayoutParams(lp(dp(c, sizeDp), dp(c, sizeDp)));
        return v;
    }

    static TextView heading(Context c, CharSequence s) {
        return text(c, s, 16, TEXT, true);
    }

    static TextView body(Context c, CharSequence s) {
        return text(c, s, 14, TEXT, false);
    }

    static TextView muted(Context c, CharSequence s) {
        return text(c, s, 13, MUTED, false);
    }

    static TextView mono(Context c, CharSequence s, float sp, int color) {
        TextView t = text(c, s, sp, color, false);
        t.setTypeface(Typeface.MONOSPACE);
        return t;
    }

    /** The small spaced-out heading over a group: "ONLINE  2". */
    static TextView groupLabel(Context c, CharSequence s) {
        TextView t = text(c, s.toString().toUpperCase(), 11.5f, TEXT_2, true);
        t.setLetterSpacing(0.14f);
        return t;
    }

    static TextView button(Context c, CharSequence label, Kind kind) {
        TextView b = new TextView(c);
        b.setText(label);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        b.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(c, 18), 0, dp(c, 18), 0);
        b.setMinHeight(dp(c, 40));
        b.setMinWidth(dp(c, 64));
        b.setClickable(true);
        b.setFocusable(true);
        style(b, kind);
        return b;
    }

    static void style(TextView b, Kind kind) {
        Context c = b.getContext();
        switch (kind) {
            case PRIMARY:
                b.setTextColor(0xFF0F1419);
                b.setBackground(pressable(c, TEXT, 0, 99));
                break;
            case DANGER:
                b.setTextColor(0xFFFF5C66);
                b.setBackground(pressable(c, Color.TRANSPARENT, alpha(BAD, 0x99), 99));
                break;
            case GHOST:
                b.setTextColor(TEXT_2);
                b.setBackground(pressable(c, Color.TRANSPARENT, 0, 99));
                break;
            default:
                b.setTextColor(TEXT);
                b.setBackground(pressable(c, Color.TRANSPARENT, BORDER_HI, 99));
        }
    }

    static void enable(View v, boolean on) {
        v.setEnabled(on);
        v.setAlpha(on ? 1f : 0.4f);
    }

    /** "● Online": a status with its colour, outlined like on the panel. */
    static TextView pill(Context c, CharSequence label, int color) {
        TextView t = text(c, "●  " + label, 12, color, true);
        t.setPadding(dp(c, 10), dp(c, 3), dp(c, 10), dp(c, 3));
        t.setBackground(box(c, 0xB3000000, color, 99));
        t.setSingleLine(true);
        return t;
    }

    static void setPill(TextView pill, CharSequence label, int color) {
        pill.setText("●  " + label);
        pill.setTextColor(color);
        pill.setBackground(box(pill.getContext(), 0xB3000000, color, 99));
    }

    /** A small outlined tag: "default", "admin". */
    static TextView tag(Context c, CharSequence label, int color) {
        TextView t = text(c, label, 11, color, true);
        t.setPadding(dp(c, 7), dp(c, 1), dp(c, 7), dp(c, 1));
        t.setBackground(box(c, Color.TRANSPARENT, color == MUTED ? BORDER_HI : color, 99));
        t.setSingleLine(true);
        return t;
    }

    static LinearLayout column(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }

    static LinearLayout row(Context c) {
        LinearLayout l = new LinearLayout(c);
        l.setOrientation(LinearLayout.HORIZONTAL);
        l.setGravity(Gravity.CENTER_VERTICAL);
        return l;
    }

    /** A panel: black, hairline border, rounded corners, corner ticks. */
    static LinearLayout card(Context c) {
        LinearLayout l = column(c);
        l.setBackground(new PanelDrawable(c, BG, BORDER, 16));
        int p = dp(c, 16);
        l.setPadding(p, p, p, p);
        return l;
    }

    static LinearLayout.LayoutParams lp(int w, int h) {
        return new LinearLayout.LayoutParams(w, h);
    }

    static LinearLayout.LayoutParams weight(float weight) {
        return new LinearLayout.LayoutParams(0, WRAP, weight);
    }

    /** Layout params with margins given in dp. */
    static LinearLayout.LayoutParams margins(Context c, LinearLayout.LayoutParams p, float left, float top, float right, float bottom) {
        p.setMargins(dp(c, left), dp(c, top), dp(c, right), dp(c, bottom));
        return p;
    }

    static View gap(Context c, float heightDp) {
        View v = new View(c);
        v.setLayoutParams(lp(MATCH, dp(c, heightDp)));
        return v;
    }

    static View line(Context c) {
        View v = new View(c);
        v.setBackgroundColor(BORDER);
        v.setLayoutParams(lp(MATCH, Math.max(1, dp(c, 1) / 2)));
        return v;
    }

    static EditText input(Context c, String hint, int inputType) {
        EditText e = new EditText(c);
        e.setHint(hint);
        e.setHintTextColor(MUTED);
        e.setTextColor(TEXT);
        e.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        e.setInputType(inputType);
        e.setSingleLine((inputType & InputType.TYPE_TEXT_FLAG_MULTI_LINE) == 0);
        e.setBackground(box(c, BG, BORDER_HI, 10));
        e.setPadding(dp(c, 12), dp(c, 10), dp(c, 12), dp(c, 10));
        e.setMinHeight(dp(c, 44));
        return e;
    }

    static void toast(Context c, CharSequence message) {
        Toast.makeText(c, message, Toast.LENGTH_SHORT).show();
    }

    static void copy(Context c, String what) {
        ClipboardManager cm = (ClipboardManager) c.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null) return;
        cm.setPrimaryClip(ClipData.newPlainText("Andromeda", what));
        toast(c, "Copied");
    }

    // ---- numbers as people read them ----
    static String bytes(double n) {
        if (Double.isNaN(n) || n < 0) return "—";
        String[] units = { "B", "KB", "MB", "GB", "TB" };
        int i = 0;
        while (n >= 1024 && i < units.length - 1) {
            n /= 1024;
            i++;
        }
        return (i > 0 && n < 100 ? String.format(java.util.Locale.US, "%.1f", n) : String.valueOf(Math.round(n))) + " " + units[i];
    }

    static String duration(long ms) {
        long s = Math.max(0, ms / 1000);
        long d = s / 86400, h = (s % 86400) / 3600, m = (s % 3600) / 60;
        if (d > 0) return d + "d " + h + "h";
        if (h > 0) return h + "h " + m + "m";
        return m + "m " + (s % 60) + "s";
    }

    static String ago(long time) {
        if (time <= 0) return "never";
        long s = (System.currentTimeMillis() - time) / 1000;
        if (s < 60) return "just now";
        if (s < 3600) return (s / 60) + " min ago";
        if (s < 86400) return (s / 3600) + " h ago";
        return java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(new java.util.Date(time));
    }

    // ---- a server's status, as the panel words and colours it ----
    static String statusLabel(String status) {
        switch (status == null ? "" : status) {
            case "running": return "Online";
            case "starting": return "Starting";
            case "stopping": return "Stopping";
            case "installing": return "Installing";
            case "crashed": return "Crashed";
            default: return "Offline";
        }
    }

    static int statusColor(String status) {
        switch (status == null ? "" : status) {
            case "running": return OK;
            case "starting":
            case "stopping": return WARN;
            case "installing": return ACCENT;
            case "crashed": return BAD;
            default: return TEXT_2;
        }
    }

    static boolean isOnline(String status) {
        return "running".equals(status) || "starting".equals(status) || "stopping".equals(status);
    }
}
