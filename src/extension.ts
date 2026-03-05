import * as vscode from 'vscode';
import { MoonrakerClient, PrinterState, PrinterStatus, ToolheadPosition } from './moonrakerClient';
import { StatusBarManager } from './statusBar';
import { SidebarProvider } from './sidebarProvider';

let client: MoonrakerClient | undefined;

function notifyStateChange(prev: PrinterState | undefined, status: PrinterStatus): void {
  if (prev === undefined || prev === status.state) { return; }
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

  let lastPrinterState: PrinterState | undefined;

  client.on('status', (status, tempHistory) => {
    notifyStateChange(lastPrinterState, status);
    lastPrinterState = status.state;
    statusBar.update(status);
    sidebar.update(status, tempHistory);
  });

  client.on('printHistory', (entries) => {
    sidebar.setPrintHistory(entries);
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
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('moonraker')) {
        if (
          e.affectsConfiguration('moonraker.apiUrl') ||
          e.affectsConfiguration('moonraker.port')   ||
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
