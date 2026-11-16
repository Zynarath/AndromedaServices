package us.thefinalhour.andromeda;

import android.app.AlertDialog;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * A server's game settings, drawn from the same description the panel's Settings tab uses: one
 * section at a time, each setting with what it does and the control that fits it (a switch, a
 * slider with a number box, a list of choices). Sections open on the settings people change most;
 * "Show more" has the rest. Nothing is sent until Save.
 */
final class SettingsForm {
    final View view;
    private final MainActivity app;
    private final String id;
    private final LinearLayout list;
    private final TextView saveButton, saveNote;
    private JSONObject values;
    private final List<JSONObject> sections = new ArrayList<>();
    private final Map<String, Object> edits = new HashMap<>(); // key -> Boolean / String / JSONArray, only what was touched
    private final Set<Integer> openedAdvanced = new HashSet<>();
    private int current = 0;
    private boolean showMore, loaded, saving;

    interface Typed {
        void typed(String text);
    }

    interface Slid {
        void slid(int progress);
    }

    /** Tells when a text box was edited. */
    static final class After implements TextWatcher {
        private final Typed then;

        After(Typed then) {
            this.then = then;
        }

        @Override
        public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

        @Override
        public void onTextChanged(CharSequence s, int start, int before, int count) {}

        @Override
        public void afterTextChanged(Editable s) {
            then.typed(s.toString());
        }
    }

    static final class Slide implements SeekBar.OnSeekBarChangeListener {
        private final Slid then;

        Slide(Slid then) {
            this.then = then;
        }

        @Override
        public void onProgressChanged(SeekBar bar, int progress, boolean fromUser) {
            if (fromUser) then.slid(progress);
        }

        @Override
        public void onStartTrackingTouch(SeekBar bar) {}

        @Override
        public void onStopTrackingTouch(SeekBar bar) {}
    }

    SettingsForm(MainActivity app, String id) {
        this.app = app;
        this.id = id;
        LinearLayout root = Ui.column(app);
        ScrollView scroll = new ScrollView(app);
        list = Ui.column(app);
        int p = Ui.dp(app, 16);
        list.setPadding(p, p, p, Ui.dp(app, 20));
        list.addView(Ui.muted(app, "Loading…"));
        scroll.addView(list);
        root.addView(scroll, new LinearLayout.LayoutParams(Ui.MATCH, 0, 1f));
        root.addView(Ui.line(app));
        LinearLayout bar = Ui.row(app);
        bar.setPadding(p, Ui.dp(app, 10), p, Ui.dp(app, 10));
        saveButton = Ui.button(app, "Save game settings", Ui.Kind.PRIMARY);
        saveButton.setOnClickListener(v -> save());
        bar.addView(saveButton, Ui.lp(Ui.WRAP, Ui.dp(app, 42)));
        saveNote = Ui.text(app, "", 12.5f, Ui.MUTED, false);
        bar.addView(saveNote, Ui.margins(app, Ui.weight(1), 12, 0, 0, 0));
        root.addView(bar);
        view = root;
    }

    /** Fetches the settings once; coming back to the tab keeps what you were editing. */
    void load() {
        if (loaded) return;
        app.api.get("/api/servers/" + id + "/settings", json -> {
            loaded = true;
            values = json.optJSONObject("values");
            if (values == null) values = new JSONObject();
            sections.clear();
            JSONObject schema = json.optJSONObject("schema");
            JSONArray all = schema == null ? null : schema.optJSONArray("sections");
            for (int i = 0; all != null && i < all.length(); i++) {
                JSONObject sec = all.optJSONObject(i);
                if (sec != null && !fields(sec).isEmpty()) sections.add(sec);
            }
            draw();
        }, app::failed);
    }

