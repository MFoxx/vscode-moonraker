import * as http from 'http';
import * as https from 'https';
import { EventEmitter } from 'events';
import * as vscode from 'vscode';

export type PrinterState = 'off' | 'idle' | 'printing' | 'paused' | 'finished' | 'error';

export interface PrinterStatus {
  state: PrinterState;
  filename?: string;
  hotendTemp: number;
  hotendTarget: number;
  bedTemp: number;
  bedTarget: number;
  chamberTemp?: number;
  chamberTarget?: number;
  progress: number;          // 0–1
  printDuration: number;     // seconds actively printing
  totalDuration: number;     // seconds since job started
  etaSeconds?: number;       // seconds remaining
  finishTime?: number;       // epoch ms (wall-clock finish)
  currentLayer?: number;
  totalLayers?: number;
  fanSpeed?: number;         // 0–1
  speedFactor?: number;      // 0–1  (print speed override)
  flowRate?: number;         // 0–1  (extrusion multiplier)
  filamentUsed?: number;     // mm
  toolheadX?: number;
  toolheadY?: number;
  toolheadZ?: number;
  thumbnailData?: string;    // base64 data URI
}

export interface TemperaturePoint {
  time: number;   // Date.now()
  hotend: number;
  bed: number;
}

export interface PrintHistoryEntry {
  jobId: string;
  filename: string;
  status: string;          // 'completed' | 'cancelled' | 'error' | ...
  startTime: number;       // epoch seconds
  totalDuration: number;   // seconds
  filamentUsed: number;    // mm
}

export interface JobQueueEntry {
  filename: string;
  jobId: string;
  timeAdded: number;       // epoch seconds
  timeInQueue: number;     // seconds
}

export type JobQueueState = 'ready' | 'loading' | 'starting' | 'paused';

export interface JobQueueStatus {
  queueState: JobQueueState;
  queuedJobs: JobQueueEntry[];
}

