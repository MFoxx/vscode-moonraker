import * as vscode from 'vscode';
import { MoonrakerClient, PrinterState, PrinterStatus, ToolheadPosition } from './moonrakerClient';
import { StatusBarManager } from './statusBar';
import { SidebarProvider } from './sidebarProvider';
import { MoonrakerFileSystemProvider, browseConfigFiles, promptFirmwareRestart } from './configFileProvider';

let client: MoonrakerClient | undefined;

function notifyStateChange(
  prev: PrinterState | undefined,
  status: PrinterStatus,
  outputChannel: vscode.OutputChannel,
): void {
  if (prev === undefined || prev === status.state) { return; }

  outputChannel.appendLine(`State: ${prev} → ${status.state}`);

  if (!vscode.workspace.getConfiguration('moonraker').get<boolean>('notifications.enabled', true)) { return; }

  const curr = status.state;
  const file = status.filename ? ` — ${status.filename.replace(/\.gcode$/i, '')}` : '';

  if (curr === 'printing' && prev !== 'paused') {
    void vscode.window.showInformationMessage(`Print started${file}`);
  } else if (curr === 'printing' && prev === 'paused') {
    void vscode.window.showInformationMessage(`Print resumed${file}`);
  } else if (curr === 'paused') {
    void vscode.window.showWarningMessage(`Print paused${file}`);
  } else if (curr === 'finished') {
    void vscode.window.showInformationMessage(`Print finished${file}`);
  } else if (curr === 'idle' && (prev === 'printing' || prev === 'paused')) {
    void vscode.window.showWarningMessage(`Print cancelled${file}`);
  } else if (curr === 'error') {
    void vscode.window.showErrorMessage(`Printer error${file}`);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel('Moonraker');
  context.subscriptions.push(outputChannel);

  client = new MoonrakerClient(outputChannel);
  const statusBar = new StatusBarManager(context);
  const sidebar = new SidebarProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('moonraker.sidebarView', sidebar),
  );

  const fsProvider = new MoonrakerFileSystemProvider(client);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('moonraker', fsProvider, { isCaseSensitive: true }),
    promptFirmwareRestart(client),
  );

  let lastPrinterState: PrinterState | undefined;

  client.on('status', (status, tempHistory) => {
    notifyStateChange(lastPrinterState, status, outputChannel);
    lastPrinterState = status.state;
    statusBar.update(status);
    sidebar.update(status, tempHistory);
  });

  client.on('printHistory', (entries) => {
    sidebar.setPrintHistory(entries);
  });

  client.on('macros', (macros) => {
    sidebar.setMacros(macros);
  });

  client.on('jobQueue', (queueStatus) => {
    sidebar.setJobQueue(queueStatus);
  });

  client.on('position', (pos: ToolheadPosition) => {
    sidebar.updatePosition(pos);
  });

  client.on('connected', () => {
    statusBar.setConnected(true);
    outputChannel.appendLine('Moonraker: connected');
  });

  client.on('disconnected', () => {
    lastPrinterState = undefined;
    statusBar.setConnected(false);
    sidebar.setDisconnected();
    outputChannel.appendLine('Moonraker: disconnected');
  });

  client.on('error', (err: Error) => {
    outputChannel.appendLine(`Moonraker error: ${err.message}`);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('moonraker.connect', () => client?.connect()),
    vscode.commands.registerCommand('moonraker.disconnect', () => {
      client?.disconnect();
      statusBar.setConnected(false);
    }),
    vscode.commands.registerCommand('moonraker.reconnect', () => client?.reconnect()),
    vscode.commands.registerCommand('moonraker.openWebUI', () => {
      const url = vscode.workspace.getConfiguration('moonraker').get<string>('webUiUrl', '').trim();
      if (!url) {
        vscode.window.showWarningMessage('No web UI URL configured. Set moonraker.webUiUrl in settings.');
        return;
      }
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }),
    vscode.commands.registerCommand('moonraker.sendGcodeScript', async (script: string) => {
      try { await client?.sendGcode(script); }
      catch (e) { void vscode.window.showErrorMessage(`Command failed: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.emergencyStop', async () => {
      const answer = await vscode.window.showWarningMessage(
        'Send EMERGENCY STOP? This immediately halts all motion.',
        { modal: true },
        'Emergency Stop',
      );
      if (answer !== 'Emergency Stop') { return; }
      try { await client?.emergencyStop(); }
      catch (e) { void vscode.window.showErrorMessage(`Emergency stop failed: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.homeAxes', async () => {
      try { await client?.sendGcode('G28'); }
      catch (e) { void vscode.window.showErrorMessage(`Home axes failed: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.heatBed', async () => {
      const mode = await vscode.window.showQuickPick(
        [
          { label: 'Heat', description: 'M140 — set target and continue', cmd: 'M140' },
          { label: 'Heat and wait', description: 'M190 — set target and wait until reached', cmd: 'M190' },
        ],
        { title: 'Heat Bed', placeHolder: 'Select heating mode' },
      );
      if (!mode) { return; }
      const input = await vscode.window.showInputBox({
        title: `Heat Bed — ${mode.label}`,
        prompt: 'Enter target temperature in °C (0 to turn off)',
        validateInput: (v) => {
          const n = Number(v);
          return (isNaN(n) || n < 0 || n > 130) ? 'Enter a number between 0 and 130' : null;
        },
      });
      if (input === undefined) { return; }
      try { await client?.sendGcode(`${mode.cmd} S${Number(input)}`); }
      catch (e) { void vscode.window.showErrorMessage(`Heat bed failed: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.heatExtruder', async () => {
      const mode = await vscode.window.showQuickPick(
        [
          { label: 'Heat', description: 'M104 — set target and continue', cmd: 'M104' },
          { label: 'Heat and wait', description: 'M109 — set target and wait until reached', cmd: 'M109' },
        ],
        { title: 'Heat Extruder', placeHolder: 'Select heating mode' },
      );
      if (!mode) { return; }
      const input = await vscode.window.showInputBox({
        title: `Heat Extruder — ${mode.label}`,
        prompt: 'Enter target temperature in °C (0 to turn off)',
        validateInput: (v) => {
          const n = Number(v);
          return (isNaN(n) || n < 0 || n > 300) ? 'Enter a number between 0 and 300' : null;
        },
      });
      if (input === undefined) { return; }
      try { await client?.sendGcode(`${mode.cmd} S${Number(input)}`); }
      catch (e) { void vscode.window.showErrorMessage(`Heat extruder failed: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.setSpeedFactor', async () => {
      const input = await vscode.window.showInputBox({
        title: 'Set Print Speed Factor',
        prompt: 'Enter speed percentage (50–150)',
        validateInput: (v) => {
          const n = Number(v);
          return (isNaN(n) || n < 50 || n > 150) ? 'Enter a number between 50 and 150' : null;
        },
      });
      if (input === undefined) { return; }
      try { await client?.sendGcode(`M220 S${Number(input)}`); }
      catch (e) { void vscode.window.showErrorMessage(`Set speed factor failed: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.showLogs', async () => {
      if (!client) { return; }
      try {
        const files = await client.fetchLogFiles();
        if (!files.length) {
          void vscode.window.showInformationMessage('No log files found on the printer.');
          return;
        }
        files.sort((a, b) => b.modified - a.modified);
        const picked = await vscode.window.showQuickPick(
          files.map((f) => ({
            label: f.filename,
            description: `${(f.size / 1024).toFixed(1)} KB`,
            detail: new Date(f.modified * 1000).toLocaleString(),
            filename: f.filename,
          })),
          { title: 'Moonraker: Select Log File', placeHolder: 'Choose a log file to view' },
        );
        if (!picked) { return; }
        const content = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Fetching ${picked.filename}…` },
          () => client!.fetchLogContent(picked.filename),
        );
        const doc = await vscode.workspace.openTextDocument({ content, language: 'log' });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (e) {
        void vscode.window.showErrorMessage(`Failed to fetch logs: ${e}`);
      }
    }),
    vscode.commands.registerCommand('moonraker.browseConfigFiles', () => {
      if (!client) { return; }
      return browseConfigFiles(client);
    }),
    vscode.commands.registerCommand('moonraker.setFanSpeed', async () => {
      const input = await vscode.window.showInputBox({
        title: 'Set Fan Speed',
        prompt: 'Enter fan speed percentage (0–100)',
        validateInput: (v) => {
          const n = Number(v);
          return (isNaN(n) || n < 0 || n > 100) ? 'Enter a number between 0 and 100' : null;
        },
      });
      if (input === undefined) { return; }
      const s = Math.round(Number(input) * 255 / 100);
      try { await client?.sendGcode(`M106 S${s}`); }
      catch (e) { void vscode.window.showErrorMessage(`Set fan speed failed: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.addToQueue', async () => {
      if (!client) { return; }
      try {
        const files = await client.fetchGcodeFiles();
        if (!files.length) {
          void vscode.window.showInformationMessage('No GCode files found on the printer.');
          return;
        }
        files.sort((a, b) => b.modified - a.modified);
        const picks = await vscode.window.showQuickPick(
          files.map((f) => ({
            label: f.path,
            description: `${(f.size / 1024).toFixed(1)} KB`,
          })),
          { title: 'Add to Print Queue', placeHolder: 'Select GCode file(s) to queue', canPickMany: true },
        );
        if (!picks || !picks.length) { return; }
        await client.enqueueJobs(picks.map((p) => p.label));
      } catch (e) {
        void vscode.window.showErrorMessage(`Failed to add to queue: ${e}`);
      }
    }),
    vscode.commands.registerCommand('moonraker.removeFromQueue', async (jobId: string) => {
      if (!client || !jobId) { return; }
      try { await client.removeFromQueue([jobId]); }
      catch (e) { void vscode.window.showErrorMessage(`Failed to remove from queue: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.clearQueue', async () => {
      if (!client) { return; }
      try { await client.clearJobQueue(); }
      catch (e) { void vscode.window.showErrorMessage(`Failed to clear queue: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.startQueue', async () => {
      if (!client) { return; }
      try { await client.startQueue(); }
      catch (e) { void vscode.window.showErrorMessage(`Failed to start queue: ${e}`); }
    }),
    vscode.commands.registerCommand('moonraker.pauseQueue', async () => {
      if (!client) { return; }
      try { await client.pauseQueue(); }
      catch (e) { void vscode.window.showErrorMessage(`Failed to pause queue: ${e}`); }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('moonraker')) {
        if (
          e.affectsConfiguration('moonraker.apiUrl') ||
          e.affectsConfiguration('moonraker.port')   ||
          e.affectsConfiguration('moonraker.apiKey')  ||
          e.affectsConfiguration('moonraker.chamberSensorName')
        ) {
          client?.reconnect();
        }
        if (
          e.affectsConfiguration('moonraker.webUiUrl') ||
          e.affectsConfiguration('moonraker.webUiLabel') ||
          e.affectsConfiguration('moonraker.experimental.enabled') ||
          e.affectsConfiguration('moonraker.experimental.positionVisualization') ||
          e.affectsConfiguration('moonraker.bedWidth') ||
          e.affectsConfiguration('moonraker.bedHeight')
        ) {
          sidebar.rebuildHtml();
        }
        if (
          e.affectsConfiguration('moonraker.experimental.positionVisualization') ||
          e.affectsConfiguration('moonraker.positionPollingInterval')
        ) {
          client?.restartPositionPoll();
        }
        statusBar.refresh();
      }
    }),
  );

  client.connect();
}

export function deactivate(): void {
  client?.disconnect();
}
