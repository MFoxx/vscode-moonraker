import * as vscode from 'vscode';
import { MoonrakerClient } from './moonrakerClient';

export class MoonrakerFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._emitter.event;

  constructor(private readonly client: MoonrakerClient) {}

  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    return { type: vscode.FileType.File, ctime: 0, mtime: Date.now(), size: 0 };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    if (!this.client.isConnected) {
      throw vscode.FileSystemError.Unavailable('Not connected to Moonraker');
    }
    // URI path: /{root}/{filepath}  e.g. /config/printer.cfg
    const { root, filePath } = parseMoonrakerUri(uri);
    return this.client.readFile(root, filePath);
  }

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    if (!this.client.isConnected) {
      throw vscode.FileSystemError.Unavailable('Not connected to Moonraker');
    }
    const { root, filePath } = parseMoonrakerUri(uri);
    await this.client.writeFile(root, filePath, Buffer.from(content));
    this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  readDirectory(): [string, vscode.FileType][] { throw vscode.FileSystemError.NoPermissions(); }
  createDirectory(): void { throw vscode.FileSystemError.NoPermissions(); }
  delete(): void { throw vscode.FileSystemError.NoPermissions(); }
  rename(): void { throw vscode.FileSystemError.NoPermissions(); }
}

function parseMoonrakerUri(uri: vscode.Uri): { root: string; filePath: string } {
  // path = /config/printer.cfg  or  /config/includes/stepper.cfg
  const parts = uri.path.replace(/^\//, '').split('/');
  const root = parts[0];
  const filePath = parts.slice(1).join('/');
  return { root, filePath };
}

export async function browseConfigFiles(client: MoonrakerClient): Promise<void> {
  if (!client.isConnected) {
    void vscode.window.showWarningMessage('Not connected to Moonraker.');
    return;
  }

  const files = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Fetching config files…' },
    () => client.listFiles('config'),
  );

  if (!files.length) {
    void vscode.window.showInformationMessage('No config files found on the printer.');
    return;
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const picked = await vscode.window.showQuickPick(
    files.map((f) => ({
      label: f.path,
      description: `${(f.size / 1024).toFixed(1)} KB`,
      detail: new Date(f.modified * 1000).toLocaleString(),
    })),
    { title: 'Moonraker: Open Config File', placeHolder: 'Select a config file to edit' },
  );

  if (!picked) { return; }

  const uri = vscode.Uri.parse(`moonraker:/config/${picked.label}`);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc, { preview: false });
}

export function promptFirmwareRestart(client: MoonrakerClient): vscode.Disposable {
  return vscode.workspace.onDidSaveTextDocument(async (doc) => {
    if (doc.uri.scheme !== 'moonraker') { return; }
    const { root } = parseMoonrakerUri(doc.uri);
    if (root !== 'config') { return; }

    const answer = await vscode.window.showInformationMessage(
      `Saved ${doc.uri.path.split('/').pop()} to printer. Restart firmware to apply changes?`,
      'Firmware Restart',
      'Host Restart',
      'Later',
    );

    if (answer === 'Firmware Restart') {
      try { await client.sendGcode('FIRMWARE_RESTART'); }
      catch (e) { void vscode.window.showErrorMessage(`Firmware restart failed: ${e}`); }
    } else if (answer === 'Host Restart') {
      try { await client.sendGcode('RESTART'); }
      catch (e) { void vscode.window.showErrorMessage(`Host restart failed: ${e}`); }
    }
  });
}