export interface GcodeFileInfo {
  path: string;
  modified: number;
  size: number;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

function httpGet(url: string, timeoutMs = 5000, headers: Record<string, string> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: timeoutMs, headers }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function httpGetBuffer(url: string, headers: Record<string, string> = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: 8000, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function httpPost(url: string, body: Record<string, unknown>, timeoutMs = 5000, headers: Record<string, string> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || (url.startsWith('https') ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse error: ${e}`)); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

function httpPostMultipart(
  url: string,
  fields: Record<string, string>,
  file: { fieldName: string; filename: string; content: Buffer },
  timeoutMs: number,
  headers: Record<string, string>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const boundary = '----MoonrakerUpload' + Date.now().toString(36);
    const parts: Buffer[] = [];

    for (const [key, value] of Object.entries(fields)) {
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`,
      ));
    }

    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    ));
    parts.push(file.content);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const body = Buffer.concat(parts);
    const parsed = new URL(url);
    const mod = url.startsWith('https') ? https : http;

    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || (url.startsWith('https') ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
            reject(new Error(`Upload failed (HTTP ${res.statusCode}): ${data}`));
            return;
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse error: ${e}`)); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(body);
    req.end();
  });
}

function httpDelete(url: string, timeoutMs = 5000, headers: Record<string, string> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = url.startsWith('https') ? https : http;
    const req = mod.request(
      {
        hostname: parsed.hostname,
        port: Number(parsed.port) || (url.startsWith('https') ? 443 : 80),
        path: parsed.pathname + (parsed.search || ''),
        method: 'DELETE',
        headers: { ...headers },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => (data += chunk));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`JSON parse error: ${e}`)); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

// ─── State mapping ────────────────────────────────────────────────────────────

export function mapState(raw: string): PrinterState {
  switch (raw) {
    case 'printing':  return 'printing';
    case 'paused':    return 'paused';
    case 'complete':  return 'finished';
    case 'error':     return 'error';
    default:          return 'idle';
  }
}

// ─── Event type overloads ─────────────────────────────────────────────────────

export interface ToolheadPosition { x: number; y: number; z: number; }

export declare interface MoonrakerClient {
  on(event: 'status',       listener: (status: PrinterStatus, tempHistory: TemperaturePoint[]) => void): this;
  on(event: 'printHistory', listener: (entries: PrintHistoryEntry[]) => void): this;
  on(event: 'macros',       listener: (macros: string[]) => void): this;
  on(event: 'position',     listener: (pos: ToolheadPosition) => void): this;
  on(event: 'jobQueue',     listener: (status: JobQueueStatus) => void): this;
  on(event: 'connected',    listener: () => void): this;
  on(event: 'disconnected', listener: () => void): this;
  on(event: 'error',        listener: (err: Error) => void): this;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class MoonrakerClient extends EventEmitter {
  private timer: NodeJS.Timeout | undefined;
  private posTimer: NodeJS.Timeout | undefined;
  private connected = false;
  private tempHistory: TemperaturePoint[] = [];
  private lastFilename: string | undefined;
  private thumbnailData: string | undefined;
  private lastState: PrinterState = 'off';
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    super();
    this.outputChannel = outputChannel;
  }

  // ── Config accessors ────────────────────────────────────────────────────────

  private get baseUrl(): string {
    const cfg = vscode.workspace.getConfiguration('moonraker');
    const apiUrl = (cfg.get<string>('apiUrl') ?? 'http://localhost').replace(/\/$/, '');
    const port = cfg.get<number>('port') ?? 7125;
    return `${apiUrl}:${port}`;
  }

  private get pollingInterval(): number {
    return vscode.workspace.getConfiguration('moonraker').get<number>('pollingInterval') ?? 2000;
  }

  private get historySize(): number {
    return vscode.workspace.getConfiguration('moonraker').get<number>('temperatureHistorySize') ?? 120;
  }

  private get chamberSensorName(): string {
    return vscode.workspace.getConfiguration('moonraker').get<string>('chamberSensorName') ?? '';
  }

  private get posVizEnabled(): boolean {
    return vscode.workspace.getConfiguration('moonraker').get<boolean>('experimental.positionVisualization', false);
  }

  private get posInterval(): number {
    return vscode.workspace.getConfiguration('moonraker').get<number>('positionPollingInterval', 200);
  }

  private get apiHeaders(): Record<string, string> {
    const key = vscode.workspace.getConfiguration('moonraker').get<string>('apiKey', '').trim();
    return key ? { 'X-Api-Key': key } : {};
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  connect(): void {
    this.disconnect();
    this.poll();
  }

  disconnect(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.stopPositionPoll();
    if (this.connected) {
      this.connected = false;
      this.emit('disconnected');
    }
  }

  reconnect(): void {
    this.tempHistory = [];
    this.lastFilename = undefined;
    this.thumbnailData = undefined;
    this.lastState = 'off';
    this.connect();
  }

  restartPositionPoll(): void {
    this.stopPositionPoll();
    if (this.connected) { this.startPositionPoll(); }
  }

  async sendGcode(script: string): Promise<void> {
    // Moonraker's gcode/script endpoint is synchronous and waits for completion,
    // so long-running commands (e.g. G28) need a generous timeout.
    await httpPost(`${this.baseUrl}/printer/gcode/script`, { script }, 120_000, this.apiHeaders);
  }

  async emergencyStop(): Promise<void> {
    await httpPost(`${this.baseUrl}/printer/emergency_stop`, {}, 5000, this.apiHeaders);
  }

  async fetchLogFiles(): Promise<{ filename: string; modified: number; size: number }[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await httpGet(`${this.baseUrl}/server/files/directory?path=logs`, 5000, this.apiHeaders) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data?.result?.files ?? []).map((f: any) => ({
      filename: f.filename as string,
      modified: f.modified as number,
      size: f.size as number,
    }));
  }

  async fetchLogContent(filename: string): Promise<string> {
    const buf = await httpGetBuffer(
      `${this.baseUrl}/server/files/logs/${encodeURIComponent(filename)}`,
      this.apiHeaders,
    );
    return buf.toString('utf-8');
  }

  get isConnected(): boolean { return this.connected; }

  async listFiles(root: string): Promise<Array<{ path: string; modified: number; size: number }>> {
    const url = `${this.baseUrl}/server/files/list?root=${encodeURIComponent(root)}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await httpGet(url, 5000, this.apiHeaders) as any;
    return data?.result ?? [];
  }

  async readFile(root: string, filePath: string): Promise<Buffer> {
    const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
    const url = `${this.baseUrl}/server/files/${encodeURIComponent(root)}/${encodedPath}`;
    return httpGetBuffer(url, this.apiHeaders);
  }

  async writeFile(root: string, filePath: string, content: Buffer): Promise<void> {
    const url = `${this.baseUrl}/server/files/upload`;
    const lastSlash = filePath.lastIndexOf('/');
    const dir = lastSlash >= 0 ? filePath.substring(0, lastSlash) : '';
    const filename = lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;

    const fields: Record<string, string> = { root };
    if (dir) { fields.path = dir; }

    await httpPostMultipart(url, fields, {
      fieldName: 'file',
      filename,
      content,
    }, 10_000, this.apiHeaders);
  }

  async fetchGcodeFiles(): Promise<GcodeFileInfo[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await httpGet(`${this.baseUrl}/server/files/list`, 5000, this.apiHeaders) as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data?.result ?? []).map((f: any) => ({
      path: f.path as string,
      modified: f.modified as number,
      size: f.size as number,
    }));
  }

  async fetchJobQueue(): Promise<void> {
    try {
      const url = `${this.baseUrl}/server/job_queue/status`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await httpGet(url, 5000, this.apiHeaders) as any;
      const result = data?.result ?? {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const queuedJobs: JobQueueEntry[] = (result.queued_jobs ?? []).map((j: any) => ({
        filename: j.filename,
        jobId: j.job_id,
        timeAdded: j.time_added,
        timeInQueue: j.time_in_queue,
      }));
      this.emit('jobQueue', {
        queueState: result.queue_state ?? 'paused',
        queuedJobs,
      } as JobQueueStatus);
    } catch (e) {
      this.outputChannel.appendLine(`Job queue fetch failed: ${e}`);
    }
  }

  async enqueueJobs(filenames: string[]): Promise<void> {
    await httpPost(`${this.baseUrl}/server/job_queue/job`, { filenames }, 5000, this.apiHeaders);
    void this.fetchJobQueue();
  }

  async removeFromQueue(jobIds: string[]): Promise<void> {
    const ids = jobIds.map(encodeURIComponent).join(',');
    await httpDelete(`${this.baseUrl}/server/job_queue/job?job_ids=${ids}`, 5000, this.apiHeaders);
    void this.fetchJobQueue();
  }

  async clearJobQueue(): Promise<void> {
    await httpDelete(`${this.baseUrl}/server/job_queue/job?all=true`, 5000, this.apiHeaders);
    void this.fetchJobQueue();
  }

  async startQueue(): Promise<void> {
    await httpPost(`${this.baseUrl}/server/job_queue/start`, {}, 5000, this.apiHeaders);
    void this.fetchJobQueue();
  }

  async pauseQueue(): Promise<void> {
    await httpPost(`${this.baseUrl}/server/job_queue/pause`, {}, 5000, this.apiHeaders);
    void this.fetchJobQueue();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private startPositionPoll(): void {
    this.stopPositionPoll();
    if (!this.posVizEnabled) { return; }
    const tick = async () => {
      if (!this.connected || !this.posVizEnabled) { return; }
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = await httpGet(`${this.baseUrl}/printer/objects/query?motion_report`, 2000, this.apiHeaders) as any;
        const pos = data?.result?.status?.motion_report?.live_position as number[] | undefined;
        if (pos) { this.emit('position', { x: pos[0], y: pos[1], z: pos[2] }); }
      } catch { /* silent — position errors don't affect main connection */ }
      if (this.connected && this.posVizEnabled) {
        this.posTimer = setTimeout(() => void tick(), this.posInterval);
      }
    };
    this.posTimer = setTimeout(() => void tick(), this.posInterval);
  }

  private stopPositionPoll(): void {
    if (this.posTimer) { clearTimeout(this.posTimer); this.posTimer = undefined; }
  }

  private schedule(): void {
    this.timer = setTimeout(() => this.poll(), this.pollingInterval);
  }

  private buildQueryUrl(): string {
    const objects = [
      'print_stats',
      'extruder',
      'heater_bed',
      'display_status',
      'fan',
      'gcode_move',
      'toolhead',
    ];
    const sensor = this.chamberSensorName.trim();
    if (sensor) objects.push(`temperature_sensor ${sensor}`);
    return `${this.baseUrl}/printer/objects/query?` + objects.map(encodeURIComponent).join('&');
  }

  private async fetchThumbnail(filename: string): Promise<string | undefined> {
    try {
      const metaUrl = `${this.baseUrl}/server/files/thumbnails?filename=${encodeURIComponent(filename)}`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const meta = await httpGet(metaUrl, 5000, this.apiHeaders) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const thumbs: Array<{ width: number; height: number; size: number; thumbnail_path: string }> =
        meta?.result ?? [];
      if (!thumbs.length) return undefined;

      // Pick the largest (highest quality) thumbnail
      const thumb = thumbs.reduce((a, b) => (a.size > b.size ? a : b));
      const imageUrl = `${this.baseUrl}/server/files/gcodes/${thumb.thumbnail_path}`;
      const buf = await httpGetBuffer(imageUrl, this.apiHeaders);
      // Detect PNG vs JPEG by magic bytes
      const mime = buf[0] === 0x89 ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch (e) {
      this.outputChannel.appendLine(`Thumbnail fetch failed: ${e}`);
      return undefined;
    }
  }

  private async fetchMacros(): Promise<void> {
    try {
      const url = `${this.baseUrl}/printer/objects/list`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await httpGet(url, 5000, this.apiHeaders) as any;
      const objects: string[] = data?.result?.objects ?? [];
      const prefix = 'gcode_macro ';
      const macros = objects
        .filter((o: string) => o.startsWith(prefix))
        .map((o: string) => o.slice(prefix.length))
        .filter((name: string) => !name.startsWith('_'))
        .sort((a: string, b: string) => a.localeCompare(b));
      this.emit('macros', macros);
    } catch (e) {
      this.outputChannel.appendLine(`Macro fetch failed: ${e}`);
    }
  }

  private async fetchPrintHistory(): Promise<void> {
    try {
      const url = `${this.baseUrl}/server/history/list?limit=5&order=desc`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await httpGet(url, 5000, this.apiHeaders) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const jobs: PrintHistoryEntry[] = (data?.result?.jobs ?? []).map((j: any) => ({
        jobId: j.job_id,
        filename: j.filename,
        status: j.status,
        startTime: j.start_time,
        totalDuration: j.total_duration ?? 0,
        filamentUsed: j.filament_used ?? 0,
      }));
      this.emit('printHistory', jobs);
    } catch (e) {
      this.outputChannel.appendLine(`History fetch failed: ${e}`);
    }
  }

  private async poll(): Promise<void> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await httpGet(this.buildQueryUrl(), 5000, this.apiHeaders) as any;
      const s = data?.result?.status ?? {};

      if (!this.connected) {
        this.connected = true;
        this.emit('connected');
        this.outputChannel.appendLine(`Connected to Moonraker at ${this.baseUrl}`);
        void this.fetchPrintHistory();
        void this.fetchMacros();
        void this.fetchJobQueue();
        this.startPositionPoll();
      }

      // ── Core temps & state ────────────────────────────────────────────────
      const hotendTemp    = s.extruder?.temperature ?? 0;
      const hotendTarget  = s.extruder?.target ?? 0;
      const bedTemp       = s.heater_bed?.temperature ?? 0;
      const bedTarget     = s.heater_bed?.target ?? 0;
      const progress      = s.display_status?.progress ?? 0;
      const printDuration = s.print_stats?.print_duration ?? 0;
      const totalDuration = s.print_stats?.total_duration ?? 0;
      const rawState      = s.print_stats?.state ?? 'standby';
      const filename      = s.print_stats?.filename as string | undefined || undefined;
      const state         = mapState(rawState);

      // ── Optional fields ───────────────────────────────────────────────────
      const currentLayer = s.print_stats?.current_layer as number | undefined;
      const totalLayers  = s.print_stats?.total_layer_count as number | undefined;
      const fanSpeed     = s.fan?.speed as number | undefined;
      const speedFactor  = s.gcode_move?.speed_factor as number | undefined;
      const flowRate     = s.gcode_move?.extrude_factor as number | undefined;
      const filamentUsed = s.print_stats?.filament_used as number | undefined;
      const pos          = s.toolhead?.position as number[] | undefined;

      // Chamber (key depends on user config)
      const sensor = this.chamberSensorName.trim();
      const chamberKey = sensor ? `temperature_sensor ${sensor}` : null;
      const chamberTemp   = chamberKey ? (s[chamberKey]?.temperature as number | undefined) : undefined;
      const chamberTarget = chamberKey ? (s[chamberKey]?.target as number | undefined)      : undefined;

      // ── Derived ───────────────────────────────────────────────────────────
      const etaSeconds =
        state === 'printing' && progress > 0.01
          ? printDuration * (1 - progress) / progress
          : undefined;
      const finishTime =
        etaSeconds !== undefined ? Date.now() + etaSeconds * 1000 : undefined;

      // ── Thumbnail: re-fetch only when filename changes ────────────────────
      if (filename !== this.lastFilename) {
        this.lastFilename = filename;
        this.thumbnailData = undefined;
        if (filename) {
          void this.fetchThumbnail(filename).then((d) => { this.thumbnailData = d; });
        }
      }

      // ── Print history & job queue: re-fetch on state transitions ──────────
      if (state !== this.lastState) {
        if (state === 'finished') { void this.fetchPrintHistory(); }
        void this.fetchJobQueue();
      }
      this.lastState = state;

      const status: PrinterStatus = {
        state,
        filename,
        hotendTemp, hotendTarget,
        bedTemp, bedTarget,
        chamberTemp, chamberTarget,
        progress,
        printDuration, totalDuration,
        etaSeconds, finishTime,
        currentLayer, totalLayers,
        fanSpeed, speedFactor, flowRate,
        filamentUsed,
        toolheadX: pos?.[0],
        toolheadY: pos?.[1],
        toolheadZ: pos?.[2],
        thumbnailData: this.thumbnailData,
      };

      // ── Temperature history ────────────────────────────────────────────────
      this.tempHistory.push({ time: Date.now(), hotend: hotendTemp, bed: bedTemp });
      if (this.tempHistory.length > this.historySize) {
        this.tempHistory.splice(0, this.tempHistory.length - this.historySize);
      }

      this.emit('status', status, [...this.tempHistory]);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (this.connected) {
        this.connected = false;
        this.emit('disconnected');
        this.outputChannel.appendLine(`Disconnected: ${error.message}`);
      }
      this.emit('error', error);
    }

    this.schedule();
  }
}
