// Andromeda Services: a Windows app that starts and stops Andromeda Hosting (the panel) and the
// WotLK website, shows their logs, and sits in the system tray, so nothing needs a console window.
//
// Built by services\build.bat with the C# compiler that ships with Windows (.NET Framework 4), so
// it is written for C# 5 (no string interpolation, no ?. operator).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: AssemblyTitle("Andromeda Services")]
[assembly: AssemblyProduct("Andromeda Services")]
[assembly: AssemblyDescription("Starts and stops Andromeda Hosting and the WotLK website")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace Andromeda
{
    enum State { Stopped, Starting, Running, Stopping, External, Crashed, Waiting }

    // One Node.js process the app looks after: the panel or the website.
    class Service
    {
        public string Name;
        public string Script;           // relative to the andromeda-hosting folder
        public int StopWaitSeconds;     // how long a clean stop may take before it is forced
        public Func<int> Port;          // where it listens (read from its config each time)
        public Func<string> Url;
        public State State = State.Stopped;
        public Process Proc;
        public bool StopRequested;
        public event Action<string> Output;
        public event Action Changed;

        public void Log(string line) { var h = Output; if (h != null) h(line); }
        public void SetState(State s) { State = s; var h = Changed; if (h != null) h(); }
        public bool Alive { get { return Proc != null && !Proc.HasExited; } }
    }

    static class Program
    {
        public static string Root;      // the andromeda-hosting folder (next to this .exe)

        [STAThread]
        static void Main()
        {
            bool first;
            var mutex = new Mutex(true, "AndromedaServices.SingleInstance", out first);
            var show = new EventWaitHandle(false, EventResetMode.AutoReset, "AndromedaServices.Show");
            if (!first) { show.Set(); return; } // already open: bring that window forward instead

            Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            if (!File.Exists(Path.Combine(Root, "src", "index.js")))
            {
                var parent = Path.GetDirectoryName(Root);
                if (parent != null && File.Exists(Path.Combine(parent, "src", "index.js"))) Root = parent;
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (!File.Exists(Path.Combine(Root, "src", "index.js")))
            {
                MessageBox.Show("Andromeda Services must be in the andromeda-hosting folder (next to start.bat).\n\nFolder: " + Root, "Andromeda Services", MessageBoxButtons.OK, MessageBoxIcon.Error);
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

    class MainForm : Form
    {
        static readonly Color Bg = Color.FromArgb(18, 20, 26);
        static readonly Color Card = Color.FromArgb(28, 31, 40);
        static readonly Color Text1 = Color.FromArgb(232, 234, 240);
        static readonly Color Muted = Color.FromArgb(150, 156, 172);
        static readonly Color Accent = Color.FromArgb(255, 106, 61);
        const int RestartCode = 75; // the panel exits with this after installing an update

        readonly Service panel;
        readonly Service site;
        readonly Settings settings;
        readonly NotifyIcon tray;
        readonly TabControl logs;
        readonly Dictionary<Service, TextBox> logBoxes = new Dictionary<Service, TextBox>();
        readonly Dictionary<Service, Label> statusLabels = new Dictionary<Service, Label>();
        readonly Dictionary<Service, Label> urlLabels = new Dictionary<Service, Label>();
        readonly Dictionary<Service, Button[]> buttons = new Dictionary<Service, Button[]>();
        readonly System.Windows.Forms.Timer poll;
        string node;
        bool exiting;
        bool trayHintShown;

        public MainForm(EventWaitHandle show)
        {
            settings = new Settings(Path.Combine(DataDir(), "services.ini"));
            panel = new Service
            {
                Name = "Andromeda Hosting",
                Script = Path.Combine("src", "index.js"),
                StopWaitSeconds = 300, // game servers are saved and stopped first
                Port = () => ConfigInt(PanelConfig(), "port", 8080),
                Url = () => (PanelHttps() ? "https" : "http") + "://localhost:" + ConfigInt(PanelConfig(), "port", 8080),
            };
            site = new Service
            {
                Name = "WotLK website",
                Script = Path.Combine("src", "wowsite", "index.js"),
                StopWaitSeconds = 15,
                Port = () => ConfigInt(SiteConfig(), "port", 8091),
                Url = () => "http://localhost:" + ConfigInt(SiteConfig(), "port", 8091),
            };

            Text = "Andromeda Services";
            BackColor = Bg;
            ForeColor = Text1;
            Font = new Font("Segoe UI", 9.5f);
            MinimumSize = new Size(760, 560);
            Size = new Size(900, 680);
            StartPosition = FormStartPosition.CenterScreen;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            var header = new Panel { Dock = DockStyle.Top, Height = 64, BackColor = Bg, Padding = new Padding(18, 12, 18, 0) };
            var title = new Label { Text = "Andromeda Services", Font = new Font("Segoe UI Semibold", 16f), AutoSize = true, Location = new Point(18, 10), ForeColor = Text1 };
            var subtitle = new Label { Text = "Start and stop the panel and the WotLK website. Closing this window keeps them running in the tray.", AutoSize = true, Location = new Point(20, 40), ForeColor = Muted };
            header.Controls.Add(title);
            header.Controls.Add(subtitle);

            var cards = new TableLayoutPanel { Dock = DockStyle.Top, Height = 250, ColumnCount = 1, RowCount = 2, Padding = new Padding(14, 6, 14, 6), BackColor = Bg };
            cards.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
            cards.RowStyles.Add(new RowStyle(SizeType.Percent, 50));
            cards.Controls.Add(BuildCard(panel, "The control panel for all your game servers.", "autostart.panel"), 0, 0);
            cards.Controls.Add(BuildCard(site, "The classic WotLK site: news, armory, realm status, sign-up.", "autostart.site"), 0, 1);

            logs = new TabControl { Dock = DockStyle.Fill, Padding = new Point(12, 4) };
            foreach (var s in new[] { panel, site })
            {
                var page = new TabPage(s.Name + " log") { BackColor = Card };
                var box = new TextBox
                {
                    Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, WordWrap = true,
                    BackColor = Color.FromArgb(12, 13, 17), ForeColor = Color.FromArgb(205, 210, 220), BorderStyle = BorderStyle.None,
                    Font = new Font("Consolas", 9f),
                };
                page.Controls.Add(box);
                logs.TabPages.Add(page);
                logBoxes[s] = box;
                var svc = s;
                s.Output += line => AppendLog(svc, line);
                s.Changed += () => RefreshCard(svc);
            }
            var logWrap = new Panel { Dock = DockStyle.Fill, Padding = new Padding(14, 4, 14, 4), BackColor = Bg };
            logWrap.Controls.Add(logs);

            var footer = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, Padding = new Padding(14, 8, 14, 6), BackColor = Bg, FlowDirection = FlowDirection.LeftToRight };
            var startup = new CheckBox { Text = "Open Andromeda Services when I sign in to Windows", AutoSize = true, ForeColor = Text1, Checked = RunAtLogin(), Margin = new Padding(0, 6, 24, 0) };
            startup.CheckedChanged += (o, e) => SetRunAtLogin(startup.Checked);
            var folder = MakeButton("Open folder", false);
            folder.Click += (o, e) => Process.Start("explorer.exe", "\"" + Program.Root + "\"");
            var exit = MakeButton("Stop all and exit", false);
            exit.Click += (o, e) => ExitApp();
            footer.Controls.Add(startup);
            footer.Controls.Add(folder);
            footer.Controls.Add(exit);

            Controls.Add(logWrap);
            Controls.Add(footer);
            Controls.Add(cards);
            Controls.Add(header);

            tray = new NotifyIcon { Text = "Andromeda Services", Icon = Icon ?? SystemIcons.Application, Visible = true };
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Andromeda Services", null, (o, e) => ShowWindow());
            menu.Items.Add("Open the panel", null, (o, e) => OpenUrl(panel.Url()));
            menu.Items.Add("Open the WotLK website", null, (o, e) => OpenUrl(site.Url()));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Start both", null, (o, e) => { Start(panel); Start(site); });
            menu.Items.Add("Stop both", null, (o, e) => { Stop(site); Stop(panel); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Stop all and exit", null, (o, e) => ExitApp());
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += (o, e) => ShowWindow();

            // A second copy of the app was opened: show this window instead.
            var waiter = new Thread(() => { while (true) { show.WaitOne(); try { BeginInvoke((Action)ShowWindow); } catch { return; } } });
            waiter.IsBackground = true;
            waiter.Start();

            poll = new System.Windows.Forms.Timer { Interval = 2000 };
            poll.Tick += (o, e) => PollPorts();
            poll.Start();

            SystemEvents.SessionEnding += (o, e) => { exiting = true; StopAllAndWait(60); };
            Load += (o, e) =>
            {
                node = FindNode();
                foreach (var s in new[] { panel, site }) RefreshCard(s);
                if (node == null)
                {
                    AppendLog(panel, "Node.js was not found. Install the LTS version from https://nodejs.org, then reopen Andromeda Services.");
                    return;
                }
                AppendLog(panel, "Using Node.js: " + node);
                try
                {
                    // Updates replace the source; the app itself is only rebuilt by update.bat or build.bat.
                    var src = Path.Combine(Program.Root, Path.Combine("services", "AndromedaServices.cs"));
                    if (File.Exists(src) && File.GetLastWriteTimeUtc(src) > File.GetLastWriteTimeUtc(Application.ExecutablePath).AddMinutes(1))
                        AppendLog(panel, "A newer Andromeda Services came with an update: exit this app (Stop all and exit), run services\\build.bat, and open it again.");
                }
                catch { }
                if (settings.Get("autostart.panel", true)) Start(panel);
                if (settings.Get("autostart.site", true)) Start(site);
            };
        }

        // ---------- layout ----------
        Control BuildCard(Service s, string description, string autoKey)
        {
            var card = new Panel { Dock = DockStyle.Fill, BackColor = Card, Margin = new Padding(0, 4, 0, 4), Padding = new Padding(16, 10, 16, 10) };
            var name = new Label { Text = s.Name, Font = new Font("Segoe UI Semibold", 12f), AutoSize = true, Location = new Point(16, 10), ForeColor = Text1 };
            var status = new Label { Text = "Stopped", AutoSize = true, Location = new Point(18, 38), ForeColor = Muted, Font = new Font("Segoe UI Semibold", 9.5f) };
            var desc = new Label { Text = description, AutoSize = true, Location = new Point(18, 60), ForeColor = Muted };
            var url = new LinkLabel { Text = "", AutoSize = true, Location = new Point(18, 80), LinkColor = Accent, ActiveLinkColor = Text1 };
            url.LinkClicked += (o, e) => OpenUrl(s.Url());
            var auto = new CheckBox { Text = "Start when Andromeda Services opens", AutoSize = true, ForeColor = Muted, Checked = settings.Get(autoKey, true), Margin = new Padding(6, 10, 0, 0) };
            auto.CheckedChanged += (o, e) => settings.Set(autoKey, auto.Checked);

            var start = MakeButton("Start", true);
            var stop = MakeButton("Stop", false);
            var restart = MakeButton("Restart", false);
            var open = MakeButton("Open", false);
            start.Click += (o, e) => Start(s);
            stop.Click += (o, e) => Stop(s);
            restart.Click += (o, e) => Restart(s);
            open.Click += (o, e) => OpenUrl(s.Url());
            var row = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, BackColor = Card, WrapContents = false, Margin = new Padding(0) };
            row.Controls.AddRange(new Control[] { start, stop, restart, open });
            // Buttons and the auto-start box stack on the right; the labels stay on the left.
            var right = new FlowLayoutPanel { Dock = DockStyle.Right, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Card };
            right.Controls.Add(row);
            right.Controls.Add(auto);

            card.Controls.AddRange(new Control[] { right, name, status, desc, url });
            statusLabels[s] = status;
            urlLabels[s] = url;
            buttons[s] = new[] { start, stop, restart, open };
            return card;
        }

        static Button MakeButton(string text, bool primary)
        {
            var b = new Button
            {
                Text = text, AutoSize = true, FlatStyle = FlatStyle.Flat, Height = 30, Padding = new Padding(8, 0, 8, 0), Margin = new Padding(6, 0, 0, 0),
                BackColor = primary ? Accent : Color.FromArgb(44, 48, 60), ForeColor = primary ? Color.White : Text1, Cursor = Cursors.Hand,
            };
            b.FlatAppearance.BorderSize = 0;
            return b;
        }

        void RefreshCard(Service s)
        {
            if (InvokeRequired) { BeginInvoke((Action)(() => RefreshCard(s))); return; }
            var label = statusLabels[s];
            string text;
            Color color;
            switch (s.State)
            {
                case State.Starting: text = "● Starting…"; color = Color.FromArgb(240, 190, 70); break;
                case State.Running: text = "● Running"; color = Color.FromArgb(80, 200, 120); break;
                case State.Stopping: text = "● Stopping… (saving first)"; color = Color.FromArgb(240, 190, 70); break;
                case State.External: text = "● Running (started outside Andromeda Services)"; color = Color.FromArgb(120, 170, 240); break;
                case State.Crashed: text = "● Stopped unexpectedly — see the log"; color = Color.FromArgb(240, 90, 80); break;
                case State.Waiting: text = "● Waiting: no WoW server has its website turned on in the panel"; color = Color.FromArgb(240, 190, 70); break;
                default: text = "● Stopped"; color = Muted; break;
            }
            label.Text = text;
            label.ForeColor = color;
            urlLabels[s].Text = s.Url();
            var b = buttons[s];
            bool running = s.State == State.Running || s.State == State.Starting || s.State == State.Waiting;
            b[0].Enabled = node != null && (s.State == State.Stopped || s.State == State.Crashed); // start
            b[1].Enabled = running;                                                                 // stop
            b[2].Enabled = node != null && s.State == State.Running;                                // restart
            b[3].Enabled = s.State == State.Running || s.State == State.External;                   // open
            foreach (var btn in b) btn.BackColor = btn == b[0] ? (btn.Enabled ? Accent : Color.FromArgb(92, 60, 50)) : (btn.Enabled ? Color.FromArgb(44, 48, 60) : Color.FromArgb(34, 37, 46));
            int up = 0;
            if (panel.State == State.Running || panel.State == State.External) up++;
            if (site.State == State.Running || site.State == State.External) up++;
            if (tray != null) tray.Text = "Andromeda Services — " + up + " of 2 running";
        }

        void AppendLog(Service s, string line)
        {
            if (line == null) return;
            if (InvokeRequired) { BeginInvoke((Action)(() => AppendLog(s, line))); return; }
            var box = logBoxes[s];
            if (box.TextLength > 400000) box.Text = box.Text.Substring(box.TextLength - 200000); // keep the window light
            box.AppendText(line.TrimEnd('\r', '\n') + Environment.NewLine);
        }

        // ---------- processes ----------
        void Start(Service s)
        {
            if (node == null || s.Alive) return;
            if (PortInUse(s.Port()))
            {
                s.SetState(State.External);
                AppendLog(s, "Port " + s.Port() + " is already in use, so " + s.Name + " seems to be running already (for example from start.bat). Close that one first to manage it here.");
                return;
            }
            if (!Directory.Exists(Path.Combine(Program.Root, "node_modules")))
            {
                s.SetState(State.Starting);
                AppendLog(s, "First start: installing packages (needs internet, one time)...");
                RunNpmInstall(s, () => BeginInvoke((Action)(() => Launch(s))));
                return;
            }
            Launch(s);
        }

        void Launch(Service s)
        {
            var psi = new ProcessStartInfo(node, "\"" + s.Script + "\"")
            {
                WorkingDirectory = Program.Root,
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
                AppendLog(s, "Could not start: " + ex.Message);
                s.SetState(State.Crashed);
                return;
            }
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            s.Proc = p;
            s.StopRequested = false;
            s.SetState(State.Starting);
            AppendLog(s, "---- starting " + s.Name + " ----");
        }

        void OnOutput(Service s, string line)
        {
            if (line == null) return;
            AppendLog(s, line);
            if ((s.State == State.Starting || s.State == State.Waiting) && line.Contains(" is running at ")) s.SetState(State.Running);
            else if (s.State == State.Starting && line.Contains("No WoW server has its website turned on")) s.SetState(State.Waiting);
        }

        void OnExited(Service s, Process p)
        {
            int code = -1;
            try { code = p.ExitCode; } catch { }
            if (s.Proc != p) return;
            s.Proc = null;
            if (!s.StopRequested && s == panel && code == RestartCode)
            {
                AppendLog(s, "Restarting after an update...");
                BeginInvoke((Action)(() => Launch(s)));
                return;
            }
            AppendLog(s, "---- " + s.Name + " stopped (exit code " + code + ") ----");
            s.SetState(s.StopRequested || code == 0 ? State.Stopped : State.Crashed);
        }

        void Stop(Service s)
        {
            if (!s.Alive) { if (s.State == State.External) AppendLog(s, "It was started outside Andromeda Services; stop it where it was started."); return; }
            s.StopRequested = true;
            s.SetState(State.Stopping);
            AppendLog(s, "Stopping " + s.Name + (s == panel ? " (running game servers are saved and stopped first)..." : "..."));
            try { s.Proc.StandardInput.WriteLine("stop"); s.Proc.StandardInput.Flush(); } catch { }
            var proc = s.Proc;
            var watch = new Thread(() =>
            {
                if (!proc.WaitForExit(s.StopWaitSeconds * 1000))
                {
                    AppendLog(s, "Didn't stop in time; forcing it.");
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
            Stop(s);
            var t = new Thread(() => { proc.WaitForExit(); Thread.Sleep(500); try { BeginInvoke((Action)(() => Start(s))); } catch { } });
            t.IsBackground = true;
            t.Start();
        }

        void StopAllAndWait(int seconds)
        {
            Stop(site);
            Stop(panel);
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

        void RunNpmInstall(Service s, Action done)
        {
            var npm = Path.Combine(Path.GetDirectoryName(node), "npm.cmd");
            var psi = new ProcessStartInfo("cmd.exe", "/c \"\"" + (File.Exists(npm) ? npm : "npm") + "\" install --omit=dev --no-audit --no-fund\"")
            {
                WorkingDirectory = Program.Root, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardOutput = true, RedirectStandardError = true,
            };
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (o, e) => AppendLog(s, e.Data);
            p.ErrorDataReceived += (o, e) => AppendLog(s, e.Data);
            p.Exited += (o, e) =>
            {
                if (p.ExitCode == 0) done();
                else { AppendLog(s, "npm install failed. Run install.bat once, then try again."); s.SetState(State.Crashed); }
            };
            try { p.Start(); p.BeginOutputReadLine(); p.BeginErrorReadLine(); }
            catch (Exception ex) { AppendLog(s, "Could not run npm: " + ex.Message); s.SetState(State.Crashed); }
        }

        // Catches services started elsewhere, and ones whose "running" line was missed.
        void PollPorts()
        {
            foreach (var s in new[] { panel, site })
            {
                if (s.Alive && (s.State == State.Starting || s.State == State.Waiting) && PortInUse(s.Port())) s.SetState(State.Running);
                else if (!s.Alive && (s.State == State.Stopped || s.State == State.External)) s.SetState(PortInUse(s.Port()) ? State.External : State.Stopped);
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
                    bool ok = r.AsyncWaitHandle.WaitOne(300) && c.Connected;
                    return ok;
                }
            }
            catch { return false; }
        }

        // ---------- window, tray, exit ----------
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
                StopAllAndWait(330);
                try { BeginInvoke((Action)(() => { tray.Visible = false; Close(); Application.Exit(); })); } catch { }
            });
            t.IsBackground = true;
            t.Start();
        }

        static void OpenUrl(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }

        // ---------- config ----------
        static string FindNode()
        {
            var custom = Environment.GetEnvironmentVariable("ANDROMEDA_NODE"); // a Node.js somewhere unusual
            if (!string.IsNullOrEmpty(custom) && File.Exists(custom)) return custom;
            foreach (var dir in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';'))
            {
                try
                {
                    var p = Path.Combine(dir.Trim().Trim('"'), "node.exe");
                    if (File.Exists(p)) return p;
                }
                catch { }
            }
            foreach (var p in new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "nodejs", "node.exe"),
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

        static Dictionary<string, object> PanelConfig() { return ReadJson(Path.Combine(Program.Root, "config.json")); }
        static Dictionary<string, object> SiteConfig() { return ReadJson(Path.Combine(DataDir(), "wowsite.json")); }

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
            return Path.IsPathRooted(dir) ? dir : Path.GetFullPath(Path.Combine(Program.Root, dir));
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
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("Andromeda Services") != null;
        }
        static void SetRunAtLogin(bool on)
        {
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (on) k.SetValue("Andromeda Services", "\"" + Application.ExecutablePath + "\"");
                else k.DeleteValue("Andromeda Services", false);
            }
        }
    }
}