    /** True when it asked whether to throw edits away instead of leaving straight off. */
    boolean back() {
        if (dirty() == 0) return false;
        new AlertDialog.Builder(app, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Leave without saving?")
            .setMessage(dirty() + " changed setting" + (dirty() == 1 ? " is" : "s are") + " not saved yet.")
            .setNegativeButton("Keep editing", null)
            .setPositiveButton("Leave", (d, w) -> {
                edits.clear();
                app.setOver(null);
            })
            .show();
        return true;
    }

    // ---------- the description ----------

    /** A section's settings, without the ones only admins may change when you aren't one. */
    private List<JSONObject> fields(JSONObject section) {
        List<JSONObject> out = new ArrayList<>();
        JSONArray fs = section.optJSONArray("fields");
        for (int i = 0; fs != null && i < fs.length(); i++) {
            JSONObject f = fs.optJSONObject(i);
            if (f != null && (app.isAdmin() || !f.optBoolean("admin"))) out.add(f);
        }
        return out;
    }

    private static String name(JSONObject section) {
        return section.has("short") ? section.optString("short") : section.optString("title");
    }

    private Object now(String key) {
        return edits.containsKey(key) ? edits.get(key) : values.opt(key);
    }

    private static String text(Object v) {
        return v == null || v == JSONObject.NULL ? "" : String.valueOf(v);
    }

    private static boolean truthy(Object v) {
        return Boolean.TRUE.equals(v) || "true".equals(String.valueOf(v));
    }

    /** A section that belongs to one choice of another setting (one game mode's rules) shows only then. */
    private boolean applies(JSONObject section) {
        JSONObject when = section.optJSONObject("showIf");
        return when == null || text(now(when.optString("key"))).equals(when.optString("value"));
    }

    private int dirty() {
        int n = 0;
        for (Map.Entry<String, Object> e : edits.entrySet()) {
            Object was = values.opt(e.getKey());
            Object is = e.getValue();
            boolean same = is instanceof Boolean ? truthy(was) == (Boolean) is : sameText(text(was), text(is));
            if (!same) n++;
        }
        return n;
    }

    private static boolean sameText(String a, String b) {
        if (a.equals(b)) return true;
        try {
            return !a.isEmpty() && !b.isEmpty() && Double.parseDouble(a) == Double.parseDouble(b);
        } catch (NumberFormatException e) {
            return false;
        }
    }

    private void touched() {
        int n = dirty();
        saveNote.setText(n == 0 ? "Changes apply on the next (re)start." : n + " unsaved change" + (n == 1 ? "" : "s"));
        saveNote.setTextColor(n == 0 ? Ui.MUTED : Ui.ACCENT);
    }

    // ---------- drawing ----------

    private void draw() {
        list.removeAllViews();
        touched();
        if (sections.isEmpty()) {
            list.addView(Ui.muted(app, "This server has no settings to change here."));
            return;
        }
        if (current >= sections.size() || !applies(sections.get(current))) current = 0;
        final JSONObject section = sections.get(current);
        boolean advanced = section.optBoolean("advanced");
        if (advanced) openedAdvanced.add(current);

        TextView picker = Ui.button(app, name(section) + "   ▾", Ui.Kind.SECONDARY);
        picker.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        picker.setOnClickListener(v -> pickSection());
        list.addView(Ui.groupLabel(app, "Section"), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 2, 0, 0, 6));
        list.addView(picker, Ui.lp(Ui.MATCH, Ui.dp(app, 46)));
        String blurb = !section.isNull("blurb") && !section.optString("blurb").isEmpty() ? section.optString("blurb") : advanced ? "Every other option in this part of " + section.optString("file") + ", as the file itself describes it. Leave a box as it is to keep the file unchanged." : "";
        if (!blurb.isEmpty()) list.addView(Ui.text(app, blurb, 13.5f, Ui.TEXT_2, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 2, 10, 2, 0));

        JSONObject presets = section.optJSONObject("presets");
        JSONArray choices = presets == null ? null : presets.optJSONArray("choices");
        if (choices != null && choices.length() > 0) {
            list.addView(Ui.groupLabel(app, presets.optString("label")), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 2, 16, 0, 6));
            LinearLayout row = Ui.row(app);
            android.widget.HorizontalScrollView scroller = new android.widget.HorizontalScrollView(app);
            scroller.setHorizontalScrollBarEnabled(false);
            for (int i = 0; i < choices.length(); i++) {
                final JSONObject choice = choices.optJSONObject(i);
                if (choice == null) continue;
                TextView b = Ui.button(app, choice.optString("label"), Ui.Kind.SECONDARY);
                b.setTextSize(13);
                b.setOnClickListener(v -> {
                    JSONObject set = choice.optJSONObject("values");
                    JSONArray keys = set == null ? null : set.names();
                    for (int k = 0; keys != null && k < keys.length(); k++) edits.put(keys.optString(k), text(set.opt(keys.optString(k))));
                    draw();
                });
                row.addView(b, Ui.margins(app, Ui.lp(Ui.WRAP, Ui.dp(app, 36)), 0, 0, 8, 0));
            }
            scroller.addView(row);
            list.addView(scroller);
        }

