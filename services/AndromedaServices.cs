// Andromeda Services: a Windows app that starts and stops Andromeda Hosting (the panel) and the
// WotLK website, shows their logs, installs updates, and sits in the system tray, so nothing needs
// a console window.
//
// Built by services\build.bat with the C# compiler that ships with Windows (.NET Framework 4), so
// it is written for C# 5 (no string interpolation, no ?. operator). install.exe (Installer.cs) is
// compiled together with this file to share its look, with INSTALLER defined.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

#if !INSTALLER
[assembly: AssemblyTitle("Andromeda Services")]
[assembly: AssemblyProduct("Andromeda Services")]
[assembly: AssemblyDescription("Starts and stops Andromeda Hosting and the WotLK website")]
[assembly: AssemblyVersion("1.0.0.0")]
#endif

namespace Andromeda
{
    enum State { Stopped, Starting, Running, Stopping, External, Crashed, Waiting }

    // One Node.js process the app looks after: the panel or the website.
    class Service
    {
        public string Key;              // "panel" / "site"
        public string Name;
        public string Description;
        public string Dir;              // its folder: "Andromeda Hosting" or "Andromeda WotLK Website"
        public string Script;           // relative to Dir
        public int StopWaitSeconds;     // how long a clean stop may take before it is forced
        public Func<int> Port;          // where it listens (read from its config each time)
        public Func<string> Url;
        public State State = State.Stopped;
        public Process Proc;
        public bool StopRequested;
        public readonly List<string> Log = new List<string>();
        public event Action<string> Output;
        public event Action Changed;

        public void Write(string line)
        {
            lock (Log)
            {
                Log.Add(line);
                if (Log.Count > 3000) Log.RemoveRange(0, 1000);
            }
            var h = Output; if (h != null) h(line);
        }
        public void SetState(State s) { State = s; var h = Changed; if (h != null) h(); }
        public bool Alive { get { return Proc != null && !Proc.HasExited; } }
    }

    static class Theme
    {
        // Same look as the panel: black ("X" style) or dark grey, hairline borders, white primary
        // buttons, blue accents. The first eight colours change with the theme.
        public static Color Bg, Card, CardBorder, Raised, RaisedHover, Text, Muted, LogBg;
        static readonly Color[] Black = {
            Color.FromArgb(0, 0, 0), Color.FromArgb(8, 9, 10), Color.FromArgb(47, 51, 54), Color.FromArgb(22, 24, 28),
            Color.FromArgb(39, 44, 48), Color.FromArgb(231, 233, 234), Color.FromArgb(113, 118, 123), Color.FromArgb(3, 3, 4),
        };
        static readonly Color[] Grey = {
            Color.FromArgb(30, 31, 35), Color.FromArgb(38, 40, 45), Color.FromArgb(58, 61, 68), Color.FromArgb(51, 54, 60),
            Color.FromArgb(61, 64, 71), Color.FromArgb(236, 236, 238), Color.FromArgb(154, 158, 168), Color.FromArgb(23, 24, 27),
        };
        public static Color[] Palette { get { return new[] { Bg, Card, CardBorder, Raised, RaisedHover, Text, Muted, LogBg }; } }
        public static void Use(bool grey)
        {
            var p = grey ? Grey : Black;
            Bg = p[0]; Card = p[1]; CardBorder = p[2]; Raised = p[3]; RaisedHover = p[4]; Text = p[5]; Muted = p[6]; LogBg = p[7];
        }
        static Theme() { Use(false); }
        public static readonly Color Accent = Color.FromArgb(29, 155, 240);
        public static readonly Color Primary = Color.FromArgb(231, 233, 234);
        public static readonly Color PrimaryHover = Color.FromArgb(255, 255, 255);
        public static readonly Color Brand = Color.FromArgb(255, 106, 61); // the logo
        public static readonly Color Green = Color.FromArgb(0, 186, 124);
        public static readonly Color Amber = Color.FromArgb(255, 212, 0);
        public static readonly Color Red = Color.FromArgb(244, 33, 46);
        public static readonly Color Blue = Color.FromArgb(29, 155, 240);

        // Switch a window that is already built: swap each control's colours from the old palette to
        // the new one; the hand-drawn controls read the current colours when they repaint.
        public static void Recolor(Control c, Color[] from, Color[] to)
        {
            Func<Color, Color> map = col =>
            {
                for (int i = 0; i < from.Length; i++) if (from[i].ToArgb() == col.ToArgb()) return to[i];
                return col;
            };
            c.BackColor = map(c.BackColor);
            c.ForeColor = map(c.ForeColor);
            var card = c as Card;
            if (card != null) { card.Fill = map(card.Fill); card.Border = map(card.Border); }
            var link = c as LinkLabel;
            if (link != null) link.ActiveLinkColor = map(link.ActiveLinkColor);
            foreach (Control child in c.Controls) Recolor(child, from, to);
            c.Invalidate();
        }

        public static Font UI(float size) { return new Font("Segoe UI", size); }
        public static Font Bold(float size) { return new Font("Segoe UI Semibold", size); }

