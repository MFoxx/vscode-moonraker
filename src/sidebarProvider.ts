import * as vscode from 'vscode';
import { PrinterStatus, TemperaturePoint, PrintHistoryEntry, ToolheadPosition, JobQueueStatus } from './moonrakerClient';

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private lastStatus?: PrinterStatus;
  private lastTempHistory?: TemperaturePoint[];
  private lastPrintHistory: PrintHistoryEntry[] = [];
  private lastMacros: string[] = [];
  private lastJobQueue?: JobQueueStatus;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.buildHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg) => {
      if (msg.type === 'ready') {
        if (this.lastStatus && this.lastTempHistory) {
          this.send(this.lastStatus, this.lastTempHistory, this.lastPrintHistory);
          if (this.lastMacros.length) {
            this.view?.webview.postMessage({ type: 'macros', macros: this.lastMacros });
          }
          if (this.lastJobQueue) {
            this.view?.webview.postMessage({ type: 'jobQueue', ...this.lastJobQueue });
          }
        } else {
          this.sendDisconnected();
        }
      } else if (msg.type === 'openWebUI') {
        void vscode.commands.executeCommand('moonraker.openWebUI');
      } else if (msg.type === 'showLogs') {
        void vscode.commands.executeCommand('moonraker.showLogs');
      } else if (msg.type === 'openBmac') {
        void vscode.env.openExternal(vscode.Uri.parse('https://www.buymeacoffee.com/MFoxx'));
      } else if (msg.type === 'executeCommand') {
        const args: unknown[] = Array.isArray(msg.args) ? msg.args : [];
        void vscode.commands.executeCommand(msg.command as string, ...args);
      } else if (msg.type === 'runMacro') {
        void vscode.commands.executeCommand('moonraker.sendGcodeScript', msg.macro as string);
      }
    });
  }

  update(status: PrinterStatus, tempHistory: TemperaturePoint[]): void {
    this.lastStatus = status;
    this.lastTempHistory = tempHistory;
    this.send(status, tempHistory, this.lastPrintHistory);
  }

  setPrintHistory(entries: PrintHistoryEntry[]): void {
    this.lastPrintHistory = entries;
    if (this.lastStatus && this.lastTempHistory) {
      this.send(this.lastStatus, this.lastTempHistory, entries);
    }
  }

  setMacros(macros: string[]): void {
    this.lastMacros = macros;
    this.view?.webview.postMessage({ type: 'macros', macros });
  }

  setJobQueue(status: JobQueueStatus): void {
    this.lastJobQueue = status;
    this.view?.webview.postMessage({ type: 'jobQueue', ...status });
  }

  setDisconnected(): void {
    this.lastStatus = undefined;
    this.sendDisconnected();
  }

  updatePosition(pos: ToolheadPosition): void {
    this.view?.webview.postMessage({ type: 'position', ...pos });
  }

  /** Rebuild the webview HTML (e.g. when config affecting the template changes). */
  rebuildHtml(): void {
    if (this.view) {
      this.view.webview.html = this.buildHtml(this.view.webview);
    }
  }

  private send(
    status: PrinterStatus,
    tempHistory: TemperaturePoint[],
    printHistory: PrintHistoryEntry[],
  ): void {
    this.view?.webview.postMessage({ type: 'update', status, tempHistory, printHistory });
  }

  private sendDisconnected(): void {
    this.view?.webview.postMessage({ type: 'disconnected' });
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const cfg = vscode.workspace.getConfiguration('moonraker');
    const webUiUrl            = cfg.get<string>('webUiUrl',   '').trim();
    const webUiLabel          = cfg.get<string>('webUiLabel', 'Open Web UI').trim() || 'Open Web UI';
    const experimentalEnabled = cfg.get<boolean>('experimental.enabled', false);
    const posVizEnabled       = cfg.get<boolean>('experimental.positionVisualization', false);
    const bedWidth            = cfg.get<number>('bedWidth',  235);
    const bedHeight           = cfg.get<number>('bedHeight', 235);
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src data:`,
    ].join('; ');

    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Printer Monitor</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      padding: 10px 12px 20px;
    }

    /* ── State badge ──────────────────────────────────────────── */
    .state-badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 8px;
    }
    .state-off      { background:#444;    color:#aaa; }
    .state-idle     { background:#3b4048; color:#abb2bf; }
    .state-printing { background:#2d5a27; color:#98c379; }
    .state-paused   { background:#5a4a1a; color:#e5c07b; }
    .state-finished { background:#1a3a5a; color:#61afef; }
    .state-error    { background:#5a1a1a; color:#e06c75; }

    /* ── Thumbnail ────────────────────────────────────────────── */
    .thumbnail-wrap {
      margin-bottom: 10px;
      text-align: center;
    }
    .thumbnail-wrap img {
      max-width: 100%;
      max-height: 140px;
      border-radius: 6px;
      border: 1px solid var(--vscode-input-border, #3a3a3a);
      object-fit: contain;
    }

    /* ── Filename ─────────────────────────────────────────────── */
    .filename {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 10px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* ── Progress ─────────────────────────────────────────────── */
    .progress-wrap { margin-bottom: 12px; }
    .progress-label {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 5px;
    }
    .layer-tag {
      font-size: 10px;
      background: rgba(152,195,121,0.15);
      color: #98c379;
      padding: 1px 6px;
      border-radius: 8px;
    }
    .progress-bar-bg {
      height: 5px;
      background: var(--vscode-scrollbarSlider-background, #333);
      border-radius: 3px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #5cb85c, #98c379);
      border-radius: 3px;
      transition: width 0.5s ease;
    }

    /* ── Cards grid ───────────────────────────────────────────── */
    .card-grid {
      display: grid;
      gap: 7px;
      margin-bottom: 10px;
    }
    .card-grid-2 { grid-template-columns: 1fr 1fr; }
    .card-grid-3 { grid-template-columns: 1fr 1fr 1fr; }

    .card {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, #3a3a3a);
      border-radius: 6px;
      padding: 7px 9px;
    }
    .card-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 2px;
    }
    .card-value {
      font-size: 16px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      line-height: 1.2;
    }
    .card-sub {
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      margin-top: 1px;
    }
    .clr-hotend  { color: #e06c75; }
    .clr-bed     { color: #61afef; }
    .clr-chamber { color: #e5c07b; }
    .clr-time    { color: var(--vscode-foreground); }
    .clr-eta     { color: #98c379; }
    .clr-done    { color: #c678dd; }

    /* ── Stats row (fan / speed / flow / filament) ─────────────── */
    .stats-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .stat-chip {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, #3a3a3a);
      border-radius: 12px;
      padding: 3px 9px;
      font-size: 11px;
      white-space: nowrap;
    }
    .stat-chip .chip-label {
      color: var(--vscode-descriptionForeground);
      margin-right: 3px;
    }

    /* ── XYZ row ──────────────────────────────────────────────── */
    .xyz-row {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-bottom: 12px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
    }
    .xyz-row .xyz-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--vscode-descriptionForeground);
      min-width: 22px;
    }
    .xyz-val { display: flex; flex-direction: column; align-items: center; gap: 1px; }
    .xyz-axis { font-size: 8px; color: var(--vscode-descriptionForeground); }

    /* ── Temperature chart ────────────────────────────────────── */
    .section-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 5px;
    }
    .chart-wrap { margin-top: 5px; }
    canvas {
      width: 100%;
      display: block;
      border-radius: 4px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, #3a3a3a);
    }
    .legend {
      display: flex;
      gap: 12px;
      margin-top: 5px;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
    }
    .legend-line {
      display: inline-block;
      width: 12px;
      height: 2px;
      border-radius: 1px;
      margin-right: 4px;
      vertical-align: middle;
    }

    /* ── Collapsible sections ─────────────────────────────────── */
    details.collapsible-section {
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--vscode-input-border, #2a2a2a);
    }
    details.collapsible-section summary {
      list-style: none;
      cursor: pointer;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 5px;
      user-select: none;
    }
    details.collapsible-section summary::-webkit-details-marker { display: none; }
    details.collapsible-section summary::before {
      content: '\u25B6';
      font-size: 7px;
      display: inline-block;
      transition: transform 0.15s;
    }
    details.collapsible-section[open] summary::before { transform: rotate(90deg); }
    .history-entry {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 6px;
      align-items: center;
      padding: 5px 0;
      border-bottom: 1px solid var(--vscode-input-border, #2a2a2a);
      font-size: 11px;
    }
    .history-entry:last-child { border-bottom: none; }
    .h-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--vscode-foreground);
    }
    .h-duration { color: var(--vscode-descriptionForeground); white-space: nowrap; }
    .h-date     { color: var(--vscode-descriptionForeground); white-space: nowrap; }
    .h-status-ok  { color: #98c379; }
    .h-status-err { color: #e06c75; }

    /* ── Job queue ────────────────────────────────────────────── */
    .queue-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .queue-state {
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 2px 7px;
      border-radius: 8px;
    }
    .queue-state-ready    { background: #2d5a27; color: #98c379; }
    .queue-state-paused   { background: #5a4a1a; color: #e5c07b; }
    .queue-state-loading,
    .queue-state-starting { background: #1a3a5a; color: #61afef; }
    .queue-actions {
      display: flex;
      gap: 6px;
      margin-bottom: 8px;
    }
    .queue-actions .ctrl-btn { font-size: 10px; padding: 4px 8px; }
    .queue-entry {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 0;
      border-bottom: 1px solid var(--vscode-input-border, #2a2a2a);
      font-size: 11px;
    }
    .queue-entry:last-child { border-bottom: none; }
    .queue-idx {
      flex-shrink: 0;
      width: 16px;
      text-align: right;
      color: var(--vscode-descriptionForeground);
      font-size: 10px;
    }
    .queue-name {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .queue-remove {
      flex-shrink: 0;
      background: none;
      border: none;
      color: var(--vscode-descriptionForeground);
      cursor: pointer;
      font-size: 13px;
      padding: 0 2px;
      line-height: 1;
    }
    .queue-remove:hover { color: #e06c75; }
    .queue-empty {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }

    /* ── Disconnected state ───────────────────────────────────── */
    .disconnected {
      text-align: center;
      padding: 40px 0;
      color: var(--vscode-descriptionForeground);
    }
    .disconnected .d-icon { font-size: 32px; margin-bottom: 10px; }
    .disconnected .d-msg  { font-size: 12px; line-height: 1.6; }

    /* ── Top action buttons ─────────────────────────────────── */
    .top-actions { display: flex; gap: 6px; margin-bottom: 10px; }
    .top-actions .action-btn {
      flex: 1;
      padding: 6px 10px;
      background: var(--vscode-button-secondaryBackground, #3a3a3a);
      color: var(--vscode-button-secondaryForeground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      text-align: center;
    }
    .top-actions .action-btn:hover { opacity: 0.85; }
    .top-actions .action-btn:only-child { flex: 1 1 100%; }

    /* ── Experimental controls ────────────────────────────────── */
    .ctrl-section {
      margin-top: 14px;
      border-top: 1px solid var(--vscode-input-border, #3a3a3a);
      padding-top: 14px;
    }
    .ctrl-group { margin-bottom: 14px; }
    .ctrl-group:last-child { margin-bottom: 0; }
    .ctrl-group-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 7px;
    }
    .ctrl-input-row {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-bottom: 7px;
    }
    .ctrl-input {
      flex: 1;
      min-width: 0;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px;
      padding: 5px 8px;
      font-size: 12px;
      font-family: var(--vscode-font-family);
      font-variant-numeric: tabular-nums;
    }
    .ctrl-input:focus { outline: 1px solid var(--vscode-focusBorder, #007acc); outline-offset: -1px; }
    .ctrl-unit {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-shrink: 0;
    }
    .ctrl-btn-row { display: flex; gap: 7px; }
    .ctrl-btn {
      flex: 1;
      padding: 6px 10px;
      background: var(--vscode-button-secondaryBackground, #3a3a3a);
      color: var(--vscode-button-secondaryForeground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      text-align: center;
    }
    .ctrl-btn:hover { opacity: 0.85; }
    .ctrl-btn-full { width: 100%; }
    .ctrl-btn-set  { flex: 0 0 auto; padding: 5px 14px; }
    .ctrl-btn-danger {
      display: block;
      width: 100%;
      padding: 8px 10px;
      background: #5a1a1a;
      color: #e06c75;
      border: 1px solid #7a2a2a;
      border-radius: 3px;
      font-size: 12px;
      font-weight: 600;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      text-align: center;
    }
    .ctrl-btn-danger:hover { background: #6a2020; }

    /* ── Macro buttons ───────────────────────────────────────── */
    .macro-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }
    .macro-btn {
      padding: 5px 10px;
      background: var(--vscode-button-secondaryBackground, #3a3a3a);
      color: var(--vscode-button-secondaryForeground, #ccc);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 3px;
      font-size: 11px;
      font-family: var(--vscode-font-family);
      cursor: pointer;
      text-align: center;
    }
    .macro-btn:hover { opacity: 0.85; }

    /* ── Buy me a coffee footer ───────────────────────────────── */
    .bmac-footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid var(--vscode-input-border, #2a2a2a);
      text-align: center;
      font-size: 10px;
      color: var(--vscode-descriptionForeground);
      opacity: 0.6;
    }
    .bmac-footer a {
      color: inherit;
      text-decoration: none;
      cursor: pointer;
    }
    .bmac-footer a:hover { opacity: 0.9; text-decoration: underline; }
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="queue-root"></div>
  <div id="macros-root"></div>
  <div id="controls-root"></div>
  <div id="history-root"></div>
  <div class="bmac-footer">
    Enjoying the extension? <a id="bmac-link">Buy me a coffee ☕</a>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    vscode.postMessage({ type: 'ready' });

    document.getElementById('bmac-link').addEventListener('click', function() {
      vscode.postMessage({ type: 'openBmac' });
    });

    const WEB_UI_URL           = ${JSON.stringify(webUiUrl)};
    const WEB_UI_LABEL         = ${JSON.stringify(webUiLabel)};
    const EXPERIMENTAL_ENABLED = ${JSON.stringify(experimentalEnabled)};
    const POS_VIZ_ENABLED      = ${JSON.stringify(posVizEnabled)};
    const BED_WIDTH            = ${JSON.stringify(bedWidth)};
    const BED_HEIGHT           = ${JSON.stringify(bedHeight)};

    function topActions() {
      var btns = '';
      if (WEB_UI_URL) btns += '<button class="action-btn" id="webui-btn">' + WEB_UI_LABEL + '</button>';
      btns += '<button class="action-btn" id="logs-btn">Show Logs</button>';
      return '<div class="top-actions">' + btns + '</div>';
    }

    function attachTopActions() {
      var btn = document.getElementById('webui-btn');
      if (btn) btn.addEventListener('click', function() {
        vscode.postMessage({ type: 'openWebUI' });
      });
      var logsBtn = document.getElementById('logs-btn');
      if (logsBtn) logsBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'showLogs' });
      });
    }

    function attachSectionToggles() {
      function saveToggle(id, key) {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('toggle', function() {
          const state = vscode.getState() || {};
          vscode.setState(Object.assign({}, state, { [key]: el.open }));
          // Redraw chart when Temperature History is opened (canvas was hidden)
          if (id === 'temp-details' && el.open && lastState) {
            drawChart(document.getElementById('chart'), lastState.tempHistory);
          }
        });
      }
      saveToggle('temp-details',    'tempOpen');
      saveToggle('pos-details',     'posOpen');
    }

    // ── Experimental controls ────────────────────────────────────────────────

    let currentControlMode = null;

    function getControlMode(status) {
      if (!status) return 'disconnected';
      if (status.state === 'printing' || status.state === 'paused') return 'printing';
      if (status.state === 'idle'     || status.state === 'finished') return 'idle';
      return 'disconnected';
    }

    function renderControls(mode) {
      if (!EXPERIMENTAL_ENABLED || mode === 'disconnected') return '';
      const isIdle     = mode === 'idle';
      const isPrinting = mode === 'printing';

      const savedState = vscode.getState() || {};
      const ctrlOpenAttr = savedState.ctrlOpen !== false ? ' open' : '';
      let html = '<details id="ctrl-details" class="collapsible-section"' + ctrlOpenAttr + '>' +
        '<summary>Controls</summary>';

      // Emergency Stop — always visible when connected
      html += '<div class="ctrl-group">' +
        '<button class="ctrl-btn-danger" id="btn-estop">\u26A0 Emergency Stop</button>' +
        '</div>';

      if (isIdle) {
        // Home
        html += '<div class="ctrl-group">' +
          '<div class="ctrl-group-label">Home</div>' +
          '<button class="ctrl-btn ctrl-btn-full" id="btn-home">Home All Axes (G28)</button>' +
          '</div>';

        // Heat Bed
        html += '<div class="ctrl-group">' +
          '<div class="ctrl-group-label">Heat Bed</div>' +
          '<div class="ctrl-input-row">' +
          '<input class="ctrl-input" id="input-bed-temp" type="number" min="0" max="130" placeholder="60">' +
          '<span class="ctrl-unit">\u00b0C</span>' +
          '</div>' +
          '<div class="ctrl-btn-row">' +
          '<button class="ctrl-btn" id="btn-heat-bed">Heat</button>' +
          '<button class="ctrl-btn" id="btn-heat-bed-wait">Heat &amp; Wait</button>' +
          '</div></div>';

        // Heat Extruder
        html += '<div class="ctrl-group">' +
          '<div class="ctrl-group-label">Heat Extruder</div>' +
          '<div class="ctrl-input-row">' +
          '<input class="ctrl-input" id="input-ext-temp" type="number" min="0" max="300" placeholder="200">' +
          '<span class="ctrl-unit">\u00b0C</span>' +
          '</div>' +
          '<div class="ctrl-btn-row">' +
          '<button class="ctrl-btn" id="btn-heat-ext">Heat</button>' +
          '<button class="ctrl-btn" id="btn-heat-ext-wait">Heat &amp; Wait</button>' +
          '</div></div>';
      }

      if (isPrinting) {
        // Speed Factor
        html += '<div class="ctrl-group">' +
          '<div class="ctrl-group-label">Speed Factor</div>' +
          '<div class="ctrl-input-row">' +
          '<input class="ctrl-input" id="input-speed" type="number" min="50" max="150" placeholder="100">' +
          '<span class="ctrl-unit">%</span>' +
          '<button class="ctrl-btn ctrl-btn-set" id="btn-speed">Set</button>' +
          '</div></div>';

        // Fan Speed
        html += '<div class="ctrl-group">' +
          '<div class="ctrl-group-label">Fan Speed</div>' +
          '<div class="ctrl-input-row">' +
          '<input class="ctrl-input" id="input-fan" type="number" min="0" max="100" placeholder="100">' +
          '<span class="ctrl-unit">%</span>' +
          '<button class="ctrl-btn ctrl-btn-set" id="btn-fan">Set</button>' +
          '</div></div>';
      }

      html += '</details>';
      return html;
    }

    function attachControls() {
      if (!EXPERIMENTAL_ENABLED) return;

      var ctrlDetails = document.getElementById('ctrl-details');
      if (ctrlDetails) ctrlDetails.addEventListener('toggle', function() {
        const state = vscode.getState() || {};
        vscode.setState(Object.assign({}, state, { ctrlOpen: ctrlDetails.open }));
      });

      function postGcode(script) {
        vscode.postMessage({ type: 'executeCommand', command: 'moonraker.sendGcodeScript', args: [script] });
      }

      var estop = document.getElementById('btn-estop');
      if (estop) estop.addEventListener('click', function() {
        vscode.postMessage({ type: 'executeCommand', command: 'moonraker.emergencyStop' });
      });

      var home = document.getElementById('btn-home');
      if (home) home.addEventListener('click', function() { postGcode('G28'); });

      var heatBed = document.getElementById('btn-heat-bed');
      if (heatBed) heatBed.addEventListener('click', function() {
        var v = parseFloat(document.getElementById('input-bed-temp').value);
        if (!isNaN(v) && v >= 0 && v <= 130) postGcode('M140 S' + v);
      });
      var heatBedWait = document.getElementById('btn-heat-bed-wait');
      if (heatBedWait) heatBedWait.addEventListener('click', function() {
        var v = parseFloat(document.getElementById('input-bed-temp').value);
        if (!isNaN(v) && v >= 0 && v <= 130) postGcode('M190 S' + v);
      });

      var heatExt = document.getElementById('btn-heat-ext');
      if (heatExt) heatExt.addEventListener('click', function() {
        var v = parseFloat(document.getElementById('input-ext-temp').value);
        if (!isNaN(v) && v >= 0 && v <= 300) postGcode('M104 S' + v);
      });
      var heatExtWait = document.getElementById('btn-heat-ext-wait');
      if (heatExtWait) heatExtWait.addEventListener('click', function() {
        var v = parseFloat(document.getElementById('input-ext-temp').value);
        if (!isNaN(v) && v >= 0 && v <= 300) postGcode('M109 S' + v);
      });

      var setSpeed = document.getElementById('btn-speed');
      if (setSpeed) setSpeed.addEventListener('click', function() {
        var v = parseFloat(document.getElementById('input-speed').value);
        if (!isNaN(v) && v >= 50 && v <= 150) postGcode('M220 S' + v);
      });

      var setFan = document.getElementById('btn-fan');
      if (setFan) setFan.addEventListener('click', function() {
        var v = parseFloat(document.getElementById('input-fan').value);
        if (!isNaN(v) && v >= 0 && v <= 100) postGcode('M106 S' + Math.round(v * 255 / 100));
      });
    }

    function updateControlsIfNeeded(status) {
      if (!EXPERIMENTAL_ENABLED) return;
      var mode = getControlMode(status);
      if (mode === currentControlMode) return;
      currentControlMode = mode;
      document.getElementById('controls-root').innerHTML = renderControls(mode);
      attachControls();
    }

    // ── Position visualization ───────────────────────────────────────────────

    // Two samples for interpolation: posA (older) → posB (newer)
    let posA = null, posB = null, posATime = 0, posBTime = 0;

    function drawPosition(canvas, pos) {
      if (!canvas || !pos) return;

      const dpr  = window.devicePixelRatio || 1;
      const logW = canvas.clientWidth || 250;
      const logH = 230;
      canvas.width  = Math.round(logW * dpr);
      canvas.height = Math.round(logH * dpr);
      canvas.style.height = logH + 'px';

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, logW, logH);

      // ── Isometric projection ──────────────────────────────────────────────
      // Printer mechanics: BED moves on X, TOOLHEAD moves on Y (depth) and Z (height).
      // X axis → lower-right, Y axis → lower-left, Z axis → up
      const maxZ  = 300;
      const cos30 = Math.sqrt(3) / 2;
      const sin30 = 0.5;
      const pad   = 14;

      const scale = Math.min(
        (logW - pad * 2) / ((BED_WIDTH + BED_HEIGHT) * cos30),
        (logH - pad * 2) / (maxZ + (BED_WIDTH + BED_HEIGHT) * sin30)
      );

      const ox = logW / 2 - (BED_WIDTH - BED_HEIGHT) * cos30 * scale / 2;
      const oy = pad + maxZ * scale;

      function proj(x, y, z) {
        return [
          ox + (x - y) * cos30 * scale,
          oy + (x + y) * sin30 * scale - z * scale,
        ];
      }

      // ── Bed floor ─────────────────────────────────────────────────────────
      const c00 = proj(0,         0,          0);
      const c10 = proj(BED_WIDTH, 0,          0);
      const c11 = proj(BED_WIDTH, BED_HEIGHT, 0);
      const c01 = proj(0,         BED_HEIGHT, 0);

      ctx.beginPath();
      ctx.moveTo(...c00); ctx.lineTo(...c10); ctx.lineTo(...c11); ctx.lineTo(...c01);
      ctx.closePath();
      ctx.fillStyle = 'rgba(80,80,80,0.18)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(150,150,150,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Grid lines every 50 mm
      ctx.strokeStyle = 'rgba(150,150,150,0.1)';
      ctx.lineWidth = 0.5;
      for (let gx = 50; gx < BED_WIDTH; gx += 50) {
        const a = proj(gx, 0, 0), b = proj(gx, BED_HEIGHT, 0);
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      }
      for (let gy = 50; gy < BED_HEIGHT; gy += 50) {
        const a = proj(0, gy, 0), b = proj(BED_WIDTH, gy, 0);
        ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke();
      }

      // ── Vertical frame pillars (dashed) ───────────────────────────────────
      ctx.strokeStyle = 'rgba(120,120,120,0.2)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([2, 3]);
      [[BED_WIDTH, 0], [BED_WIDTH, BED_HEIGHT], [0, BED_HEIGHT]].forEach(function([ex, ey]) {
        const b = proj(ex, ey, 0), t = proj(ex, ey, maxZ);
        ctx.beginPath(); ctx.moveTo(...b); ctx.lineTo(...t); ctx.stroke();
      });
      ctx.setLineDash([]);

      // ── BED X-position indicator (blue) ───────────────────────────────────
      // The bed slides in X. Draw a line across the bed at the current X,
      // spanning the full Y range. This shows where the bed is positioned.
      ctx.strokeStyle = 'rgba(97,175,239,0.75)';   // blue
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(...proj(pos.x, 0,          0));
      ctx.lineTo(...proj(pos.x, BED_HEIGHT, 0));
      ctx.stroke();

      // Small dot on the bed indicator line at Y=0 edge
      ctx.fillStyle = 'rgba(97,175,239,0.5)';
      ctx.beginPath(); ctx.arc(...proj(pos.x, 0, 0), 2.5, 0, Math.PI * 2); ctx.fill();

      // ── GANTRY bar (green) ────────────────────────────────────────────────
      // The toolhead rides a horizontal beam that spans the full X width,
      // positioned at depth Y and height Z. This moves in Y and Z.
      ctx.strokeStyle = 'rgba(152,195,121,0.6)';   // green
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(...proj(0,         pos.y, pos.z));
      ctx.lineTo(...proj(BED_WIDTH, pos.y, pos.z));
      ctx.stroke();

      // ── Nozzle: intersection of bed X and gantry (Y, Z) ──────────────────
      const shadow = proj(pos.x, pos.y, 0);
      const head   = proj(pos.x, pos.y, pos.z);

      // Shadow dot on bed
      ctx.fillStyle = 'rgba(152,195,121,0.25)';
      ctx.beginPath(); ctx.arc(...shadow, 3, 0, Math.PI * 2); ctx.fill();

      // Vertical stem (shadow → nozzle)
      if (pos.z > 0.5) {
        ctx.strokeStyle = 'rgba(152,195,121,0.45)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(...shadow); ctx.lineTo(...head); ctx.stroke();
        ctx.setLineDash([]);
      }

      // Nozzle dot
      ctx.fillStyle = '#98c379';
      ctx.beginPath(); ctx.arc(...head, 4.5, 0, Math.PI * 2); ctx.fill();

      // ── Coordinates ───────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(140,140,140,0.85)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(
        'X\u2009' + pos.x.toFixed(1) + '\u2002Y\u2009' + pos.y.toFixed(1) + '\u2002Z\u2009' + pos.z.toFixed(2),
        logW / 2, logH - 4
      );
    }

    // Render at 60 fps, interpolating between the last two position samples.
    // The loop runs for the lifetime of the webview (cost is negligible when idle).
    if (POS_VIZ_ENABLED) {
      (function animLoop() {
        const canvas = document.getElementById('pos-canvas');
        if (canvas && posB) {
          let pos = posB;
          if (posA && posBTime > posATime) {
            const t = Math.min(1.0, (performance.now() - posATime) / (posBTime - posATime));
            pos = { x: posA.x + (posB.x - posA.x) * t,
                    y: posA.y + (posB.y - posA.y) * t,
                    z: posB.z };
          }
          drawPosition(canvas, pos);
        }
        requestAnimationFrame(animLoop);
      })();
    }

    // ── Formatters ──────────────────────────────────────────────────────────

    function fmtSec(s) {
      s = Math.max(0, Math.round(s));
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
      if (h > 0) return h + 'h ' + m + 'm';
      if (m > 0) return m + 'm ' + String(sec).padStart(2, '0') + 's';
      return sec + 's';
    }

    function fmtWallClock(epochMs) {
      return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function fmtFilament(mm) {
      if (mm >= 1000) return (mm / 1000).toFixed(2) + 'm';
      return mm.toFixed(0) + 'mm';
    }

    function fmtPct(ratio) {
      return Math.round(ratio * 100) + '%';
    }

    function fmtXYZ(v) {
      return v == null ? '—' : v.toFixed(2);
    }

    function timeAgo(epochSec) {
      const diff = Date.now() / 1000 - epochSec;
      if (diff < 60)    return 'just now';
      if (diff < 3600)  return Math.round(diff / 60) + 'm ago';
      if (diff < 86400) return Math.round(diff / 3600) + 'h ago';
      return Math.round(diff / 86400) + 'd ago';
    }

    // ── Chart ────────────────────────────────────────────────────────────────

    function drawChart(canvas, history) {
      if (!canvas || history.length < 2) return;
      const dpr = window.devicePixelRatio || 1;
      const logW = canvas.clientWidth || 250;
      const logH = 120;
      canvas.width  = Math.round(logW * dpr);
      canvas.height = Math.round(logH * dpr);
      canvas.style.height = logH + 'px';

      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      const pad = { top: 8, right: 8, bottom: 24, left: 36 };
      const cW = logW - pad.left - pad.right;
      const cH = logH - pad.top  - pad.bottom;

      const hotends = history.map(p => p.hotend);
      const beds    = history.map(p => p.bed);
      const all     = [...hotends, ...beds].filter(v => v > 0);
      if (!all.length) return;

      const minT = Math.max(0, Math.min(...all) - 5);
      const maxT = Math.max(...all) + 10;
      const xOf  = i => pad.left + (i / (history.length - 1)) * cW;
      const yOf  = t => pad.top  + cH - ((t - minT) / (maxT - minT)) * cH;

      // Grid
      for (let i = 0; i <= 4; i++) {
        const y = pad.top + (i / 4) * cH;
        ctx.strokeStyle = 'rgba(128,128,128,0.12)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(logW - pad.right, y); ctx.stroke();
        ctx.fillStyle = 'rgba(140,140,140,0.65)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxT - (i / 4) * (maxT - minT)) + '\u00b0', pad.left - 3, y + 3);
      }

      // Time labels
      if (history.length >= 2) {
        const span = (history[history.length - 1].time - history[0].time) / 1000;
        ctx.fillStyle = 'rgba(140,140,140,0.65)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'left';
        ctx.fillText(span >= 60 ? Math.round(span / 60) + 'm ago' : Math.round(span) + 's ago', pad.left, logH - 6);
        ctx.textAlign = 'right';
        ctx.fillText('now', logW - pad.right, logH - 6);
      }

      // Lines
      const drawLine = (temps, color) => {
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
        temps.forEach((t, i) => { i === 0 ? ctx.moveTo(xOf(i), yOf(t)) : ctx.lineTo(xOf(i), yOf(t)); });
        ctx.stroke();
      };
      drawLine(beds,    '#61afef');
      drawLine(hotends, '#e06c75');
    }

    // ── Renderers ────────────────────────────────────────────────────────────

    function renderDisconnected() {
      document.getElementById('root').innerHTML =
        topActions() +
        '<div class="disconnected">' +
        '<div class="d-icon">⚡</div>' +
        '<div class="d-msg">Not connected to Moonraker.<br>Check your settings.</div>' +
        '</div>';
      attachTopActions();
    }

    function chip(label, value) {
      return '<span class="stat-chip"><span class="chip-label">' + label + '</span>' + value + '</span>';
    }

    function card(label, value, cls, sub) {
      return '<div class="card">' +
        '<div class="card-label">' + label + '</div>' +
        '<div class="card-value ' + (cls || '') + '">' + value + '</div>' +
        (sub ? '<div class="card-sub">' + sub + '</div>' : '') +
        '</div>';
    }

    function renderStatus(status, tempHistory) {
      const p = status;
      const isPrinting = p.state === 'printing' || p.state === 'paused';
      let html = topActions();

      // Thumbnail
      if (isPrinting && p.thumbnailData) {
        html += '<div class="thumbnail-wrap"><img src="' + p.thumbnailData + '" alt="model preview"></div>';
      }

      // State badge
      html += '<div class="state-badge state-' + p.state + '">' + p.state.toUpperCase() + '</div>';

      // Filename
      if (isPrinting && p.filename) {
        const name = p.filename.replace(/\\.gcode$/i, '');
        html += '<div class="filename" title="' + p.filename + '">' + name + '</div>';
      }

      // Progress + layers
      if (isPrinting) {
        const pct = (p.progress * 100).toFixed(1);
        const layerTag = (p.currentLayer != null && p.totalLayers != null)
          ? '<span class="layer-tag">Layer ' + p.currentLayer + ' / ' + p.totalLayers + '</span>'
          : (p.currentLayer != null ? '<span class="layer-tag">Layer ' + p.currentLayer + '</span>' : '');
        html += '<div class="progress-wrap">' +
          '<div class="progress-label"><span>Progress ' + pct + '%</span>' + layerTag + '</div>' +
          '<div class="progress-bar-bg"><div class="progress-bar-fill" style="width:' + pct + '%"></div></div>' +
          '</div>';
      }

      // Temperature cards
      const hasChamber = p.chamberTemp != null;
      html += '<div class="card-grid ' + (hasChamber ? 'card-grid-3' : 'card-grid-2') + '">';
      html += card('Hotend', p.hotendTemp.toFixed(1) + '\u00b0', 'clr-hotend', 'target ' + p.hotendTarget.toFixed(0) + '\u00b0');
      html += card('Bed',    p.bedTemp.toFixed(1)    + '\u00b0', 'clr-bed',    'target ' + p.bedTarget.toFixed(0)    + '\u00b0');
      if (hasChamber) {
        html += card('Chamber', p.chamberTemp.toFixed(1) + '\u00b0', 'clr-chamber',
          p.chamberTarget != null ? 'target ' + p.chamberTarget.toFixed(0) + '\u00b0' : '');
      }
      html += '</div>';

      // Time cards (when printing)
      if (isPrinting) {
        html += '<div class="card-grid card-grid-3">';
        html += card('Elapsed', fmtSec(p.printDuration), 'clr-time');
        html += card('ETA',     p.etaSeconds != null ? fmtSec(p.etaSeconds) : '\u2014', 'clr-eta');
        html += card('Done at', p.finishTime ? fmtWallClock(p.finishTime) : '\u2014', 'clr-done');
        html += '</div>';
      }

      // Fan / Speed / Flow / Filament chips
      const chips = [];
      if (p.fanSpeed   != null) chips.push(chip('Fan',   fmtPct(p.fanSpeed)));
      if (isPrinting && p.speedFactor  != null) chips.push(chip('Speed', fmtPct(p.speedFactor)));
      if (isPrinting && p.flowRate     != null) chips.push(chip('Flow',  fmtPct(p.flowRate)));
      if (isPrinting && p.filamentUsed != null && p.filamentUsed > 0) chips.push(chip('Fil', fmtFilament(p.filamentUsed)));
      if (chips.length) html += '<div class="stats-row">' + chips.join('') + '</div>';

      // Toolhead XYZ
      if (isPrinting && (p.toolheadX != null || p.toolheadY != null || p.toolheadZ != null)) {
        html += '<div class="xyz-row">' +
          '<span class="xyz-label">XYZ</span>' +
          '<span class="xyz-val"><span>' + fmtXYZ(p.toolheadX) + '</span><span class="xyz-axis">X</span></span>' +
          '<span class="xyz-val"><span>' + fmtXYZ(p.toolheadY) + '</span><span class="xyz-axis">Y</span></span>' +
          '<span class="xyz-val"><span>' + fmtXYZ(p.toolheadZ) + '</span><span class="xyz-axis">Z</span></span>' +
          '</div>';
      }

      // Temperature chart
      const savedState = vscode.getState() || {};
      const tempOpenAttr = savedState.tempOpen !== false ? ' open' : '';
      html += '<details id="temp-details" class="collapsible-section"' + tempOpenAttr + '>' +
        '<summary>Temperature History</summary>' +
        '<div class="chart-wrap">' +
        '<canvas id="chart"></canvas>' +
        '<div class="legend">' +
        '<span><span class="legend-line" style="background:#e06c75"></span>Hotend</span>' +
        '<span><span class="legend-line" style="background:#61afef"></span>Bed</span>' +
        '</div></div>' +
        '</details>';

      // Position visualization
      if (POS_VIZ_ENABLED) {
        const posOpenAttr = savedState.posOpen !== false ? ' open' : '';
        html += '<details id="pos-details" class="collapsible-section"' + posOpenAttr + '>' +
          '<summary>Toolhead Position</summary>' +
          '<div class="chart-wrap"><canvas id="pos-canvas"></canvas></div>' +
          '</details>';
      }

      document.getElementById('root').innerHTML = html;
      attachTopActions();
      attachSectionToggles();
      drawChart(document.getElementById('chart'), tempHistory);
    }

    // ── Print history ───────────────────────────────────────────────────────

    function renderPrintHistory(printHistory) {
      var root = document.getElementById('history-root');
      if (!root) return;
      if (!printHistory || !printHistory.length) { root.innerHTML = ''; return; }

      var savedState = vscode.getState() || {};
      var openAttr = savedState.historyOpen ? ' open' : '';
      var html = '<details id="history-details" class="collapsible-section"' + openAttr + '>' +
        '<summary>Recent Prints</summary>';
      printHistory.forEach(function(j) {
        var ok   = j.status === 'completed';
        var icon = ok ? '<span class="h-status-ok">\u2713</span>' : '<span class="h-status-err">\u2717</span>';
        var name = j.filename.replace(/\\.gcode$/i, '');
        html += '<div class="history-entry">' +
          '<span class="h-name" title="' + j.filename + '">' + icon + ' ' + name + '</span>' +
          '<span class="h-duration">' + fmtSec(j.totalDuration) + '</span>' +
          '<span class="h-date">' + timeAgo(j.startTime) + '</span>' +
          '</div>';
      });
      html += '</details>';
      root.innerHTML = html;

      var details = document.getElementById('history-details');
      if (details) details.addEventListener('toggle', function() {
        var state = vscode.getState() || {};
        vscode.setState(Object.assign({}, state, { historyOpen: details.open }));
      });
    }

    // ── Macro buttons ──────────────────────────────────────────────────────

    function renderMacros(macros) {
      if (!macros || !macros.length) {
        document.getElementById('macros-root').innerHTML = '';
        return;
      }
      var savedState = vscode.getState() || {};
      var openAttr = savedState.macrosOpen ? ' open' : '';
      var html = '<details id="macros-details" class="collapsible-section"' + openAttr + '>' +
        '<summary>Macros</summary>' +
        '<div class="macro-grid">';
      macros.forEach(function(name) {
        html += '<button class="macro-btn" data-macro="' + name + '">' + name + '</button>';
      });
      html += '</div></details>';
      document.getElementById('macros-root').innerHTML = html;

      var details = document.getElementById('macros-details');
      if (details) details.addEventListener('toggle', function() {
        var state = vscode.getState() || {};
        vscode.setState(Object.assign({}, state, { macrosOpen: details.open }));
      });

      document.querySelectorAll('.macro-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          vscode.postMessage({ type: 'runMacro', macro: btn.getAttribute('data-macro') });
        });
      });
    }

    // ── Job Queue ──────────────────────────────────────────────────────────

    function renderJobQueue(queueState, queuedJobs) {
      var root = document.getElementById('queue-root');
      if (!root) return;
      if (!queuedJobs) { root.innerHTML = ''; return; }

      var savedState = vscode.getState() || {};
      var openAttr = savedState.queueOpen ? ' open' : '';
      var html = '<details id="queue-details" class="collapsible-section"' + openAttr + '>' +
        '<summary>Job Queue</summary>';

      // State badge
      var stateClass = 'queue-state-' + queueState;
      html += '<div class="queue-header">' +
        '<span class="queue-state ' + stateClass + '">' + queueState + '</span>' +
        '</div>';

      // Action buttons
      html += '<div class="queue-actions">';
      html += '<button class="ctrl-btn" id="btn-queue-add">+ Add</button>';
      if (queueState === 'paused') {
        html += '<button class="ctrl-btn" id="btn-queue-start">\u25B6 Start</button>';
      } else {
        html += '<button class="ctrl-btn" id="btn-queue-pause">\u23F8 Pause</button>';
      }
      if (queuedJobs.length) {
        html += '<button class="ctrl-btn" id="btn-queue-clear">Clear</button>';
      }
      html += '</div>';

      // Job list
      if (queuedJobs.length) {
        queuedJobs.forEach(function(job, i) {
          var name = job.filename.replace(/\.gcode$/i, '');
          html += '<div class="queue-entry">' +
            '<span class="queue-idx">' + (i + 1) + '</span>' +
            '<span class="queue-name" title="' + job.filename + '">' + name + '</span>' +
            '<button class="queue-remove" data-job-id="' + job.jobId + '" title="Remove">\u00D7</button>' +
            '</div>';
        });
      } else {
        html += '<div class="queue-empty">Queue is empty</div>';
      }

      html += '</details>';
      root.innerHTML = html;

      // Attach events
      var details = document.getElementById('queue-details');
      if (details) details.addEventListener('toggle', function() {
        var state = vscode.getState() || {};
        vscode.setState(Object.assign({}, state, { queueOpen: details.open }));
      });

      var addBtn = document.getElementById('btn-queue-add');
      if (addBtn) addBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'executeCommand', command: 'moonraker.addToQueue' });
      });

      var startBtn = document.getElementById('btn-queue-start');
      if (startBtn) startBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'executeCommand', command: 'moonraker.startQueue' });
      });

      var pauseBtn = document.getElementById('btn-queue-pause');
      if (pauseBtn) pauseBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'executeCommand', command: 'moonraker.pauseQueue' });
      });

      var clearBtn = document.getElementById('btn-queue-clear');
      if (clearBtn) clearBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'executeCommand', command: 'moonraker.clearQueue' });
      });

      document.querySelectorAll('.queue-remove').forEach(function(btn) {
        btn.addEventListener('click', function() {
          var jobId = btn.getAttribute('data-job-id');
          vscode.postMessage({ type: 'executeCommand', command: 'moonraker.removeFromQueue', args: [jobId] });
        });
      });
    }

    // ── Message handling ─────────────────────────────────────────────────────

    let lastState = null;

    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (msg.type === 'update') {
        lastState = msg;
        renderStatus(msg.status, msg.tempHistory);
        renderPrintHistory(msg.printHistory);
        updateControlsIfNeeded(msg.status);
      } else if (msg.type === 'disconnected') {
        lastState = null;
        posA = null; posB = null;
        renderDisconnected();
        updateControlsIfNeeded(null);
        document.getElementById('macros-root').innerHTML = '';
        document.getElementById('queue-root').innerHTML = '';
        document.getElementById('history-root').innerHTML = '';
      } else if (msg.type === 'macros') {
        renderMacros(msg.macros);
      } else if (msg.type === 'jobQueue') {
        renderJobQueue(msg.queueState, msg.queuedJobs);
      } else if (msg.type === 'position') {
        posA = posB;
        posATime = posBTime;
        posB = { x: msg.x, y: msg.y, z: msg.z };
        posBTime = performance.now();
      }
    });

    // Redraw chart on resize
    let resizeTimer;
    window.addEventListener('resize', function() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function() {
        if (!lastState) return;
        const canvas = document.getElementById('chart');
        if (canvas) drawChart(canvas, lastState.tempHistory);
      }, 100);
    });
  </script>
</body>
</html>`;
  }
}