        List<JSONObject> fs = fields(section);
        int kept = 0;
        LinearLayout rows = Ui.card(app);
        rows.setPadding(0, Ui.dp(app, 4), 0, Ui.dp(app, 4));
        boolean first = true;
        for (JSONObject f : fs) {
            boolean later = !advanced && !f.optBoolean("common", true) && !edits.containsKey(f.optString("key"));
            if (later && !showMore) {
                kept++;
                continue;
            }
            if (!first) rows.addView(Ui.line(app));
            first = false;
            rows.addView(row(f));
        }
        list.addView(rows, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 16, 0, 0));
        if (kept > 0 || showMore) {
            final int more = kept;
            boolean any = false;
            for (JSONObject f : fs) if (!f.optBoolean("common", true)) any = true;
            if (any && !advanced) {
                TextView toggle = Ui.button(app, showMore ? "Show fewer settings" : "Show " + more + " more setting" + (more == 1 ? "" : "s"), Ui.Kind.GHOST);
                toggle.setBackground(Ui.pressable(app, 0, Ui.BORDER_HI, 12));
                toggle.setOnClickListener(v -> {
                    showMore = !showMore;
                    draw();
                });
                list.addView(toggle, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.dp(app, 44)), 0, 10, 0, 0));
            }
        }
    }

    private void pickSection() {
        final List<Integer> shown = new ArrayList<>();
        List<String> names = new ArrayList<>();
        for (int i = 0; i < sections.size(); i++) {
            JSONObject sec = sections.get(i);
            if (!applies(sec)) continue;
            shown.add(i);
            names.add((sec.optBoolean("advanced") ? "All options · " : "") + name(sec) + "  (" + fields(sec).size() + ")");
        }
        new AlertDialog.Builder(app, android.R.style.Theme_Material_Dialog_Alert)
            .setTitle("Section")
            .setSingleChoiceItems(names.toArray(new String[0]), shown.indexOf(current), (d, which) -> {
                current = shown.get(which);
                showMore = false;
                d.dismiss();
                draw();
                ((ScrollView) list.getParent()).scrollTo(0, 0);
            })
            .setNegativeButton("Cancel", null)
            .show();
    }

    /** { value, label } pairs from a setting's "options" (which are plain strings or pairs). */
    private static List<String[]> options(JSONObject f, String currentValue) {
        List<String[]> out = new ArrayList<>();
        if (f.optString("key").equals("panel.javaMajor")) out.add(new String[] { "", "Automatic" });
        JSONArray opts = f.optJSONArray("options");
        boolean has = false;
        for (int i = 0; opts != null && i < opts.length(); i++) {
            JSONObject o = opts.optJSONObject(i);
            String value = o == null ? opts.optString(i) : text(o.opt("value"));
            String label = o == null ? opts.optString(i) : o.optString("label", value);
            out.add(new String[] { value, label });
            if (value.equals(currentValue)) has = true;
        }
        if (!has && !currentValue.isEmpty()) out.add(new String[] { currentValue, currentValue });
        return out;
    }

    private static String unit(String u) {
        switch (u) {
            case "s": return "sec";
            case "min": return "min";
            case "h": return "hours";
            case "yd": return "yards";
            default: return u;
        }
    }

    private static String number(double v) {
        if (v == Math.rint(v) && Math.abs(v) < 1e15) return String.valueOf((long) v);
        return String.valueOf(Math.round(v * 1e6) / 1e6);
    }

    private View row(final JSONObject f) {
        final String key = f.optString("key");
        String type = f.optString("type", "text");
        LinearLayout row = Ui.column(app);
        int p = Ui.dp(app, 14);
        row.setPadding(p, Ui.dp(app, 12), p, Ui.dp(app, 12));
        String hint = f.isNull("hint") ? "" : f.optString("hint");
        String def = f.isNull("def") ? "" : text(f.opt("def"));

        if (type.equals("bool")) {
            final Switch sw = new Switch(app);
            sw.setText(f.optString("label"));
            sw.setTextColor(Ui.TEXT);
            sw.setTextSize(15);
            sw.setTypeface(sw.getTypeface(), android.graphics.Typeface.BOLD);
            sw.setChecked(truthy(now(key)));
            sw.setOnCheckedChangeListener((b, on) -> {
                edits.put(key, on);
                touched();
            });
            row.addView(sw, Ui.lp(Ui.MATCH, Ui.WRAP));
            if (!hint.isEmpty()) row.addView(Ui.text(app, hint, 13, Ui.TEXT_2, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 2, 44, 0));
            return row;
        }

        row.addView(Ui.text(app, f.optString("label"), 15, Ui.TEXT, true));
        if (!hint.isEmpty()) row.addView(Ui.text(app, hint, 13, Ui.TEXT_2, false), Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 2, 0, 0));

        if (type.equals("select")) {
            final List<String[]> opts = options(f, text(now(key)));
            final TextView pick = Ui.button(app, "", Ui.Kind.SECONDARY);
            pick.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
            pick.setBackground(Ui.pressable(app, 0, Ui.BORDER_HI, 10));
            final Runnable label = () -> {
                String v = text(now(key));
                String shown = v;
                for (String[] o : opts) if (o[0].equals(v)) shown = o[1];
                pick.setText(shown + "   ▾");
            };
            label.run();
            pick.setOnClickListener(v -> {
                String[] labels = new String[opts.size()];
                int at = -1;
                for (int i = 0; i < opts.size(); i++) {
                    labels[i] = opts.get(i)[1];
                    if (opts.get(i)[0].equals(text(now(key)))) at = i;
                }
                new AlertDialog.Builder(app, android.R.style.Theme_Material_Dialog_Alert).setTitle(f.optString("label")).setSingleChoiceItems(labels, at, (d, which) -> {
                    edits.put(key, opts.get(which)[0]);
                    d.dismiss();
                    label.run();
                    touched();
                    for (JSONObject sec : sections) { // another section may depend on this choice
                        JSONObject when = sec.optJSONObject("showIf");
                        if (when != null && when.optString("key").equals(key)) {
                            draw();
                            break;
                        }
                    }
                }).setNegativeButton("Cancel", null).show();
            });
            row.addView(pick, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.dp(app, 44)), 0, 8, 0, 0));
            return row;
        }

        if (type.equals("checklist") || type.equals("maps")) {
            final List<String[]> opts = options(f, "");
            final TextView pick = Ui.button(app, "", Ui.Kind.SECONDARY);
            pick.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
            pick.setBackground(Ui.pressable(app, 0, Ui.BORDER_HI, 10));
            final Runnable label = () -> {
                Object v = now(key);
                int n = v instanceof JSONArray ? ((JSONArray) v).length() : 0;
                pick.setText(n + " of " + opts.size() + " picked   ▾");
            };
            label.run();
            pick.setOnClickListener(v -> {
                final boolean[] on = new boolean[opts.size()];
                String[] labels = new String[opts.size()];
                Object have = now(key);
                Set<String> picked = new HashSet<>();
                for (int i = 0; have instanceof JSONArray && i < ((JSONArray) have).length(); i++) picked.add(((JSONArray) have).optString(i));
                for (int i = 0; i < opts.size(); i++) {
                    labels[i] = opts.get(i)[1];
                    on[i] = picked.contains(opts.get(i)[0]);
                }
                new AlertDialog.Builder(app, android.R.style.Theme_Material_Dialog_Alert).setTitle(f.optString("label")).setMultiChoiceItems(labels, on, (d, which, checked) -> on[which] = checked).setNegativeButton("Cancel", null).setPositiveButton("Done", (d, w) -> {
                    JSONArray out = new JSONArray();
                    for (int i = 0; i < on.length; i++) if (on[i]) out.put(opts.get(i)[0]);
                    edits.put(key, out);
                    label.run();
                    touched();
                }).show();
            });
            row.addView(pick, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.dp(app, 44)), 0, 8, 0, 0));
            return row;
        }

        boolean numeric = type.equals("number");
        boolean multi = type.equals("textarea");
        int input = numeric ? InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL | InputType.TYPE_NUMBER_FLAG_SIGNED
            : multi ? InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            : InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS;
        final EditText box = Ui.input(app, def.isEmpty() ? "" : (numeric ? def : "Default: " + def), input);
        box.setText(text(now(key)));
        if (multi) box.setMinLines(3);

        final JSONObject slider = numeric ? f.optJSONObject("slider") : null;
        if (slider == null) {
            box.addTextChangedListener(new After(t -> {
                edits.put(key, t);
                touched();
            }));
            if (numeric && !f.isNull("unit") && !f.optString("unit").isEmpty()) {
                LinearLayout line = Ui.row(app);
                line.addView(box, Ui.weight(1));
                line.addView(Ui.muted(app, unit(f.optString("unit"))), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 10, 0, 0, 0));
                row.addView(line, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 8, 0, 0));
            } else row.addView(box, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 8, 0, 0));
            return row;
        }

        // A slider for the handy range, with the number box next to it for any other value.
        final double step = Math.max(1e-6, slider.optDouble("step", 1));
        final double min = Math.floor(slider.optDouble("min", 0) / step + 1e-9) * step;
        final double max = Math.max(min + step, slider.optDouble("max", 100));
        final SeekBar bar = new SeekBar(app);
        bar.setMax((int) Math.round((max - min) / step));
        final boolean[] quiet = { false }; // the slider and the box set each other: don't echo
        final Runnable place = () -> {
            try {
                double v = Double.parseDouble(box.getText().toString().isEmpty() ? (f.isNull("def") ? "0" : text(f.opt("def"))) : box.getText().toString());
                bar.setProgress((int) Math.round((Math.max(min, Math.min(max, v)) - min) / step));
            } catch (NumberFormatException e) {
                // half-typed number: the slider waits
            }
        };
        place.run();
        bar.setOnSeekBarChangeListener(new Slide(progress -> {
            double v = min + progress * step;
            if (!f.isNull("min")) v = Math.max(v, f.optDouble("min"));
            quiet[0] = true;
            box.setText(number(v));
            quiet[0] = false;
            edits.put(key, number(v));
            touched();
        }));
        box.addTextChangedListener(new After(t -> {
            if (quiet[0]) return;
            edits.put(key, t);
            place.run();
            touched();
        }));
        box.setGravity(Gravity.END | Gravity.CENTER_VERTICAL);
        LinearLayout line = Ui.row(app);
        line.addView(bar, Ui.weight(1));
        line.addView(box, Ui.margins(app, Ui.lp(Ui.dp(app, 92), Ui.WRAP), 6, 0, 0, 0));
        if (!f.isNull("unit") && !f.optString("unit").isEmpty()) line.addView(Ui.muted(app, unit(f.optString("unit"))), Ui.margins(app, Ui.lp(Ui.WRAP, Ui.WRAP), 8, 0, 0, 0));
        row.addView(line, Ui.margins(app, Ui.lp(Ui.MATCH, Ui.WRAP), 0, 8, 0, 0));
        return row;
    }

    // ---------- saving ----------

    private void save() {
        if (saving || !loaded) return;
        JSONObject out = new JSONObject();
        try {
            // What the panel's own page sends: every setting of the sections it has drawn.
            for (int i = 0; i < sections.size(); i++) {
                JSONObject sec = sections.get(i);
                if (sec.optBoolean("advanced") && !openedAdvanced.contains(i)) continue;
                for (JSONObject f : fields(sec)) {
                    String key = f.optString("key");
                    String type = f.optString("type", "text");
                    Object v = now(key);
                    if (type.equals("bool")) out.put(key, truthy(v));
                    else if (type.equals("checklist") || type.equals("maps")) out.put(key, v instanceof JSONArray ? v : new JSONArray());
                    else if (type.equals("number")) {
                        String t = text(v).trim();
                        if (t.isEmpty()) out.put(key, "");
                        else {
                            try {
                                out.put(key, Double.parseDouble(t));
                            } catch (NumberFormatException e) {
                                Ui.toast(app, f.optString("label") + ": \"" + t + "\" is not a number");
                                return;
                            }
                        }
                    } else out.put(key, text(v));
                }
            }
        } catch (JSONException e) {
            Ui.toast(app, "Couldn't put the settings together: " + e.getMessage());
            return;
        }
        saving = true;
        saveButton.setText("Saving…");
        Ui.enable(saveButton, false);
        app.api.put("/api/servers/" + id + "/settings", Screen.json("values", out), json -> {
            done();
            JSONObject fresh = json.optJSONObject("values");
            if (fresh != null) values = fresh;
            edits.clear();
            draw();
            String warning = json.isNull("warning") ? "" : json.optString("warning");
            Ui.toast(app, !warning.isEmpty() ? warning : json.optBoolean("restartRequired") ? "Saved — restart the server to apply" : "Saved");
        }, f -> {
            done();
            app.failed(f);
        });
    }

    private void done() {
        saving = false;
        saveButton.setText("Save game settings");
        Ui.enable(saveButton, true);
    }
}
