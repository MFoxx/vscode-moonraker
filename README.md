<h1 align="center">
  <br>
  🖨️ Moonraker 3D Printer Monitor
  <br>
</h1>

<p align="center">
  <strong>Your 3D printer, right inside VS Code.</strong><br>
  Monitor prints, track temperatures, control your machine — without leaving your editor.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=mfoxx.vscode-moonraker">
    <img src="https://img.shields.io/visual-studio-marketplace/v/mfoxx.vscode-moonraker?style=flat-square&label=VS%20Marketplace&color=blue" alt="Marketplace Version">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=mfoxx.vscode-moonraker">
    <img src="https://img.shields.io/visual-studio-marketplace/d/mfoxx.vscode-moonraker?style=flat-square&label=Downloads&color=green" alt="Downloads">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=mfoxx.vscode-moonraker">
    <img src="https://img.shields.io/visual-studio-marketplace/r/mfoxx.vscode-moonraker?style=flat-square&label=Rating&color=orange" alt="Rating">
  </a>
  <a href="https://github.com/mfoxx/vscode-moonraker/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/mfoxx/vscode-moonraker/ci.yml?style=flat-square&label=CI" alt="CI Status">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
  </a>
</p>

<p align="center">
  <a href="#-features">Features</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#%EF%B8%8F-configuration">Configuration</a> •
  <a href="#-experimental-features">Experimental</a> •
  <a href="#%EF%B8%8F-planned-features">Roadmap</a> •
  <a href="#-contributing">Contributing</a> •
  <a href="#-support">Support</a>
</p>

---

<p align="center">
  <img src="https://raw.githubusercontent.com/mfoxx/vscode-moonraker/main/images/preview.png" alt="Moonraker 3D Printer Monitor preview" width="100%">
</p>

---

## ✨ Features

### 🌡️ Live Temperature Dashboard
Stop alt-tabbing to your slicer or browser. The sidebar panel shows **hotend, bed, and chamber temperatures** in real time, complete with target temps and a **scrolling history chart**. Know exactly when your printer is ready.

### 📊 Print Progress at a Glance
- **Progress bar** with percentage and live **layer count** (`Layer 42 / 210`)
- **ETA** and **finish time** so you can plan your day around the print, not the other way around
- **Elapsed time**, filament used, print speed, and fan speed — all visible without touching your browser

### 🖼️ Thumbnail Previews
Automatically fetches the **G-code thumbnail** for the currently printing file and displays it in the sidebar. You always know what's on the plate.

### 📁 Recent Print History
A collapsible section shows your **last 5 prints** — filename, duration, completion date, and whether they succeeded or failed. Collapsed by default, out of the way when you don't need it.

### 🔔 Smart Notifications
Never miss a state change. VS Code toast notifications tell you when:
- ✅ A print **starts** or **resumes**
- ⏸️ A print is **paused**
- 🏁 A print **finishes**
- ❌ A print is **cancelled** or hits an **error**

### 🌐 Web UI Shortcut
Configure your Mainsail or Fluidd URL once and get a **one-click button** in the sidebar to open it. Customize the label too (`Open Mainsail`, `Open Fluidd`, whatever you like).

### 📍 Status Bar Integration
Keep an eye on your printer without even opening the sidebar. The **status bar** shows printer state, temperatures, filename, ETA, and elapsed time. Every item is individually configurable — show only what matters to you.

---

## 🗺️ Planned Features