        public static GraphicsPath Round(Rectangle r, int radius)
        {
            var p = new GraphicsPath();
            int d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            if (d <= 1) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        // The fill colour behind a control: its card's, or the window's.
        public static Color Behind(Control c)
        {
            for (var p = c.Parent; p != null; p = p.Parent)
            {
                var card = p as Card;
                if (card != null) return card.Fill;
            }
            return Bg;
        }

        public static Color Blend(Color a, Color b, float t)
        {
            return Color.FromArgb((int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }
    }

    // ---------- custom controls ----------

    // Rounded card with a thin border; children sit on its colour.
    class Card : Panel
    {
        public int Radius = 14;
        public Color Fill = Theme.Card;
        public Color Border = Theme.CardBorder;
        public Card()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            BackColor = Theme.Bg;
            Padding = new Padding(20, 16, 20, 16);
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.Clear(Theme.Behind(this));
            var r = new Rectangle(0, 0, Width - 1, Height - 1);
            using (var path = Theme.Round(r, Radius))
            using (var b = new SolidBrush(Fill))
            using (var pen = new Pen(Border))
            {
                e.Graphics.FillPath(b, path);
                e.Graphics.DrawPath(pen, path);
            }
        }
    }

    enum ButtonKind { Primary, Secondary, Danger, Ghost }

    class ModernButton : Control
    {
        public ButtonKind Kind;
        bool hover, down;
        public ModernButton(string text, ButtonKind kind)
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            Kind = kind;
            Font = Theme.Bold(9.5f);
            Cursor = Cursors.Hand;
            Height = 34;
            Margin = new Padding(8, 0, 0, 0);
            Text = text;
            FitWidth();
        }
        void FitWidth()
        {
            Width = TextRenderer.MeasureText(Text ?? "", Font).Width + 32;
        }
        protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); FitWidth(); Invalidate(); }
        protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Invalidate(); }
        protected override void OnMouseEnter(EventArgs e) { hover = true; Invalidate(); base.OnMouseEnter(e); }
        protected override void OnMouseLeave(EventArgs e) { hover = false; down = false; Invalidate(); base.OnMouseLeave(e); }
        protected override void OnMouseDown(MouseEventArgs e) { down = true; Invalidate(); base.OnMouseDown(e); }
        protected override void OnMouseUp(MouseEventArgs e) { down = false; Invalidate(); base.OnMouseUp(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            var behind = Theme.Behind(this);
            g.Clear(behind);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            Color fill, fg;
            switch (Kind)
            {
                case ButtonKind.Primary: fill = hover ? Theme.PrimaryHover : Theme.Primary; fg = Color.FromArgb(15, 20, 25); break;
                case ButtonKind.Danger: fill = hover ? Color.FromArgb(40, 8, 10) : behind; fg = Color.FromArgb(255, 92, 102); break;
                case ButtonKind.Ghost: fill = hover ? Theme.Raised : behind; fg = hover ? Theme.Text : Theme.Muted; break;
                default: fill = hover ? Theme.Raised : behind; fg = Theme.Text; break;
            }
            if (down) fill = ControlPaint.Dark(fill, 0.05f);
            if (!Enabled) { fill = Theme.Blend(fill, behind, 0.55f); fg = Theme.Blend(fg, behind, 0.55f); }
            using (var path = Theme.Round(new Rectangle(0, 0, Width - 1, Height - 1), Height / 2)) // pill
            {
                using (var b = new SolidBrush(fill)) g.FillPath(b, path);
                if (Kind == ButtonKind.Secondary || Kind == ButtonKind.Danger)
                    using (var pen = new Pen(Kind == ButtonKind.Danger ? Color.FromArgb(120, 244, 33, 46) : Theme.CardBorder)) g.DrawPath(pen, path);
            }
            TextRenderer.DrawText(g, Text, Font, ClientRectangle, fg, TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine);
        }
    }

    // A switch with a label.
    class Toggle : Control
    {
        bool on;
        public event EventHandler CheckedChanged;
        public Toggle(string text, bool initial)
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            Font = Theme.UI(9f);
            Text = text;
            on = initial;
            Cursor = Cursors.Hand;
            Height = 24;
            Width = TextRenderer.MeasureText(text, Font).Width + 52;
        }
        public bool Checked
        {
            get { return on; }
            set { if (on == value) return; on = value; Invalidate(); var h = CheckedChanged; if (h != null) h(this, EventArgs.Empty); }
        }
        protected override void OnClick(EventArgs e) { Checked = !Checked; base.OnClick(e); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Theme.Behind(this));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Theme.Round(new Rectangle(0, 3, 36, 18), 9))
            using (var b = new SolidBrush(on ? Theme.Accent : Theme.Raised)) g.FillPath(b, path);
            using (var b = new SolidBrush(Color.White)) g.FillEllipse(b, on ? 20 : 2, 5, 14, 14);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(44, 0, Width - 44, Height), Theme.Muted, TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.SingleLine);
        }
    }

    // The Andromeda Services "Star Gate" logo (public/img/icon.svg), drawn so it stays sharp at any
    // size: an open ring, an inner blue ring and a four-point star on a dark rounded tile.
    class Logo : Control
    {
        public Logo()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
        }
        PointF P(float x, float y) { float k = Width / 64f; return new PointF(x * k, y * k); }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Theme.Behind(this));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float k = Width / 64f;
            using (var tile = Theme.Round(new Rectangle(0, 0, Width - 1, Height - 1), (int)(15 * k)))
            using (var b = new SolidBrush(Color.FromArgb(11, 13, 16)))
            using (var edge = new Pen(Theme.CardBorder, Math.Max(1f, 2 * k)))
            {
                g.FillPath(b, tile);
                g.DrawPath(edge, tile);
            }
            // Open outer ring: 280 degrees, starting from the upper right.
            using (var ring = new Pen(Theme.Text, 4.2f * k) { StartCap = LineCap.Round, EndCap = LineCap.Round })
                g.DrawArc(ring, 14 * k, 14 * k, 36 * k, 36 * k, -60, 255);
            using (var inner = new Pen(Theme.Accent, 3.4f * k))
                g.DrawEllipse(inner, 22.5f * k, 22.5f * k, 19 * k, 19 * k);
            using (var star = new SolidBrush(Theme.Text))
                g.FillPolygon(star, new[] { P(32, 25.5f), P(33.8f, 30.2f), P(38.5f, 32), P(33.8f, 33.8f), P(32, 38.5f), P(30.2f, 33.8f), P(25.5f, 32), P(30.2f, 30.2f) });
        }
    }

    // Coloured pill with a dot.
    class Pill : Control
    {
        Color tone = Theme.Muted;
        public Pill()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
            Font = Theme.Bold(8.75f);
            Height = 24;
        }
        public void Set(string text, Color c)
        {
            Text = text;
            tone = c;
            Width = TextRenderer.MeasureText(text, Font).Width + 34;
            Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            var behind = Theme.Behind(this);
            g.Clear(behind);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Theme.Round(new Rectangle(0, 0, Width - 1, Height - 1), 12))
            using (var b = new SolidBrush(Theme.Blend(behind, tone, 0.16f))) g.FillPath(b, path);
            using (var b = new SolidBrush(tone)) g.FillEllipse(b, 11, Height / 2 - 4, 8, 8);
            TextRenderer.DrawText(g, Text, Font, new Rectangle(24, 0, Width - 26, Height), tone, TextFormatFlags.VerticalCenter | TextFormatFlags.Left | TextFormatFlags.SingleLine);
        }
    }

    // Whole-PC CPU and memory, read every 2 seconds. Windows: GetSystemTimes / GlobalMemoryStatusEx.
    // Elsewhere (e.g. testing under Mono): /proc/stat and /proc/meminfo.
    static class PcStats
    {
        [StructLayout(LayoutKind.Sequential)]
        struct FILETIME { public uint Low, High; public ulong Value { get { return ((ulong)High << 32) | Low; } } }
        [StructLayout(LayoutKind.Sequential)]
        class MEMORYSTATUSEX
        {
            public uint dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            public uint dwMemoryLoad;
            public ulong ullTotalPhys, ullAvailPhys, ullTotalPageFile, ullAvailPageFile, ullTotalVirtual, ullAvailVirtual, ullAvailExtendedVirtual;
        }
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetSystemTimes(out FILETIME idle, out FILETIME kernel, out FILETIME user);
        [DllImport("kernel32.dll", SetLastError = true)] static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX m);

        static ulong lastIdle, lastTotal;
        static bool windows = Environment.OSVersion.Platform == PlatformID.Win32NT;

        // Percent busy since the previous call, or -1 when unavailable.
        public static float Cpu()
        {
            try
            {
                ulong idle, total;
                if (windows)
                {
                    FILETIME i, k, u;
                    if (!GetSystemTimes(out i, out k, out u)) return -1;
                    idle = i.Value;
                    total = k.Value + u.Value; // kernel time includes idle
                }
                else
                {
                    var f = File.ReadAllLines("/proc/stat")[0].Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries).Skip(1).Select(ulong.Parse).ToArray();
                    idle = f[3] + (f.Length > 4 ? f[4] : 0);
                    total = 0;
                    foreach (var x in f.Take(8)) total += x;
                }
                float pct = -1;
                if (lastTotal > 0 && total > lastTotal) pct = 100f * (1f - (float)(idle - lastIdle) / (total - lastTotal));
                lastIdle = idle;
                lastTotal = total;
                return pct < 0 ? -1 : Math.Max(0, Math.Min(100, pct));
            }
            catch { return -1; }
        }

        // Bytes in use and total, or false when unavailable.
        public static bool Memory(out double used, out double total)
        {
            used = total = 0;
            try
            {
                if (windows)
                {
                    var m = new MEMORYSTATUSEX();
                    if (!GlobalMemoryStatusEx(m)) return false;
                    total = m.ullTotalPhys;
                    used = m.ullTotalPhys - m.ullAvailPhys;
                    return true;
                }
                double t = 0, a = 0;
                foreach (var line in File.ReadAllLines("/proc/meminfo"))
                {
                    var parts = line.Split(new[] { ' ', ':' }, StringSplitOptions.RemoveEmptyEntries);
                    if (parts[0] == "MemTotal") t = double.Parse(parts[1]) * 1024;
                    if (parts[0] == "MemAvailable") a = double.Parse(parts[1]) * 1024;
                }
                total = t;
                used = t - a;
                return t > 0;
            }
            catch { return false; }
        }
    }

    // A small line graph on a card: title, current value, the last few minutes as a glowing line.
    class Graph : Control
    {
        public string Title = "";
        public string Caption = "";
        public string Value = "—";
        public float Max = 100;
        public readonly List<float> Values = new List<float>();
        public int Keep = 300;
        public Graph()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.ResizeRedraw | ControlStyles.UserPaint, true);
        }
        public void Add(float v)
        {
            Values.Add(v);
            if (Values.Count > Keep) Values.RemoveRange(0, Values.Count - Keep);
            Invalidate();
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(Theme.Behind(this));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var path = Theme.Round(new Rectangle(0, 0, Width - 1, Height - 1), 14))
            using (var b = new SolidBrush(Theme.Card))
            using (var pen = new Pen(Theme.CardBorder))
            {
                g.FillPath(b, path);
                g.DrawPath(pen, path);
            }
            using (var f = Theme.Bold(10.5f)) TextRenderer.DrawText(g, Title, f, new Point(18, 14), Theme.Text);
            using (var f = Theme.Bold(14f))
            {
                var sz = TextRenderer.MeasureText(Value, f);
                TextRenderer.DrawText(g, Value, f, new Point(Width - 18 - sz.Width, 10), Theme.Text);
            }
            using (var f = Theme.UI(8.5f)) TextRenderer.DrawText(g, Caption, f, new Point(18, Height - 26), Theme.Muted);
            var plot = new RectangleF(18, 44, Width - 36, Height - 44 - 34);
            using (var grid = new Pen(Color.FromArgb(60, Theme.CardBorder)))
                for (int i = 0; i <= 2; i++) g.DrawLine(grid, plot.Left, plot.Top + plot.Height * i / 2f, plot.Right, plot.Top + plot.Height * i / 2f);
            if (Values.Count < 2)
            {
                using (var f = Theme.UI(9f)) TextRenderer.DrawText(g, "Collecting…", f, new Point((int)plot.Left, (int)(plot.Top + plot.Height / 2 - 8)), Theme.Muted);
                return;
            }
            var pts = new PointF[Values.Count];
            float top = Math.Max(Max, Values.Max());
            for (int i = 0; i < Values.Count; i++)
                pts[i] = new PointF(plot.Left + plot.Width * i / (Keep - 1), plot.Bottom - plot.Height * Math.Max(0, Values[i]) / top);
            // Draw from the right edge, so the newest reading is always at the right.
            float shift = plot.Right - pts[pts.Length - 1].X;
            for (int i = 0; i < pts.Length; i++) pts[i].X += shift;
            using (var area = new GraphicsPath())
            {
                area.AddLines(pts);
                area.AddLine(pts[pts.Length - 1], new PointF(pts[pts.Length - 1].X, plot.Bottom));
                area.AddLine(new PointF(pts[pts.Length - 1].X, plot.Bottom), new PointF(pts[0].X, plot.Bottom));
                area.CloseFigure();
                using (var fill = new LinearGradientBrush(plot, Color.FromArgb(70, Theme.Accent), Color.FromArgb(0, Theme.Accent), LinearGradientMode.Vertical))
                    g.FillPath(fill, area);
            }
            using (var glow = new Pen(Color.FromArgb(50, Theme.Accent), 6f) { LineJoin = LineJoin.Round }) g.DrawLines(glow, pts);
            using (var line = new Pen(Theme.Accent, 2f) { LineJoin = LineJoin.Round }) g.DrawLines(line, pts);
            using (var dot = new SolidBrush(Theme.Accent)) g.FillEllipse(dot, pts[pts.Length - 1].X - 3.5f, pts[pts.Length - 1].Y - 3.5f, 7, 7);
        }
    }

    static class Program
    {
        public static string Root;      // the Andromeda Services folder (next to this .exe)
        public static string[] Args;
        public const string PanelFolder = "Andromeda Hosting";
        public const string SiteFolder = "Andromeda WotLK Website";
        public static string PanelDir { get { return Path.Combine(Root, PanelFolder); } }
        public static string SiteDir { get { return Path.Combine(Root, SiteFolder); } }

        // The folder that holds "Andromeda Hosting" (this .exe's folder, or its parent when started
        // from the services folder). Null when there is none.
        public static string FindRoot()
        {
            var dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            foreach (var d in new[] { dir, Path.GetDirectoryName(dir) })
                if (d != null && File.Exists(Path.Combine(d, Path.Combine(PanelFolder, Path.Combine("src", "index.js"))))) return d;
            return null;
        }

        [STAThread]
        static void Main(string[] args)
        {
            Args = args;
            bool first;
            var mutex = new Mutex(true, "AndromedaServices.SingleInstance", out first);
            var show = new EventWaitHandle(false, EventResetMode.AutoReset, "AndromedaServices.Show");
            if (!first)
            {
                // Started again by an update: wait for the old copy to exit. Otherwise show that one.
                if (args.Contains("--after-update")) { try { first = mutex.WaitOne(60000); } catch (AbandonedMutexException) { first = true; } }
                if (!first) { show.Set(); return; }
            }

            Root = FindRoot();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (Root == null)
            {
                MessageBox.Show("Andromeda Services must be in the folder that holds \"" + PanelFolder + "\" and \"" + SiteFolder + "\" (next to install.exe).\n\nFolder: " + AppDomain.CurrentDomain.BaseDirectory, "Andromeda Services", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            var form = new MainForm(show);
            Application.Run(form);
            GC.KeepAlive(mutex);
        }
    }

    // Small settings file in the data folder (one key=value per line).
    class Settings
    {
        readonly string file;
        readonly Dictionary<string, string> values = new Dictionary<string, string>();
        public Settings(string file)
        {
            this.file = file;
            try
            {
                foreach (var line in File.ReadAllLines(file))
                {
                    var i = line.IndexOf('=');
                    if (i > 0) values[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
                }
            }
            catch { }
        }
        public bool Get(string key, bool def) { string v; return values.TryGetValue(key, out v) ? v == "1" : def; }
        public void Set(string key, bool on)
        {
            values[key] = on ? "1" : "0";
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(file));
                var sb = new StringBuilder();
                foreach (var kv in values) sb.AppendLine(kv.Key + "=" + kv.Value);
                File.WriteAllText(file, sb.ToString());
            }
            catch { }
        }
    }

    // Result of running git / npm / csc.
    class RunResult
    {
        public int Code = -1;
        public string Output = "";
        public bool Ok { get { return Code == 0; } }
        public string LastLine
        {
            get
            {
                var lines = Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                return lines.Length > 0 ? lines[lines.Length - 1].Trim() : "exit code " + Code;
            }
        }
    }

    class MainForm : Form
    {
        const int RestartCode = 75; // the panel exits with this after installing an update

        readonly Service panel;
        readonly Service site;
        readonly Service[] services;
        readonly Settings settings;
        readonly NotifyIcon tray;
        readonly TextBox logBox;
        readonly Dictionary<Service, Pill> pills = new Dictionary<Service, Pill>();
        readonly Dictionary<Service, LinkLabel> urlLabels = new Dictionary<Service, LinkLabel>();
        readonly Dictionary<Service, ModernButton[]> buttons = new Dictionary<Service, ModernButton[]>();
        readonly Dictionary<Service, ModernButton> logTabs = new Dictionary<Service, ModernButton>();
        readonly ModernButton updateButton;
        readonly Label versionLabel;
        readonly Panel bannerWrap;
        readonly Label updateTitle;
        readonly Label updateList;
        readonly System.Windows.Forms.Timer poll;
        readonly Graph cpuGraph, memGraph;
        Service shownLog;
        string node;
        bool exiting;
        bool trayHintShown;
        bool updating;
        string pendingBranch;
        bool startHidden = Program.Args.Contains("--tray"); // opened at sign-in: stay in the tray
        bool loaded;

        public MainForm(EventWaitHandle show)
        {
            settings = new Settings(Path.Combine(DataDir(), "services.ini"));
            Theme.Use(settings.Get("theme.grey", false));
            panel = new Service
            {
                Key = "panel",
                Name = "Andromeda Hosting",
                Description = "The control panel for all your game servers.",
                Dir = Program.PanelDir,
                Script = Path.Combine("src", "index.js"),
                StopWaitSeconds = 300, // game servers are saved and stopped first
                Port = () => ConfigInt(PanelConfig(), "port", 8080),
                Url = () => (PanelHttps() ? "https" : "http") + "://localhost:" + ConfigInt(PanelConfig(), "port", 8080),
            };
            site = new Service
            {
                Key = "site",
                Name = "Andromeda WotLK Website",
                Description = "News, armory, realm status and sign-up for your realm.",
                Dir = Program.SiteDir,
                Script = Path.Combine("src", "index.js"),
                StopWaitSeconds = 15,
                Port = () => ConfigInt(SiteConfig(), "port", 8091),
                Url = () => "http://localhost:" + ConfigInt(SiteConfig(), "port", 8091),
            };
            services = new[] { panel, site };

            Text = "Andromeda Services";
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = Theme.UI(9.5f);
            MinimumSize = new Size(900, 800);
            Size = new Size(1000, 900);
            StartPosition = FormStartPosition.CenterScreen;
            DoubleBuffered = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // ---- header: logo, title, version, Check for updates ----
            var header = new Panel { Dock = DockStyle.Top, Height = 96, BackColor = Theme.Bg };
            var logo = new Logo { Size = new Size(44, 44), Location = new Point(30, 26) };
            var title = new Label { Text = "Andromeda Services", Font = Theme.Bold(17f), AutoSize = true, Location = new Point(84, 22), ForeColor = Theme.Text, BackColor = Theme.Bg };
            versionLabel = new Label { Text = "", AutoSize = true, Location = new Point(87, 58), ForeColor = Theme.Muted, BackColor = Theme.Bg, Font = Theme.UI(9f) };
            updateButton = new ModernButton("Check for updates", ButtonKind.Secondary);
            updateButton.Click += (o, e) => CheckForUpdates(true);
            header.Controls.AddRange(new Control[] { logo, title, versionLabel, updateButton });
            header.Resize += (o, e) => updateButton.Location = new Point(header.Width - updateButton.Width - 30, 31);

            // ---- update banner (hidden until an update is found) ----
            bannerWrap = new Panel { Dock = DockStyle.Top, Height = 120, Padding = new Padding(28, 0, 28, 14), BackColor = Theme.Bg, Visible = false };
            var banner = new Card { Dock = DockStyle.Fill, Fill = Color.FromArgb(4, 18, 30), Border = Color.FromArgb(29, 155, 240) };
            updateTitle = new Label { AutoSize = true, Location = new Point(20, 14), Font = Theme.Bold(11f), ForeColor = Theme.Text, BackColor = banner.Fill };
            updateList = new Label { AutoSize = false, Location = new Point(20, 40), Size = new Size(600, 56), ForeColor = Theme.Muted, BackColor = banner.Fill, Font = Theme.UI(9f) };
            var updateNow = new ModernButton("Update now", ButtonKind.Primary);
            var later = new ModernButton("Later", ButtonKind.Ghost);
            updateNow.Click += (o, e) => InstallUpdate();
            later.Click += (o, e) => bannerWrap.Visible = false;
            banner.Controls.AddRange(new Control[] { updateTitle, updateList, updateNow, later });
            banner.Resize += (o, e) =>
            {
                updateNow.Location = new Point(banner.Width - updateNow.Width - 20, 18);
                later.Location = new Point(updateNow.Left - later.Width - 8, 18);
                updateList.Width = Math.Max(200, later.Left - 40);
            };
            bannerWrap.Controls.Add(banner);

            // ---- the two service cards, side by side ----
            var cards = new TableLayoutPanel { Dock = DockStyle.Top, Height = 226, ColumnCount = 2, RowCount = 1, Padding = new Padding(22, 0, 22, 0), BackColor = Theme.Bg };
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            cards.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            cards.Controls.Add(BuildCard(panel), 0, 0);
            cards.Controls.Add(BuildCard(site), 1, 0);

            // ---- whole-PC CPU and memory graphs ----
            var graphs = new TableLayoutPanel { Dock = DockStyle.Top, Height = 168, ColumnCount = 2, RowCount = 1, Padding = new Padding(22, 14, 22, 0), BackColor = Theme.Bg };
            graphs.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            graphs.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            graphs.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            cpuGraph = new Graph { Dock = DockStyle.Fill, Margin = new Padding(6, 0, 6, 0), Title = "CPU", Caption = "Whole PC · last 10 minutes", Max = 100 };
            memGraph = new Graph { Dock = DockStyle.Fill, Margin = new Padding(6, 0, 6, 0), Title = "Memory", Caption = "Whole PC · last 10 minutes" };
            graphs.Controls.Add(cpuGraph, 0, 0);
            graphs.Controls.Add(memGraph, 1, 0);

            // ---- logs ----
            var logCard = new Card { Dock = DockStyle.Fill, Padding = new Padding(18, 14, 18, 18) };
            var logHead = new Panel { Dock = DockStyle.Top, Height = 46, BackColor = Theme.Card };
            var logTitle = new Label { Text = "Log", Font = Theme.Bold(11f), AutoSize = true, Location = new Point(2, 6), ForeColor = Theme.Text, BackColor = Theme.Card };
            var tabs = new FlowLayoutPanel { AutoSize = true, Location = new Point(48, 0), BackColor = Theme.Card, WrapContents = false };
            foreach (var s in services)
            {
                var svc = s;
                var tab = new ModernButton(s.Name, ButtonKind.Ghost) { Height = 32 };
                tab.Click += (o, e) => ShowLog(svc);
                tabs.Controls.Add(tab);
                logTabs[s] = tab;
            }
            var openLogs = new ModernButton("Log files", ButtonKind.Ghost) { Height = 32 };
            openLogs.Click += (o, e) => { try { Process.Start("explorer.exe", "\"" + Path.Combine(DataDir(), "logs") + "\""); } catch { } };
            var clear = new ModernButton("Clear", ButtonKind.Ghost) { Height = 32 };
            clear.Click += (o, e) => { lock (shownLog.Log) shownLog.Log.Clear(); logBox.Clear(); };
            logHead.Controls.AddRange(new Control[] { logTitle, tabs, openLogs, clear });
            logHead.Resize += (o, e) =>
            {
                openLogs.Location = new Point(logHead.Width - openLogs.Width, 0);
                clear.Location = new Point(openLogs.Left - clear.Width - 4, 0);
            };
            var logFrame = new Panel { Dock = DockStyle.Fill, BackColor = Theme.LogBg, Padding = new Padding(12, 10, 4, 10) };
            logBox = new TextBox
            {
                Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, WordWrap = true,
                BackColor = Theme.LogBg, ForeColor = Color.FromArgb(200, 206, 218), BorderStyle = BorderStyle.None,
                Font = new Font("Consolas", 9.25f),
            };
            logFrame.Controls.Add(logBox);
            logCard.Controls.Add(logFrame);
            logCard.Controls.Add(logHead);
            var logWrap = new Panel { Dock = DockStyle.Fill, Padding = new Padding(28, 14, 28, 4), BackColor = Theme.Bg };
            logWrap.Controls.Add(logCard);

            // ---- footer ----
            var footer = new Panel { Dock = DockStyle.Bottom, Height = 64, BackColor = Theme.Bg };
            var startup = new Toggle("Open Andromeda Services when I sign in to Windows", RunAtLogin()) { Location = new Point(30, 21) };
            startup.CheckedChanged += (o, e) => SetRunAtLogin(startup.Checked);
            var greyTheme = new Toggle("Dark grey theme", settings.Get("theme.grey", false)) { Location = new Point(startup.Right + 24, 21) };
            greyTheme.CheckedChanged += (o, e) =>
            {
                var before = Theme.Palette;
                Theme.Use(greyTheme.Checked);
                settings.Set("theme.grey", greyTheme.Checked);
                SuspendLayout();
                Theme.Recolor(this, before, Theme.Palette);
                ResumeLayout();
            };
            footer.Controls.Add(greyTheme);
            var folder = new ModernButton("Open folder", ButtonKind.Secondary);
            folder.Click += (o, e) => Process.Start("explorer.exe", "\"" + Program.Root + "\"");
            var exit = new ModernButton("Stop all and exit", ButtonKind.Danger);
            exit.Click += (o, e) => ExitApp();
            footer.Controls.AddRange(new Control[] { startup, folder, exit });
            footer.Resize += (o, e) =>
            {
                exit.Location = new Point(footer.Width - exit.Width - 30, 16);
                folder.Location = new Point(exit.Left - folder.Width - 8, 16);
            };

            Controls.Add(logWrap);
            Controls.Add(footer);
            Controls.Add(graphs);
            Controls.Add(cards);
            Controls.Add(bannerWrap);
            Controls.Add(header);

            foreach (var s in services)
            {
                var svc = s;
                s.Output += line => { if (shownLog == svc) AppendLogLine(line); };
                s.Changed += () => RefreshCard(svc);
            }
            shownLog = panel;

            // ---- tray ----
            tray = new NotifyIcon { Text = "Andromeda Services", Icon = Icon ?? SystemIcons.Application, Visible = true };
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Andromeda Services", null, (o, e) => ShowWindow());
            menu.Items.Add("Open the panel", null, (o, e) => OpenUrl(panel.Url()));
            menu.Items.Add("Open the WotLK website", null, (o, e) => OpenUrl(site.Url()));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Start both", null, (o, e) => { Start(panel); Start(site); });
            menu.Items.Add("Stop both", null, (o, e) => { Stop(site, false); Stop(panel, false); });
            menu.Items.Add("Check for updates", null, (o, e) => { ShowWindow(); CheckForUpdates(true); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Stop all and exit", null, (o, e) => ExitApp());
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (o, e) => ShowWindow();
            tray.BalloonTipClicked += (o, e) => ShowWindow();

            // A second copy of the app was opened: show this window instead.
            var waiter = new Thread(() => { while (true) { show.WaitOne(); try { BeginInvoke((Action)ShowWindow); } catch { return; } } });
            waiter.IsBackground = true;
            waiter.Start();

            poll = new System.Windows.Forms.Timer { Interval = 2000 };
            poll.Tick += (o, e) => { PollPorts(); SamplePc(); };
            poll.Start();
            var updateTimer = new System.Windows.Forms.Timer { Interval = 6 * 60 * 60 * 1000 }; // and quietly every 6 hours
            updateTimer.Tick += (o, e) => CheckForUpdates(false);
            updateTimer.Start();

            SystemEvents.SessionEnding += (o, e) => { exiting = true; StopAllAndWait(60, false); };
            HandleCreated += (o, e) => DarkTitleBar(Handle);
            Load += (o, e) => { if (!loaded) OnLoaded(); };
            if (RunAtLogin()) SetRunAtLogin(true); // keeps the sign-in entry pointing at this copy, with --tray
        }

        // Opened at sign-in: start everything without showing the window. Load only fires when the
        // window is first shown, so the start-up work runs here instead.
        protected override void SetVisibleCore(bool value)
        {
            if (startHidden && value)
            {
                startHidden = false;
                if (!IsHandleCreated) CreateHandle();
                OnLoaded();
                return;
            }
            base.SetVisibleCore(value);
        }

        void OnLoaded()
        {
            loaded = true;
            node = FindNode();
            foreach (var s in services) RefreshCard(s);
            ShowLog(panel);
            RefreshVersion();
            if (node == null)
            {
                panel.Write("Node.js was not found. Install the LTS version from https://nodejs.org, then reopen Andromeda Services.");
                return;
            }
            panel.Write("Using Node.js: " + node);
            // Opened again by an update: bring back what was running before it.
            var resume = Program.Args.FirstOrDefault(a => a.StartsWith("--start="));
            if (resume != null)
            {
                var keys = resume.Substring(8).Split(',');
                panel.Write("Update installed.");
                if (keys.Contains("panel")) Start(panel);
                if (keys.Contains("site")) Start(site);
            }
            else
            {
                if (settings.Get("autostart.panel", true)) Start(panel);
                if (settings.Get("autostart.site", true)) Start(site);
            }
            var check = new Thread(() => { Thread.Sleep(8000); try { BeginInvoke((Action)(() => CheckForUpdates(false))); } catch { } });
            check.IsBackground = true;
            check.Start();
        }

        // ---------- layout ----------
        Control BuildCard(Service s)
        {
            var card = new Card { Dock = DockStyle.Fill, Margin = new Padding(6, 0, 6, 0) };
            var name = new Label { Text = s.Name, Font = Theme.Bold(13f), AutoSize = true, Location = new Point(20, 16), ForeColor = Theme.Text, BackColor = Theme.Card };
            var version = new Label { Text = AppVersion(s), AutoSize = true, ForeColor = Theme.Muted, BackColor = Theme.Card, Font = Theme.UI(9f) };
            name.SizeChanged += (o, e) => version.Location = new Point(name.Right + 6, 22);
            version.Location = new Point(name.Right + 6, 22);
            var pill = new Pill { Location = new Point(20, 52) };
            pill.Set("Stopped", Theme.Muted);
            var desc = new Label { Text = s.Description, AutoSize = true, Location = new Point(20, 88), ForeColor = Theme.Muted, BackColor = Theme.Card };
            var url = new LinkLabel { Text = "", AutoSize = true, Location = new Point(20, 110), LinkColor = Theme.Accent, ActiveLinkColor = Theme.Text, BackColor = Theme.Card, LinkBehavior = LinkBehavior.HoverUnderline };
            url.LinkClicked += (o, e) => OpenUrl(s.Url());

            var main = new ModernButton("Start", ButtonKind.Primary) { Margin = new Padding(0) };
            var restart = new ModernButton("Restart", ButtonKind.Secondary);
            var open = new ModernButton("Open", ButtonKind.Secondary);
            main.Click += (o, e) => { if (s.Alive) Stop(s, false); else Start(s); };
            restart.Click += (o, e) => Restart(s);
            open.Click += (o, e) => OpenUrl(s.Url());
            // Buttons in a row; their widths change with the text (Start/Stop), so place them on resize.
            ModernButton settingsButton = null;
            if (s == site)
            {
                settingsButton = new ModernButton("Settings", ButtonKind.Ghost);
                settingsButton.Click += (o, e) => EditSiteSettings();
            }
            Action place = () =>
            {
                main.Location = new Point(20, 144);
                restart.Location = new Point(main.Right + 8, 144);
                open.Location = new Point(restart.Right + 8, 144);
                if (settingsButton != null) settingsButton.Location = new Point(open.Right + 8, 144);
            };
            main.SizeChanged += (o, e) => place();
            place();
            var auto = new Toggle("Start when Andromeda Services opens", settings.Get("autostart." + s.Key, true)) { Location = new Point(21, 190) };
            auto.CheckedChanged += (o, e) => settings.Set("autostart." + s.Key, auto.Checked);

            card.Controls.AddRange(new Control[] { name, version, pill, desc, url, main, restart, open, auto });
            if (settingsButton != null) card.Controls.Add(settingsButton);
            pills[s] = pill;
            urlLabels[s] = url;
            buttons[s] = new[] { main, restart, open };
            return card;
        }

        void ShowLog(Service s)
        {
            shownLog = s;
            foreach (var kv in logTabs)
            {
                kv.Value.Kind = kv.Key == s ? ButtonKind.Secondary : ButtonKind.Ghost;
                kv.Value.Invalidate();
            }
            string text;
            lock (s.Log) text = string.Join(Environment.NewLine, s.Log.ToArray());
            logBox.Text = text.Length > 0 ? text + Environment.NewLine : "";
            logBox.SelectionStart = logBox.TextLength;
            logBox.ScrollToCaret();
        }

        void AppendLogLine(string line)
        {
            if (line == null) return;
            if (InvokeRequired) { try { BeginInvoke((Action)(() => AppendLogLine(line))); } catch { } return; }
            if (logBox.TextLength > 400000) logBox.Text = logBox.Text.Substring(logBox.TextLength - 200000); // keep the window light
            logBox.AppendText(line.TrimEnd('\r', '\n') + Environment.NewLine);
        }

        void RefreshCard(Service s)
        {
            if (InvokeRequired) { try { BeginInvoke((Action)(() => RefreshCard(s))); } catch { } return; }
            string text;
            Color color;
            switch (s.State)
            {
                case State.Starting: text = "Starting…"; color = Theme.Amber; break;
                case State.Running: text = "Running"; color = Theme.Green; break;
                case State.Stopping: text = s == panel ? "Stopping (saving game servers)…" : "Stopping…"; color = Theme.Amber; break;
                case State.External: text = "Running outside Andromeda Services"; color = Theme.Blue; break;
                case State.Crashed: text = "Stopped unexpectedly — see the log"; color = Theme.Red; break;
                case State.Waiting: text = "Waiting: choose the SPP folder in Settings"; color = Theme.Amber; break;
                default: text = "Stopped"; color = Theme.Muted; break;
            }
            if (updating && !s.Alive) { text = "Updating…"; color = Theme.Blue; }
            pills[s].Set(text, color);
            urlLabels[s].Text = s.Url();
            var b = buttons[s];
            bool alive = s.Alive;
            b[0].Text = alive ? "Stop" : "Start";
            b[0].Kind = alive ? ButtonKind.Secondary : ButtonKind.Primary;
            b[0].Enabled = !updating && node != null && s.State != State.Stopping && s.State != State.External;
            b[1].Enabled = !updating && node != null && s.State == State.Running;
            b[2].Enabled = s.State == State.Running || s.State == State.External;
            foreach (var x in b) x.Invalidate();
            int up = services.Count(x => x.State == State.Running || x.State == State.External);
            if (tray != null) tray.Text = "Andromeda Services — " + up + " of 2 running";
        }

        // ---------- processes ----------
        void Start(Service s)
        {
            if (node == null || s.Alive || updating) return;
            if (PortInUse(s.Port()))
            {
                s.SetState(State.External);
                s.Write("Port " + s.Port() + " is already in use, so " + s.Name + " seems to be running already (for example from a console window). Close that one first to manage it here.");
                return;
            }
            if (!Directory.Exists(Path.Combine(s.Dir, "node_modules")))
            {
                s.SetState(State.Starting);
                s.Write("First start: installing packages (needs internet, one time)...");
                var t = new Thread(() =>
                {
                    var r = RunNpmInstall(s, s.Dir);
                    try { BeginInvoke((Action)(() => { if (r.Ok) Launch(s); else { s.Write("npm install failed. Run install.exe once, then try again."); s.SetState(State.Crashed); } })); } catch { }
                });
                t.IsBackground = true;
                t.Start();
                return;
            }
            Launch(s);
        }

        void Launch(Service s)
        {
            var psi = new ProcessStartInfo(node, "\"" + s.Script + "\"")
            {
                WorkingDirectory = s.Dir,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.EnvironmentVariables["ANDROMEDA_SERVICES"] = "1";
            psi.EnvironmentVariables["ANDROMEDA_LAUNCHER"] = "1"; // lets the panel restart itself after an update
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (o, e) => OnOutput(s, e.Data);
            p.ErrorDataReceived += (o, e) => OnOutput(s, e.Data);
            p.Exited += (o, e) => OnExited(s, p);
            try
            {
                p.Start();
            }
            catch (Exception ex)
            {
                s.Write("Could not start: " + ex.Message);
                s.SetState(State.Crashed);
                return;
            }
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            s.Proc = p;
            s.StopRequested = false;
            s.SetState(State.Starting);
            s.Write("──── starting " + s.Name + " ────");
        }

        void OnOutput(Service s, string line)
        {
            if (line == null) return;
            s.Write(line);
            if ((s.State == State.Starting || s.State == State.Waiting) && line.Contains(" is running at ")) s.SetState(State.Running);
            else if (s.State == State.Starting && line.Contains("The SPP folder isn't set yet")) s.SetState(State.Waiting);
        }

        void OnExited(Service s, Process p)
        {
            int code = -1;
            try { code = p.ExitCode; } catch { }
            if (s.Proc != p) return;
            s.Proc = null;
            if (!s.StopRequested && s == panel && code == RestartCode)
            {
                s.Write("Restarting after an update...");
                try { BeginInvoke((Action)(() => Launch(s))); } catch { }
                return;
            }
            s.Write("──── " + s.Name + " stopped (exit code " + code + ") ────");
            s.SetState(s.StopRequested || code == 0 ? State.Stopped : State.Crashed);
        }

        // forUpdate: the panel notes its running game servers and starts them again afterwards.
        void Stop(Service s, bool forUpdate)
        {
            if (!s.Alive) { if (s.State == State.External) s.Write("It was started outside Andromeda Services; stop it where it was started."); return; }
            s.StopRequested = true;
            s.SetState(State.Stopping);
            s.Write("Stopping " + s.Name + (s == panel ? " (running game servers are saved and stopped first)..." : "..."));
            try
            {
                // "stop-for-update" makes the panel bring its running game servers back afterwards. A panel
                // from before that command ignores it and acts on the plain "stop" that follows; a newer
                // one is already stopping and ignores the second line.
                if (forUpdate && s == panel) s.Proc.StandardInput.WriteLine("stop-for-update");
                s.Proc.StandardInput.WriteLine("stop");
                s.Proc.StandardInput.Flush();
            }
            catch { }
            var proc = s.Proc;
            var watch = new Thread(() =>
            {
                if (!proc.WaitForExit(s.StopWaitSeconds * 1000))
                {
                    s.Write("Didn't stop in time; forcing it.");
                    KillTree(proc);
                }
            });
            watch.IsBackground = true;
            watch.Start();
        }

        void Restart(Service s)
        {
            if (!s.Alive) { Start(s); return; }
            var proc = s.Proc;
            Stop(s, false);
            var t = new Thread(() => { proc.WaitForExit(); Thread.Sleep(500); try { BeginInvoke((Action)(() => Start(s))); } catch { } });
            t.IsBackground = true;
            t.Start();
        }

        // May run on any thread.
        void StopAllAndWait(int seconds, bool forUpdate)
        {
            Action stop = () => { Stop(site, forUpdate); Stop(panel, forUpdate); };
            if (InvokeRequired) Invoke(stop); else stop();
            var until = DateTime.Now.AddSeconds(seconds);
            foreach (var s in new[] { site, panel })
            {
                var p = s.Proc;
                if (p == null) continue;
                var left = (int)Math.Max(0, (until - DateTime.Now).TotalMilliseconds);
                try { if (!p.WaitForExit(left)) KillTree(p); } catch { }
            }
        }

        static void KillTree(Process p)
        {
            try
            {
                var k = Process.Start(new ProcessStartInfo("taskkill", "/T /F /PID " + p.Id) { CreateNoWindow = true, UseShellExecute = false });
                if (k != null) k.WaitForExit(10000);
            }
            catch { }
        }

        // Runs a program to the end, copying its output to a service's log. Call from a background thread.
        internal static RunResult Run(string file, string args, Service log, int timeoutMs, string cwd = null)
        {
            var r = new RunResult();
            var sb = new StringBuilder();
            try
            {
                var psi = new ProcessStartInfo(file, args)
                {
                    WorkingDirectory = cwd ?? Program.Root, UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8,
                };
                psi.EnvironmentVariables["GIT_TERMINAL_PROMPT"] = "0"; // never wait for a password prompt
                using (var p = new Process { StartInfo = psi })
                {
                    DataReceivedEventHandler h = (o, e) =>
                    {
                        if (e.Data == null) return;
                        lock (sb) sb.AppendLine(e.Data);
                        if (log != null) log.Write("  " + e.Data);
                    };
                    p.OutputDataReceived += h;
                    p.ErrorDataReceived += h;
                    p.Start();
                    p.BeginOutputReadLine();
                    p.BeginErrorReadLine();
                    if (!p.WaitForExit(timeoutMs)) { KillTree(p); r.Output = "timed out"; return r; }
                    p.WaitForExit();
                    r.Code = p.ExitCode;
                }
            }
            catch (Exception ex) { lock (sb) sb.AppendLine(ex.Message); }
            lock (sb) r.Output = sb.ToString();
            return r;
        }

        RunResult RunNpmInstall(Service s, string dir)
        {
            var npm = Path.Combine(Path.GetDirectoryName(node), "npm.cmd");
            return Run("cmd.exe", "/d /s /c \"\"" + (File.Exists(npm) ? npm : "npm") + "\" install --omit=dev --no-audit --no-fund\"", s, 600000, dir);
        }

        // "v2.0.0" from the app's package.json.
        static string AppVersion(Service s)
        {
            object v;
            return ReadJson(Path.Combine(s.Dir, "package.json")).TryGetValue("version", out v) && v != null ? "v" + v : "";
        }

        // ---------- updates (replaces update.bat) ----------
        static string FindGit()
        {
            foreach (var p in OnPath("git.exe")) return p;
            foreach (var p in new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Git\cmd\git.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Git\cmd\git.exe"),
            })
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        void RefreshVersion()
        {
            var t = new Thread(() =>
            {
                var git = FindGit();
                string text = "Version " + Assembly.GetExecutingAssembly().GetName().Version.ToString(2);
                if (git != null)
                {
                    var branch = Run(git, "rev-parse --abbrev-ref HEAD", null, 15000);
                    var commit = Run(git, "log -1 --format=\"%h · updated %cr\"", null, 15000);
                    if (branch.Ok && commit.Ok) text = "Branch " + branch.LastLine + " · " + commit.LastLine;
                }
                try { BeginInvoke((Action)(() => versionLabel.Text = text)); } catch { }
            });
            t.IsBackground = true;
            t.Start();
        }

        void CheckForUpdates(bool userAsked)
        {
            if (updating || !updateButton.Enabled) return;
            var git = FindGit();
            if (git == null)
            {
                if (userAsked) MessageBox.Show(this, "Updates need Git for Windows. Install it from https://git-scm.com/download/win (the default options are fine), then try again.", "Andromeda Services", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            updateButton.Enabled = false;
            updateButton.Text = "Checking…";
            var t = new Thread(() =>
            {
                string error = null, branch = null;
                int behind = 0;
                var changes = new List<string>();
                var inside = Run(git, "rev-parse --is-inside-work-tree", null, 15000);
                if (!inside.Ok || inside.LastLine != "true") error = "This folder isn't a Git copy of Andromeda Services, so it can't update itself. See \"Updating\" in README.md.";
                else
                {
                    var b = Run(git, "rev-parse --abbrev-ref HEAD", null, 15000);
                    branch = b.LastLine;
                    if (!b.Ok || branch == "HEAD") error = "This folder isn't on a branch, so there's nothing to update from.";
                    else
                    {
                        var fetch = Run(git, "fetch --quiet origin \"" + branch + "\"", null, 180000);
                        if (!fetch.Ok) error = "Couldn't reach GitHub: " + fetch.LastLine;
                        else
                        {
                            int.TryParse(Run(git, "rev-list --count HEAD..FETCH_HEAD", null, 15000).LastLine, out behind);
                            if (behind > 0)
                            {
                                var log = Run(git, "log --format=\"%s\" -n 8 HEAD..FETCH_HEAD", null, 15000);
                                changes.AddRange(log.Output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));
                            }
                        }
                    }
                }
                try
                {
                    BeginInvoke((Action)(() =>
                    {
                        updateButton.Enabled = true;
                        updateButton.Text = "Check for updates";
                        if (error != null)
                        {
                            panel.Write("Update check: " + error);
                            if (userAsked) MessageBox.Show(this, error, "Andromeda Services", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                            return;
                        }
                        pendingBranch = branch;
                        if (behind == 0)
                        {
                            bannerWrap.Visible = false;
                            if (userAsked) MessageBox.Show(this, "You're up to date (branch " + branch + ").", "Andromeda Services", MessageBoxButtons.OK, MessageBoxIcon.Information);
                            return;
                        }
                        updateTitle.Text = "Update available: " + behind + (behind == 1 ? " change" : " changes");
                        updateList.Text = string.Join("\n", changes.Take(3).Select(c => "•  " + (c.Length > 110 ? c.Substring(0, 110) + "…" : c)).ToArray()) + (behind > 3 ? "\n…and " + (behind - 3) + " more" : "");
                        bannerWrap.Visible = true;
                        if (!userAsked && !Visible) tray.ShowBalloonTip(5000, "Update available", "Open Andromeda Services to install it.", ToolTipIcon.Info);
                    }));
                }
                catch { }
            });
            t.IsBackground = true;
            t.Start();
        }

        void InstallUpdate()
        {
            if (updating || pendingBranch == null) return;
            if (panel.State == State.External || site.State == State.External)
            {
                MessageBox.Show(this, "Something was started outside Andromeda Services (for example in a console window). Close it first, then update.", "Andromeda Services", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            bool wasPanel = panel.Alive;
            bool wasSite = site.Alive;
            if (wasPanel && MessageBox.Show(this, "Installing the update stops Andromeda Hosting and the WotLK website for a minute. Running game servers are saved, stopped, and started again afterwards.\n\nUpdate now?", "Andromeda Services", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            updating = true;
            bannerWrap.Visible = false;
            updateButton.Enabled = false;
            updateButton.Text = "Updating…";
            ShowLog(panel);
            foreach (var s in services) RefreshCard(s);
            var git = FindGit();
            var branch = pendingBranch;
            var t = new Thread(() =>
            {
                string failure = null;
                bool relaunch = false;
                try
                {
                    panel.Write("──── installing the update from GitHub (" + branch + ") ────");
                    StopAllAndWait(330, true);
                    var before = Run(git, "rev-parse HEAD", null, 15000).LastLine;
                    var fetch = Run(git, "fetch origin \"" + branch + "\"", panel, 300000);
                    if (!fetch.Ok) throw new Exception("download failed: " + fetch.LastLine);
                    // Match GitHub exactly. config.json and the data folder aren't tracked, so they're kept.
                    var reset = Run(git, "reset --hard FETCH_HEAD", panel, 120000);
                    if (!reset.Ok) throw new Exception("couldn't apply it: " + reset.LastLine);
                    panel.Write("Installing any new packages...");
                    foreach (var dir in new[] { Program.PanelDir, Program.SiteDir })
                        if (node != null && Directory.Exists(dir) && !RunNpmInstall(panel, dir).Ok) panel.Write("npm install in \"" + Path.GetFileName(dir) + "\" reported a problem (see above). Starting anyway.");
                    var appChanged = !Run(git, "diff --quiet " + before + " HEAD -- services", null, 15000).Ok;
                    if (appChanged)
                    {
                        panel.Write("Rebuilding Andromeda Services...");
                        var problem = BuildNewExe();
                        if (problem == null) relaunch = true;
                        else panel.Write("Couldn't rebuild Andromeda Services (" + problem + "). The rest of the update is installed; run services\\build.bat later.");
                    }
                    panel.Write("Update installed.");
                }
                catch (Exception ex) { failure = ex.Message; }
                try
                {
                    BeginInvoke((Action)(() =>
                    {
                        if (relaunch) { SwapAndRestart(wasPanel, wasSite); return; }
                        updating = false;
                        updateButton.Enabled = true;
                        updateButton.Text = "Check for updates";
                        RefreshVersion();
                        if (failure != null)
                        {
                            panel.Write("Update failed: " + failure);
                            MessageBox.Show(this, "The update failed: " + failure, "Andromeda Services", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        }
                        if (wasPanel) Start(panel);
                        if (wasSite) Start(site);
                        foreach (var s in services) RefreshCard(s);
                    }));
                }
                catch { }
            });
            t.IsBackground = true;
            t.Start();
        }

        static string NewExePath { get { return Path.Combine(Program.Root, "Andromeda Services.new.exe"); } }

        // Compiles the updated source next to the running app. Returns null when it worked.
        string BuildNewExe()
        {
            var csc = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"Microsoft.NET\Framework64\v4.0.30319\csc.exe");
            if (!File.Exists(csc)) csc = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), @"Microsoft.NET\Framework\v4.0.30319\csc.exe");
            if (!File.Exists(csc)) return "the .NET Framework C# compiler wasn't found";
            try { File.Delete(NewExePath); } catch { }
            var r = Run(csc, "/nologo /codepage:65001 /target:winexe /optimize+ /win32icon:services\\andromeda.ico /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:System.Core.dll \"/out:" + NewExePath + "\" services\\AndromedaServices.cs", panel, 120000);
            return r.Ok && File.Exists(NewExePath) ? null : r.LastLine;
        }

        // A tiny script waits for this app to exit, puts the new .exe in place and opens it again.
        void SwapAndRestart(bool wasPanel, bool wasSite)
        {
            var exe = Application.ExecutablePath;
            var pid = Process.GetCurrentProcess().Id.ToString();
            var script = Path.Combine(Path.GetTempPath(), "andromeda-services-update.cmd");
            var start = new List<string>();
            if (wasPanel) start.Add("panel");
            if (wasSite) start.Add("site");
            File.WriteAllText(script,
                "@echo off\r\n" +
                ":wait\r\n" +
                "tasklist /FI \"PID eq " + pid + "\" 2>nul | find \"" + pid + "\" >nul && (ping -n 2 127.0.0.1 >nul & goto wait)\r\n" +
                "move /y \"" + NewExePath + "\" \"" + exe + "\" >nul\r\n" +
                "start \"\" \"" + exe + "\" --after-update --start=" + (start.Count > 0 ? string.Join(",", start.ToArray()) : "none") + "\r\n" +
                "del \"%~f0\"\r\n");
            Process.Start(new ProcessStartInfo("cmd.exe", "/c \"" + script + "\"") { CreateNoWindow = true, UseShellExecute = false, WorkingDirectory = Program.Root });
            exiting = true;
            tray.Visible = false;
            Close();
            Application.Exit();
        }

        void SamplePc()
        {
            var cpu = PcStats.Cpu();
            if (cpu >= 0)
            {
                cpuGraph.Value = cpu.ToString("0") + "%";
                cpuGraph.Add(cpu);
            }
            double used, total;
            if (PcStats.Memory(out used, out total))
            {
                const double GB = 1024.0 * 1024 * 1024;
                memGraph.Max = (float)(total / GB);
                memGraph.Value = (used / GB).ToString("0.0") + " / " + (total / GB).ToString("0") + " GB";
                memGraph.Add((float)(used / GB));
            }
        }

        // Catches services started elsewhere, and ones whose "running" line was missed.
        void PollPorts()
        {
            foreach (var s in services)
            {
                if (s.Alive && (s.State == State.Starting || s.State == State.Waiting) && PortInUse(s.Port())) s.SetState(State.Running);
                else if (!s.Alive && !updating && (s.State == State.Stopped || s.State == State.External)) s.SetState(PortInUse(s.Port()) ? State.External : State.Stopped);
                else RefreshCard(s);
            }
        }

        static bool PortInUse(int port)
        {
            try
            {
                using (var c = new TcpClient())
                {
                    var r = c.BeginConnect("127.0.0.1", port, null, null);
                    return r.AsyncWaitHandle.WaitOne(300) && c.Connected;
                }
            }
            catch { return false; }
        }

        // ---------- window, tray, exit ----------
        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        internal static void DarkTitleBar(IntPtr hwnd)
        {
            try
            {
                int on = 1;
                if (DwmSetWindowAttribute(hwnd, 20, ref on, 4) != 0) DwmSetWindowAttribute(hwnd, 19, ref on, 4); // dark title bar (newer / older Windows 10)
                int round = 2;
                DwmSetWindowAttribute(hwnd, 33, ref round, 4); // rounded corners on Windows 11
            }
            catch { } // not Windows 10/11
        }

        void ShowWindow()
        {
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
            BringToFront();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!exiting && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true; // closing the window keeps the services running in the tray
                Hide();
                if (!trayHintShown)
                {
                    trayHintShown = true;
                    tray.ShowBalloonTip(4000, "Still running", "Andromeda Services keeps running in the tray. Right-click its icon to stop everything and exit.", ToolTipIcon.Info);
                }
                return;
            }
            base.OnFormClosing(e);
        }

        void ExitApp()
        {
            if (updating) return;
            if (panel.Alive || site.Alive)
            {
                var answer = MessageBox.Show(this, "Stop Andromeda Hosting (and the game servers it runs) and the WotLK website, then exit?", "Andromeda Services", MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                if (answer != DialogResult.OK) return;
            }
            exiting = true;
            ShowWindow();
            Enabled = false;
            Text = "Andromeda Services — stopping…";
            var t = new Thread(() =>
            {
                StopAllAndWait(330, false);
                try { BeginInvoke((Action)(() => { tray.Visible = false; Close(); Application.Exit(); })); } catch { }
            });
            t.IsBackground = true;
            t.Start();
        }

        static void OpenUrl(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        // ---------- website settings (its data\wowsite.json, which the site follows by itself) ----------
        void EditSiteSettings()
        {
            var file = SiteConfigFile;
            var cfg = SiteConfig();
            Func<string, string, string> str = (k, def) => { object v; return cfg.TryGetValue(k, out v) && v != null && Convert.ToString(v).Length > 0 ? Convert.ToString(v) : def; };

            var dlg = new Form
            {
                Text = "WotLK website settings", FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false,
                StartPosition = FormStartPosition.CenterParent, ClientSize = new Size(560, 470), BackColor = Theme.Card, ForeColor = Theme.Text, Font = Theme.UI(9.5f),
                ShowInTaskbar = false,
            };
            dlg.HandleCreated += (o, e) => DarkTitleBar(dlg.Handle);
            int y = 20;
            Func<string, string, Control> label = (caption, hint) =>
            {
                dlg.Controls.Add(new Label { Text = caption, Font = Theme.Bold(9.5f), AutoSize = true, Location = new Point(24, y), BackColor = Theme.Card, ForeColor = Theme.Text });
                if (hint != null) dlg.Controls.Add(new Label { Text = hint, AutoSize = true, Location = new Point(24, y + 20), BackColor = Theme.Card, ForeColor = Theme.Muted, Font = Theme.UI(8.5f) });
                y += hint != null ? 42 : 22;
                return null;
            };
            Func<string, int, TextBox> box = (value, width) =>
            {
                var t = new TextBox { Text = value, Location = new Point(24, y), Width = width, BackColor = Theme.Raised, ForeColor = Theme.Text, BorderStyle = BorderStyle.FixedSingle };
                dlg.Controls.Add(t);
                y += 40;
                return t;
            };

            label("SPP folder", "Your SPP_Classics_V2 folder (or a cMaNGOS WotLK folder).");
            var root = box(str("root", ""), 400);
            var browse = new ModernButton("Browse…", ButtonKind.Secondary) { Location = new Point(434, root.Top - 4), Height = 30 };
            browse.Click += (o, e) =>
            {
                using (var fb = new FolderBrowserDialog { Description = "Choose your SPP_Classics_V2 folder", SelectedPath = root.Text })
                    if (fb.ShowDialog(dlg) == DialogResult.OK) root.Text = fb.SelectedPath;
            };
            dlg.Controls.Add(browse);
            label("Site name", null);
            var title = box(str("title", str("realmName", "World of Warcraft")), 300);
            label("Port", "Open http://localhost:<port>. Default 8091.");
            var port = box(str("port", "8091"), 100);
            label("Who can create game accounts on the site", null);
            var reg = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Location = new Point(24, y), Width = 510, BackColor = Theme.Raised, ForeColor = Theme.Text, FlatStyle = FlatStyle.Flat };
            var regValues = new[] { "off", "invite", "open" };
            reg.Items.AddRange(new object[] {
                "Nobody: only accounts made in the game or the panel (default)",
                "People with an invite code (GM accounts make codes on the site's Admin panel)",
                "Anyone who can open the site (not recommended for a public site)",
            });
            reg.SelectedIndex = Math.Max(0, Array.IndexOf(regValues, str("registration", "off")));
            dlg.Controls.Add(reg);
            y += 40;
            label("Discord invite link (optional)", null);
            var discord = box(str("discord", ""), 400);

            var save = new ModernButton("Save", ButtonKind.Primary);
            var cancel = new ModernButton("Cancel", ButtonKind.Ghost);
            save.Location = new Point(dlg.ClientSize.Width - save.Width - 24, dlg.ClientSize.Height - 54);
            cancel.Location = new Point(save.Left - cancel.Width - 8, save.Top);
            cancel.Click += (o, e) => dlg.Close();
            save.Click += (o, e) =>
            {
                int p;
                var folder = root.Text.Trim();
                if (folder.Length == 0 || !Directory.Exists(folder)) { MessageBox.Show(dlg, "Choose the SPP folder.", "WotLK website", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                if (!new[] { @"Settings\wotlk\mangosd.conf", @"SPP_Server\Settings\wotlk\mangosd.conf", "mangosd.conf", @"etc\mangosd.conf", @"bin\mangosd.conf" }.Any(f => File.Exists(Path.Combine(folder, f))))
                {
                    if (MessageBox.Show(dlg, "No mangosd.conf was found in that folder. Use it anyway?", "WotLK website", MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
                }
                if (!int.TryParse(port.Text.Trim(), out p) || p < 1024 || p > 65535) { MessageBox.Show(dlg, "The port must be a number from 1024 to 65535.", "WotLK website", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                if (p == panel.Port() || p == 3724 || p == 8085 || p == 3310) { MessageBox.Show(dlg, "Port " + p + " is used by the panel or the realm. Pick another, like 8091.", "WotLK website", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                var d = discord.Text.Trim();
                if (d.Length > 0 && !System.Text.RegularExpressions.Regex.IsMatch(d, @"^https://(discord\.gg|discord\.com)/[\w/-]+$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                {
                    MessageBox.Show(dlg, "The Discord link must look like https://discord.gg/abc123", "WotLK website", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return;
                }
                cfg["root"] = folder;
                cfg["title"] = title.Text.Trim().Length > 0 ? title.Text.Trim() : "World of Warcraft";
                cfg["port"] = p;
                cfg["registration"] = regValues[reg.SelectedIndex];
                cfg["discord"] = d;
                cfg.Remove("realmName");
                cfg.Remove("serverId");
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    File.WriteAllText(file, new JavaScriptSerializer().Serialize(cfg));
                }
                catch (Exception ex) { MessageBox.Show(dlg, "Couldn't save: " + ex.Message, "WotLK website", MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
                site.Write("Settings saved. The website applies them within a few seconds.");
                dlg.DialogResult = DialogResult.OK;
                dlg.Close();
            };
            dlg.Controls.Add(save);
            dlg.Controls.Add(cancel);
            dlg.AcceptButton = null;
            dlg.ShowDialog(this);
            RefreshCard(site);
        }

        // ---------- config ----------
        static IEnumerable<string> OnPath(string exe)
        {
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                string p = null;
                try { p = Path.Combine(dir.Trim().Trim('"'), exe); } catch { }
                if (p != null && File.Exists(p)) yield return p;
            }
        }

        internal static string FindNode()
        {
            var custom = Environment.GetEnvironmentVariable("ANDROMEDA_NODE"); // a Node.js somewhere unusual
            if (!string.IsNullOrEmpty(custom) && File.Exists(custom)) return custom;
            foreach (var p in OnPath("node.exe")) return p;
            foreach (var p in new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"nodejs\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"nodejs\node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe"),
            })
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }

        static Dictionary<string, object> ReadJson(string file)
        {
            try { return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(file)); }
            catch { return new Dictionary<string, object>(); }
        }

        static Dictionary<string, object> PanelConfig() { return ReadJson(Path.Combine(Program.PanelDir, "config.json")); }
        static string SiteConfigFile { get { return Path.Combine(Program.SiteDir, Path.Combine("data", "wowsite.json")); } }
        // Until the website has started once in its own folder, its settings are still where older
        // versions kept them, in Andromeda Hosting's data folder (the website copies them over).
        static Dictionary<string, object> SiteConfig()
        {
            return ReadJson(File.Exists(SiteConfigFile) ? SiteConfigFile : Path.Combine(DataDir(), "wowsite.json"));
        }

        static bool PanelHttps()
        {
            object h;
            var https = PanelConfig().TryGetValue("https", out h) ? h as Dictionary<string, object> : null;
            object cert;
            return https != null && https.TryGetValue("certFile", out cert) && cert is string && ((string)cert).Length > 0;
        }

        static string DataDir()
        {
            object d;
            var dir = PanelConfig().TryGetValue("dataDir", out d) && d is string ? (string)d : "./data";
            return Path.IsPathRooted(dir) ? dir : Path.GetFullPath(Path.Combine(Program.PanelDir, dir));
        }

        static int ConfigInt(Dictionary<string, object> c, string key, int def)
        {
            object v;
            if (!c.TryGetValue(key, out v) || v == null) return def;
            int n;
            return int.TryParse(Convert.ToString(v), out n) && n > 0 ? n : def;
        }

        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        static bool RunAtLogin()
        {
            try { using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("Andromeda Services") != null; }
            catch { return false; }
        }
        static void SetRunAtLogin(bool on)
        {
            try
            {
                using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
                {
                    if (on) k.SetValue("Andromeda Services", "\"" + Application.ExecutablePath + "\" --tray");
                    else k.DeleteValue("Andromeda Services", false);
                }
            }
            catch { }
        }
    }
}
