import * as vscode from 'vscode';
import { PrinterState, PrinterStatus } from './moonrakerClient';

export function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  const sec = Math.floor(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

export function stateLabel(state: PrinterState, connected: boolean): string {
  if (!connected) { return 'OFF'; }
  switch (state) {
    case 'printing': return 'PRINTING';
    case 'paused':   return 'PAUSED';
    case 'finished': return 'FINISHED';
    case 'error':    return 'ERROR';
    case 'idle':     return 'IDLE';
    default:         return 'OFF';
  }
}

export class StatusBarManager {
  private item: vscode.StatusBarItem;
  private connected = false;

  constructor(context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
    this.item.command = 'moonraker.reconnect';
    this.item.tooltip = 'Moonraker 3D Printer — click to reconnect';
    this.item.text = '$(layers) OFF';
    this.item.show();
    context.subscriptions.push(this.item);
  }

  setConnected(val: boolean): void {
    this.connected = val;
    if (!val) {
      this.item.text = '$(layers) OFF';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.backgroundColor = undefined;
    }
  }

  update(status: PrinterStatus): void {
    this.connected = true;
    const cfg = vscode.workspace.getConfiguration('moonraker.statusBar');

    const parts: string[] = [];

    // Icon + state
    const icon = status.state === 'error' ? '$(error)' : '$(layers)';
    if (cfg.get<boolean>('showStatus', true)) {
      parts.push(`${icon} ${stateLabel(status.state, true)}`);
    } else {
      parts.push(icon);
    }

    const isPrinting = status.state === 'printing' || status.state === 'paused';

    // File name
    if (isPrinting && cfg.get<boolean>('showFileName', true) && status.filename) {
      // Trim long names
      const name = status.filename.replace(/\.gcode$/i, '');
      parts.push(name.length > 20 ? name.slice(0, 18) + '…' : name);
    }

    // Hotend temp
    if (cfg.get<boolean>('showHotendTemp', true)) {
      const t = status.hotendTemp.toFixed(0);
      const target = status.hotendTarget.toFixed(0);
      parts.push(`H:${t}°/${target}°`);
    }

    // Bed temp
    if (cfg.get<boolean>('showBedTemp', true)) {
      const t = status.bedTemp.toFixed(0);
      const target = status.bedTarget.toFixed(0);
      parts.push(`B:${t}°/${target}°`);
    }

    // ETA (only while printing)
    if (isPrinting && cfg.get<boolean>('showETA', true) && status.etaSeconds !== undefined) {
      parts.push(`ETA:${formatSeconds(status.etaSeconds)}`);
    }

    // Total/elapsed time (only while printing)
    if (isPrinting && cfg.get<boolean>('showTotalTime', true) && status.printDuration > 0) {
      parts.push(`T:${formatSeconds(status.printDuration)}`);
    }

    this.item.text = parts.join('  ');
    this.item.backgroundColor =
      status.state === 'error'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : undefined;
  }

  refresh(): void {
    this.item.text = '$(layers) OFF';
    this.connected = false;
  }

  dispose(): void {
    this.item.dispose();
  }
}
