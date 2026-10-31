// install.exe: sets up Andromeda Hosting on this PC. It checks for Node.js, installs the packages,
// makes config.json and builds Andromeda Services (with its desktop and Start menu shortcuts).
//
// Built by "services\build.bat installer" together with AndromedaServices.cs, whose look (Theme,
// Card, ModernButton, Pill, Logo) and helpers it shares. Unlike Andromeda Services it is kept in
// the repository, so a fresh copy can be set up with a double-click. C# 5, like AndromedaServices.cs.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Andromeda Hosting setup")]
[assembly: AssemblyProduct("Andromeda Hosting")]
[assembly: AssemblyDescription("Sets up Andromeda Hosting and Andromeda Services")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace Andromeda
{
    static class InstallerProgram
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Program.Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
            if (!File.Exists(Path.Combine(Program.Root, Path.Combine("src", "index.js"))))
            {
                MessageBox.Show("install.exe must stay in the andromeda-hosting folder, next to the src folder.\n\nFolder: " + Program.Root, "Andromeda Hosting setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            Application.Run(new InstallerForm());
        }
    }

    class InstallerForm : Form
    {
        const string NodeUrl = "https://nodejs.org";
        static string ServicesExe { get { return Path.Combine(Program.Root, "Andromeda Services.exe"); } }

        // One line of the checklist: what it is, how it went, and a status pill.
        class Step
        {
            public Label Detail;
            public Pill Pill;
        }

        readonly Step[] steps;
        readonly Card stepCard;
        readonly TextBox logBox;
        readonly ModernButton primary, secondary, getNode;
        readonly Service log = new Service { Name = "Setup" };
        bool busy, done;

        public InstallerForm()
        {
            Text = "Andromeda Hosting setup";
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = Theme.UI(9.5f);
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            ClientSize = new Size(640, 620);
            StartPosition = FormStartPosition.CenterScreen;
            DoubleBuffered = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            var logo = new Logo { Size = new Size(44, 44), Location = new Point(28, 24) };
            var title = new Label { Text = "Set up Andromeda Hosting", Font = Theme.Bold(16f), AutoSize = true, Location = new Point(82, 20), ForeColor = Theme.Text, BackColor = Theme.Bg };
            var sub = new Label { Text = "Installs what the panel needs and adds Andromeda Services to your desktop.", AutoSize = true, Location = new Point(85, 56), ForeColor = Theme.Muted, BackColor = Theme.Bg, Font = Theme.UI(9f) };

            var names = new[] { "Node.js", "Packages", "Settings file", "Andromeda Services" };
            var waiting = new[] {
                "Version 20.10 or newer",
                "Downloads the panel's packages (needs internet)",
                "config.json, where the panel keeps its basic settings",
                "Builds the app that starts and stops everything",
            };
            stepCard = new Card { Location = new Point(28, 100), Size = new Size(584, 16 + names.Length * 60) };
            steps = new Step[names.Length];
            for (int i = 0; i < names.Length; i++)
            {
                int y = 12 + i * 60;
                stepCard.Controls.Add(new Label { Text = names[i], Font = Theme.Bold(10.5f), AutoSize = true, Location = new Point(20, y + 6), ForeColor = Theme.Text, BackColor = Theme.Card });
                var detail = new Label { Text = waiting[i], AutoSize = false, AutoEllipsis = true, Size = new Size(430, 20), Location = new Point(20, y + 30), ForeColor = Theme.Muted, BackColor = Theme.Card, Font = Theme.UI(9f) };
                var pill = new Pill { Top = y + 14 };
                stepCard.Controls.Add(detail);
                stepCard.Controls.Add(pill);
                steps[i] = new Step { Detail = detail, Pill = pill };
                SetPill(steps[i], "Waiting", Theme.Muted);
            }

            var logFrame = new Panel { Location = new Point(28, stepCard.Bottom + 16), Size = new Size(584, 540 - stepCard.Bottom), BackColor = Theme.LogBg, Padding = new Padding(12, 10, 4, 10) };
            logBox = new TextBox
            {
                Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, WordWrap = true,
                BackColor = Theme.LogBg, ForeColor = Color.FromArgb(200, 206, 218), BorderStyle = BorderStyle.None,
                Font = new Font("Consolas", 9f),
            };
            logFrame.Controls.Add(logBox);
            log.Output += line =>
            {
                if (!IsHandleCreated) { logBox.AppendText(line + "\r\n"); return; } // still being built
                try { BeginInvoke((Action)(() => logBox.AppendText(line + "\r\n"))); } catch { }
            };

            primary = new ModernButton("Install", ButtonKind.Primary);
            secondary = new ModernButton("Close", ButtonKind.Ghost);
            getNode = new ModernButton("Get Node.js", ButtonKind.Secondary) { Visible = false };
            primary.Click += (o, e) => { if (done) OpenServices(); else Install(); };
            secondary.Click += (o, e) => Close();
            getNode.Click += (o, e) => { try { Process.Start(new ProcessStartInfo(NodeUrl) { UseShellExecute = true }); } catch { } };
            PlaceButtons();

            Controls.AddRange(new Control[] { logo, title, sub, stepCard, logFrame, primary, secondary, getNode });
            HandleCreated += (o, e) => MainForm.DarkTitleBar(Handle);
            log.Write("Folder: " + Program.Root);
            log.Write("Press Install to set up Andromeda Hosting. Running it again later is safe: it keeps your settings.");
        }

        void PlaceButtons()
        {
            int y = ClientSize.Height - 54;
            primary.Location = new Point(ClientSize.Width - 28 - primary.Width, y);
            secondary.Location = new Point(primary.Left - 8 - secondary.Width, y);
            getNode.Location = new Point(28, y);
        }

        void SetPill(Step s, string text, Color tone)
        {
            s.Pill.Set(text, tone);
            s.Pill.Left = stepCard.Width - s.Pill.Width - 20;
        }

        // May run on any thread.
        void Mark(int i, string state, string detail)
        {
            Action a = () =>
            {
                var tone = state == "Done" ? Theme.Green : state == "Failed" ? Theme.Red : state == "Working…" ? Theme.Blue : Theme.Muted;
                SetPill(steps[i], state, tone);
                if (detail != null) steps[i].Detail.Text = detail;
            };
            if (InvokeRequired) BeginInvoke(a); else a();
        }

        void Install()
        {
            if (busy) return;
            if (Process.GetProcessesByName("Andromeda Services").Length > 0)
            {
                MessageBox.Show(this, "Andromeda Services is open. Exit it first (right-click its tray icon, then Stop all and exit), then press Install again.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            busy = true;
            primary.Enabled = false;
            secondary.Enabled = false;
            getNode.Visible = false;
            for (int i = 0; i < steps.Length; i++) Mark(i, "Waiting", null);
            var t = new Thread(() =>
            {
                string failure = null;
                try { failure = RunSteps(); }
                catch (Exception ex) { failure = ex.Message; }
                try { BeginInvoke((Action)(() => Finish(failure))); } catch { }
            });
            t.IsBackground = true;
            t.Start();
        }

        // Returns null when everything worked, or what went wrong.
        string RunSteps()
        {
            log.Write("──── setting up ────");

            Mark(0, "Working…", "Looking for Node.js…");
            var node = MainForm.FindNode();
            if (node == null)
            {
                Mark(0, "Failed", "Not installed. Get the LTS version, install it, then press Try again.");
                return "node";
            }
            var version = MainForm.Run(node, "-v", null, 15000).LastLine;
            if (!NodeIsNewEnough(version))
            {
                Mark(0, "Failed", "Found " + version + ", but 20.10 or newer is needed. Install the LTS version.");
                return "node";
            }
            log.Write("Using Node.js " + version + ": " + node);
            Mark(0, "Done", version + " · " + node);

            Mark(1, "Working…", "Downloading packages, this can take a minute…");
            var npm = Path.Combine(Path.GetDirectoryName(node), "npm.cmd");
            var r = MainForm.Run("cmd.exe", "/d /s /c \"\"" + (File.Exists(npm) ? npm : "npm") + "\" install --omit=dev --no-audit --no-fund\"", log, 900000);
            if (!r.Ok)
            {
                Mark(1, "Failed", "npm install failed: " + r.LastLine);
                return "npm install failed. Check your internet connection and the log, then try again.";
            }
            Mark(1, "Done", "Installed");

            Mark(2, "Working…", null);
            var config = Path.Combine(Program.Root, "config.json");
            if (File.Exists(config)) Mark(2, "Done", "Kept your config.json");
            else
            {
                File.Copy(Path.Combine(Program.Root, "config.example.json"), config);
                log.Write("Made config.json from config.example.json.");
                Mark(2, "Done", "Made config.json (open it to keep game servers on another drive)");
            }

            Mark(3, "Working…", "Building Andromeda Services.exe…");
            var build = Path.Combine(Program.Root, Path.Combine("services", "build.bat"));
            r = MainForm.Run("cmd.exe", "/d /s /c \"\"" + build + "\" shortcut\"", log, 180000);
            if (!r.Ok || !File.Exists(ServicesExe))
            {
                Mark(3, "Failed", r.LastLine);
                return "Building Andromeda Services failed: " + r.LastLine;
            }
            Mark(3, "Done", r.LastLine.TrimEnd('.'));
            log.Write("──── all set ────");
            return null;
        }

        static bool NodeIsNewEnough(string version)
        {
            var parts = version.TrimStart('v').Split('.');
            int major, minor;
            if (parts.Length < 2 || !int.TryParse(parts[0], out major) || !int.TryParse(parts[1], out minor)) return false;
            return major > 20 || (major == 20 && minor >= 10);
        }

        void Finish(string failure)
        {
            busy = false;
            primary.Enabled = true;
            secondary.Enabled = true;
            if (failure == null)
            {
                done = true;
                primary.Text = "Open Andromeda Services";
                log.Write("Open Andromeda Services, then go to http://localhost:8080 on this PC to create your admin account.");
            }
            else
            {
                primary.Text = "Try again";
                if (failure == "node")
                {
                    getNode.Visible = true;
                    log.Write("Node.js is needed. Get the LTS version from " + NodeUrl + ", install it, then press Try again.");
                }
                else log.Write(failure);
            }
            PlaceButtons();
        }

        void OpenServices()
        {
            try { Process.Start(new ProcessStartInfo(ServicesExe) { UseShellExecute = true, WorkingDirectory = Program.Root }); }
            catch (Exception ex) { MessageBox.Show(this, "Couldn't open Andromeda Services: " + ex.Message, Text, MessageBoxButtons.OK, MessageBoxIcon.Error); return; }
            Close();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (busy && e.CloseReason == CloseReason.UserClosing) e.Cancel = true; // let npm / the build finish
            base.OnFormClosing(e);
        }
    }
}