These are features actively planned for future releases. Have a suggestion? [Open an issue!](https://github.com/mfoxx/vscode-moonraker/issues)

| Feature | Description |
|---|---|
| 🔐 **Authentication / API token** | Connect to Moonraker instances secured with an API key or trusted clients config |
| 📷 **Webcam snapshot** | Display a periodically refreshed camera image in the sidebar so you can see your print at a glance |
| 🎛️ **Klipper macro buttons** | Auto-discover and expose your custom Klipper macros as one-click sidebar buttons |
| 🖨️ **Multi-printer support** | Monitor and switch between multiple printers from a single VS Code sidebar |
| ▶️ **Print queue & quick-start** | Browse files already on the printer and start or queue a print without opening the web UI |

---

## 🧪 Experimental Features

> ⚠️ **Use at your own risk.** Experimental features send commands directly to your printer. Enabled via `moonraker.experimental.enabled`.

### 🛑 Emergency Stop
A big red **Emergency Stop** button. Sends `/printer/emergency_stop` immediately. Requires confirmation — no accidental taps.

### 🏠 Home All Axes (G28)
Homes all axes with a single click. Available when the printer is idle (not while printing).

### 🔥 Heat Bed & Extruder
Set temperatures directly from the sidebar:
- **Heat** (`M140` / `M104`) — set target and continue
- **Heat & Wait** (`M190` / `M109`) — set target and block until reached

### ⚡ Speed Factor & Fan Speed
Adjust **print speed** (50–150%) and **fan speed** (0–100%) while printing. Changes take effect immediately via `M220` and `M106`.

### 🎯 Live Toolhead Position
An isometric 3D visualization of the print bed updates in real time at up to 60 fps with smooth interpolation between position samples. Accurately represents your printer's mechanics — the **bed position on X**, the **gantry on Y and Z** — rendered as separate moving elements. Configurable for any bed size.

---

## 📦 Installation

**Via VS Code Marketplace** *(recommended)*

Search for **"Moonraker 3D Printer Monitor"** in the Extensions panel, or install directly:

```
ext install mfoxx.vscode-moonraker
```

**Via VSIX** *(manual install)*

Download the latest `.vsix` from [Releases](https://github.com/mfoxx/vscode-moonraker/releases), then:

```
code --install-extension vscode-moonraker-x.x.x.vsix
```

---

## 🚀 Quick Start

1. **Install** the extension
2. Open **Settings** (`Ctrl+,` / `Cmd+,`) and search for `moonraker`
3. Set `moonraker.apiUrl` to your printer's IP — e.g. `http://192.168.1.100`
4. The extension **auto-connects on startup** — look for the 🖨️ icon in the activity bar

That's it. No config files, no setup scripts.

---

## ⚙️ Configuration

| Setting | Default | Description |
|---|---|---|
| `moonraker.apiUrl` | `http://localhost` | Moonraker API base URL (no port) |
| `moonraker.port` | `7125` | Moonraker API port |
| `moonraker.pollingInterval` | `2000` | Status poll interval in ms |
| `moonraker.temperatureHistorySize` | `120` | Number of points in the temperature chart |
| `moonraker.chamberSensorName` | _(empty)_ | Klipper `temperature_sensor` name for chamber monitoring |
| `moonraker.webUiUrl` | _(empty)_ | URL of your Mainsail/Fluidd instance |
| `moonraker.webUiLabel` | `Open Web UI` | Label on the Web UI sidebar button |
| `moonraker.notifications.enabled` | `true` | Enable/disable state-change notifications |
| `moonraker.statusBar.showStatus` | `true` | Show printer state in status bar |
| `moonraker.statusBar.showHotendTemp` | `true` | Show hotend temp in status bar |
| `moonraker.statusBar.showBedTemp` | `true` | Show bed temp in status bar |
| `moonraker.statusBar.showFileName` | `true` | Show current filename in status bar |
| `moonraker.statusBar.showETA` | `true` | Show ETA in status bar |
| `moonraker.statusBar.showTotalTime` | `true` | Show elapsed time in status bar |
| `moonraker.experimental.enabled` | `false` | Enable experimental printer controls |
| `moonraker.experimental.positionVisualization` | `false` | Enable the 3D toolhead position view |
| `moonraker.bedWidth` | `235` | Bed width in mm (for position visualization) |
| `moonraker.bedHeight` | `235` | Bed height in mm (for position visualization) |
| `moonraker.positionPollingInterval` | `100` | Position poll interval in ms (min 50) |

---

## 🤝 Contributing

Contributions are very welcome! Whether it's a bug report, a feature request, or a pull request — all are appreciated.

### Reporting Bugs / Requesting Features

Please [open an issue](https://github.com/mfoxx/vscode-moonraker/issues) and include:
- Your Moonraker/Klipper version
- Your printer configuration (if relevant)
- Steps to reproduce the problem
- What you expected vs. what happened

### Submitting a Pull Request

1. **Fork** the repo and create a branch from `main`
2. **Install dependencies** — `npm install`
3. **Make your changes** in `src/`
4. **Compile** — `npm run compile` (or `npm run watch` for live recompile)
5. **Run tests** — `npm test`
6. Open a PR with a clear description of what changed and why

### Development Setup

```bash
git clone https://github.com/mfoxx/vscode-moonraker.git
cd vscode-moonraker
npm install

# Watch mode (recompiles on save)
npm run watch

# Then press F5 in VS Code to launch an Extension Development Host
```

### Project Structure

```
src/
├── extension.ts        # Entry point, command registration, event wiring
├── moonrakerClient.ts  # Moonraker HTTP polling, event emitter
├── sidebarProvider.ts  # Webview sidebar (HTML/CSS/JS)
├── statusBar.ts        # Status bar items
└── test/               # Jest unit tests
```

---

## 💖 Support

If this extension saves you time or makes your workflow better, consider buying me a coffee! It keeps the project maintained and new features coming.

<a href="https://www.buymeacoffee.com/MFoxx">
  <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-ffdd00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee">
</a>

---

## 📄 License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<p align="center">
  Made with ❤️ for the Klipper community
</p>
