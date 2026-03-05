import * as http from 'http';
import { MoonrakerClient, mapState, PrinterStatus, TemperaturePoint, PrintHistoryEntry } from '../moonrakerClient';
import { mockConfigValues } from '../../__mocks__/vscode';

jest.mock('http');

// ─── Helpers ──────────────────────────────────────────────────────────────────

// setImmediate is NOT faked, so this reliably waits for all pending Promises.
const flushPromises = () => new Promise<void>(r => setImmediate(r));

const mockReq = { on: jest.fn().mockReturnThis(), destroy: jest.fn() };

/** Build a mock IncomingMessage that emits data then end synchronously. */
function buildMockRes(body: string) {
  const res = {
    on: jest.fn().mockImplementation((event: string, handler: (d?: unknown) => void) => {
      if (event === 'data') handler(body);
      if (event === 'end')  handler();
      return res;
    }),
  };
  return res;
}

function setupHttpMock(responsesByUrl: Record<string, unknown> | unknown) {
  (http.get as jest.Mock).mockImplementation(
    (url: string, _opts: unknown, cb: (res: unknown) => void) => {
      const data =
        typeof responsesByUrl === 'object' && responsesByUrl !== null && !Array.isArray(responsesByUrl)
          ? (responsesByUrl as Record<string, unknown>)[url] ?? responsesByUrl
          : responsesByUrl;
      cb(buildMockRes(JSON.stringify(data)));
      return mockReq;
    },
  );
}

function setupHttpError(error: Error) {
  (http.get as jest.Mock).mockImplementation(
    (_url: string, _opts: unknown, _cb: unknown) => {
      const req = {
        on: jest.fn().mockImplementation((event: string, handler: (e: Error) => void) => {
          if (event === 'error') setImmediate(() => handler(error));
          return req;
        }),
        destroy: jest.fn(),
      };
      return req;
    },
  );
}

function buildStatusResponse(overrides: Record<string, unknown> = {}) {
  return {
    result: {
      status: {
        print_stats: {
          state: 'printing',
          filename: 'model.gcode',
          print_duration: 3600.0,
          total_duration: 3700.0,
          filament_used: 2500.0,
          current_layer: 42,
          total_layer_count: 180,
        },
        extruder:       { temperature: 210.5, target: 210.0 },
        heater_bed:     { temperature: 60.2,  target: 60.0  },
        display_status: { progress: 0.5 },
        fan:            { speed: 1.0 },
        gcode_move:     { speed_factor: 1.0, extrude_factor: 1.0 },
        toolhead:       { position: [120.5, 85.3, 0.15, 0] },
        ...overrides,
      },
    },
  };
}

function buildHistoryResponse(jobs: unknown[] = []) {
  return {
    result: {
      jobs: jobs.length ? jobs : [
        {
          job_id:         'abc123',
          filename:       'previous.gcode',
          status:         'completed',
          start_time:     1700000000.0,
          total_duration: 3600.0,
          filament_used:  5000.0,
        },
      ],
    },
  };
}

function collectStatus(client: MoonrakerClient): Promise<{ status: PrinterStatus; history: TemperaturePoint[] }> {
  return new Promise(resolve => {
    client.once('status', (status, history) => resolve({ status, history }));
  });
}

function collectHistory(client: MoonrakerClient): Promise<PrintHistoryEntry[]> {
  return new Promise(resolve => client.once('printHistory', resolve));
}

// ─── Test setup ───────────────────────────────────────────────────────────────

let client: MoonrakerClient;
const mockOutputChannel = { appendLine: jest.fn(), dispose: jest.fn() };

beforeEach(() => {
  // Reset config to defaults
  Object.assign(mockConfigValues, {
    apiUrl: 'http://localhost',
    port: 7125,
    pollingInterval: 100,
    temperatureHistorySize: 5,
    chamberSensorName: '',
  });
  client = new MoonrakerClient(mockOutputChannel as never);
});

afterEach(() => {
  client.disconnect();
  jest.clearAllMocks();
});

// ─── mapState ────────────────────────────────────────────────────────────────

describe('mapState', () => {
  it.each([
    ['printing', 'printing'],
    ['paused',   'paused'],
    ['complete', 'finished'],
    ['error',    'error'],
    ['standby',  'idle'],
    ['unknown',  'idle'],
    ['',         'idle'],
  ])('maps %s → %s', (raw, expected) => {
    expect(mapState(raw)).toBe(expected);
  });
});

// ─── MoonrakerClient – connection events ─────────────────────────────────────

describe('MoonrakerClient – connection', () => {
  it('emits connected on first successful poll', async () => {
    setupHttpMock(buildStatusResponse());
    const connected = jest.fn();
    client.once('connected', connected);

    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    await p;

    expect(connected).toHaveBeenCalledTimes(1);
  });

  it('does not emit connected again on subsequent polls', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] }); // must be before connect()
    setupHttpMock(buildStatusResponse());
    const connected = jest.fn();
    client.on('connected', connected);

    const p1 = collectStatus(client);
    client.connect();
    await flushPromises();
    await p1;

    const p2 = collectStatus(client);
    jest.runOnlyPendingTimers();
    await flushPromises();
    await p2;

    expect(connected).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('emits disconnected when already connected and disconnect() is called', async () => {
    setupHttpMock(buildStatusResponse());
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    await p;

    const disconnected = jest.fn();
    client.once('disconnected', disconnected);
    client.disconnect();

    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('does not emit disconnected if never connected', () => {
    const disconnected = jest.fn();
    client.on('disconnected', disconnected);
    client.disconnect();
    expect(disconnected).not.toHaveBeenCalled();
  });
});

// ─── MoonrakerClient – status field parsing ──────────────────────────────────

describe('MoonrakerClient – status parsing', () => {
  async function getPollResult(overrides: Record<string, unknown> = {}) {
    setupHttpMock(buildStatusResponse(overrides));
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    return p;
  }

  it('parses hotend temperature and target', async () => {
    const { status } = await getPollResult();
    expect(status.hotendTemp).toBe(210.5);
    expect(status.hotendTarget).toBe(210.0);
  });

  it('parses bed temperature and target', async () => {
    const { status } = await getPollResult();
    expect(status.bedTemp).toBe(60.2);
    expect(status.bedTarget).toBe(60.0);
  });

  it('parses print state', async () => {
    const { status } = await getPollResult();
    expect(status.state).toBe('printing');
  });

  it('parses filename', async () => {
    const { status } = await getPollResult();
    expect(status.filename).toBe('model.gcode');
  });

  it('parses progress', async () => {
    const { status } = await getPollResult();
    expect(status.progress).toBe(0.5);
  });

  it('parses printDuration and totalDuration', async () => {
    const { status } = await getPollResult();
    expect(status.printDuration).toBe(3600.0);
    expect(status.totalDuration).toBe(3700.0);
  });

  it('parses layer info', async () => {
    const { status } = await getPollResult();
    expect(status.currentLayer).toBe(42);
    expect(status.totalLayers).toBe(180);
  });

  it('parses fan speed', async () => {
    const { status } = await getPollResult();
    expect(status.fanSpeed).toBe(1.0);
  });

  it('parses speed factor and flow rate', async () => {
    const { status } = await getPollResult({
      gcode_move: { speed_factor: 0.8, extrude_factor: 0.9 },
    });
    expect(status.speedFactor).toBe(0.8);
    expect(status.flowRate).toBe(0.9);
  });

  it('parses filament used', async () => {
    const { status } = await getPollResult();
    expect(status.filamentUsed).toBe(2500.0);
  });

  it('parses toolhead XYZ position', async () => {
    const { status } = await getPollResult();
    expect(status.toolheadX).toBeCloseTo(120.5);
    expect(status.toolheadY).toBeCloseTo(85.3);
    expect(status.toolheadZ).toBeCloseTo(0.15);
  });

  it('returns undefined for missing optional fields', async () => {
    const { status } = await getPollResult({
      fan: undefined,
      gcode_move: undefined,
      toolhead: undefined,
    });
    expect(status.fanSpeed).toBeUndefined();
    expect(status.speedFactor).toBeUndefined();
    expect(status.toolheadX).toBeUndefined();
  });
});

// ─── MoonrakerClient – ETA and finish time ───────────────────────────────────

describe('MoonrakerClient – ETA and finishTime', () => {
  it('calculates ETA when printing and progress > 0.01', async () => {
    // progress=0.5, printDuration=3600 → ETA = 3600*(1-0.5)/0.5 = 3600
    setupHttpMock(buildStatusResponse());
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    const { status } = await p;
    expect(status.etaSeconds).toBeCloseTo(3600, 0);
  });

  it('calculates finishTime as Date.now() + etaSeconds*1000', async () => {
    setupHttpMock(buildStatusResponse());
    const before = Date.now();
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    const { status } = await p;
    const after = Date.now();
    expect(status.finishTime).toBeGreaterThanOrEqual(before + (status.etaSeconds ?? 0) * 1000);
    expect(status.finishTime).toBeLessThanOrEqual(after  + (status.etaSeconds ?? 0) * 1000 + 100);
  });

  it('returns undefined ETA when progress is 0', async () => {
    setupHttpMock(buildStatusResponse({ display_status: { progress: 0 } }));
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    const { status } = await p;
    expect(status.etaSeconds).toBeUndefined();
    expect(status.finishTime).toBeUndefined();
  });

  it('returns undefined ETA when state is idle', async () => {
    setupHttpMock(buildStatusResponse({
      print_stats: { state: 'standby', print_duration: 0, total_duration: 0 },
      display_status: { progress: 0 },
    }));
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    const { status } = await p;
    expect(status.etaSeconds).toBeUndefined();
  });
});

// ─── MoonrakerClient – temperature history ───────────────────────────────────

describe('MoonrakerClient – temperature history', () => {
  it('adds one entry per poll', async () => {
    setupHttpMock(buildStatusResponse());
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    const { history } = await p;
    expect(history).toHaveLength(1);
    expect(history[0].hotend).toBe(210.5);
    expect(history[0].bed).toBe(60.2);
    expect(history[0].time).toBeGreaterThan(0);
  });

  it('enforces the rolling window (temperatureHistorySize)', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });
    mockConfigValues.temperatureHistorySize = 3;

    // Use a per-status-poll counter; side-channel calls (history, thumbnail)
    // get a neutral response so they don't distort the temperature count.
    let statusPollNum = 0;
    (http.get as jest.Mock).mockImplementation(
      (url: string, _opts: unknown, cb: (res: unknown) => void) => {
        let body: string;
        if ((url as string).includes('/printer/objects/query')) {
          statusPollNum++;
          body = JSON.stringify(buildStatusResponse({
            extruder: { temperature: 200 + statusPollNum, target: 210 },
          }));
        } else {
          // history or thumbnail meta: harmless empty response
          body = JSON.stringify({ result: { jobs: [] } });
        }
        cb(buildMockRes(body));
        return mockReq;
      },
    );

    // Poll 1
    const p1 = collectStatus(client);
    client.connect();
    await flushPromises();
    await p1; // hotend=201

    // Poll 2
    const p2 = collectStatus(client);
    jest.runOnlyPendingTimers();
    await flushPromises();
    await p2; // hotend=202

    // Poll 3
    const p3 = collectStatus(client);
    jest.runOnlyPendingTimers();
    await flushPromises();
    await p3; // hotend=203

    // Poll 4 – historySize=3, so the oldest (201) is evicted
    const p4 = collectStatus(client);
    jest.runOnlyPendingTimers();
    await flushPromises();
    const { history } = await p4; // hotend=204

    expect(history).toHaveLength(3);
    expect(history.map(h => h.hotend)).toEqual([202, 203, 204]);

    jest.useRealTimers();
  });
});

// ─── MoonrakerClient – chamber sensor ────────────────────────────────────────

describe('MoonrakerClient – chamber sensor', () => {
  it('includes temperature_sensor in query URL when chamberSensorName is set', async () => {
    mockConfigValues.chamberSensorName = 'chamber';
    setupHttpMock(buildStatusResponse({
      'temperature_sensor chamber': { temperature: 35.5, target: 35.0 },
    }));
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    await p;

    const calledUrl = (http.get as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).toContain('temperature_sensor%20chamber');
  });

  it('parses chamber temperature from response', async () => {
    mockConfigValues.chamberSensorName = 'chamber';
    setupHttpMock(buildStatusResponse({
      'temperature_sensor chamber': { temperature: 35.5, target: 35.0 },
    }));
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    const { status } = await p;
    expect(status.chamberTemp).toBeCloseTo(35.5);
    expect(status.chamberTarget).toBeCloseTo(35.0);
  });

  it('omits temperature_sensor from query when chamberSensorName is empty', async () => {
    mockConfigValues.chamberSensorName = '';
    setupHttpMock(buildStatusResponse());
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    await p;

    const calledUrl = (http.get as jest.Mock).mock.calls[0][0] as string;
    expect(calledUrl).not.toContain('temperature_sensor');
  });

  it('returns undefined chamberTemp when sensor name is empty', async () => {
    setupHttpMock(buildStatusResponse());
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    const { status } = await p;
    expect(status.chamberTemp).toBeUndefined();
  });
});

// ─── MoonrakerClient – print history ─────────────────────────────────────────

describe('MoonrakerClient – print history', () => {
  function setupDualMock() {
    const baseUrl = 'http://localhost:7125';
    const statusUrl = `${baseUrl}/printer/objects/query`;
    const historyUrl = `${baseUrl}/server/history/list`;

    (http.get as jest.Mock).mockImplementation(
      (url: string, _opts: unknown, cb: (res: unknown) => void) => {
        const data = url.startsWith(historyUrl) ? buildHistoryResponse() : buildStatusResponse();
        cb(buildMockRes(JSON.stringify(data)));
        return mockReq;
      },
    );

    void statusUrl;
  }

  it('fetches print history on first connect', async () => {
    setupDualMock();
    const histP = collectHistory(client);
    const statP = collectStatus(client);
    client.connect();
    await flushPromises();
    await statP;
    await flushPromises(); // history fetch is a separate async call

    const entries = await histP;
    expect(entries).toHaveLength(1);
    expect(entries[0].filename).toBe('previous.gcode');
    expect(entries[0].status).toBe('completed');
    expect(entries[0].totalDuration).toBe(3600.0);
    expect(entries[0].filamentUsed).toBe(5000.0);
  });

  it('maps history job fields correctly', async () => {
    setupDualMock();
    const histP = collectHistory(client);
    client.connect();
    await flushPromises();
    await flushPromises();

    const [entry] = await histP;
    expect(entry.jobId).toBe('abc123');
    expect(entry.startTime).toBe(1700000000.0);
  });

  it('re-fetches history when state transitions to finished', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });

    let pollCount = 0;
    const historyEvents: PrintHistoryEntry[][] = [];

    (http.get as jest.Mock).mockImplementation(
      (url: string, _opts: unknown, cb: (res: unknown) => void) => {
        pollCount++;
        let data: unknown;
        if (url.includes('/server/history/list')) {
          data = buildHistoryResponse();
        } else if (pollCount <= 2) {
          // First two polls: printing
          data = buildStatusResponse({ print_stats: { state: 'printing', print_duration: pollCount * 100, total_duration: pollCount * 100, filename: 'model.gcode' } });
        } else {
          // Third poll: finished → should trigger history re-fetch
          data = buildStatusResponse({ print_stats: { state: 'complete', print_duration: 300, total_duration: 300 } });
        }
        cb(buildMockRes(JSON.stringify(data)));
        return mockReq;
      },
    );

    client.on('printHistory', entries => historyEvents.push(entries));

    const p1 = collectStatus(client);
    client.connect();
    await flushPromises();
    await p1;
    await flushPromises(); // first history fetch

    const p2 = collectStatus(client);
    jest.runOnlyPendingTimers();
    await flushPromises();
    await p2;

    const p3 = collectStatus(client);
    jest.runOnlyPendingTimers();
    await flushPromises();
    await p3;
    await flushPromises(); // second history fetch (triggered by finished state)

    // First emission on connect, second on state→finished
    expect(historyEvents.length).toBeGreaterThanOrEqual(2);

    jest.useRealTimers();
  });
});

// ─── MoonrakerClient – error handling ────────────────────────────────────────

describe('MoonrakerClient – error handling', () => {
  it('emits error on malformed JSON response', async () => {
    (http.get as jest.Mock).mockImplementation(
      (_url: string, _opts: unknown, cb: (res: unknown) => void) => {
        cb(buildMockRes('not valid json {{{{'));
        return mockReq;
      },
    );

    const error = jest.fn();
    client.once('error', error);
    client.connect();
    await flushPromises();

    expect(error).toHaveBeenCalledTimes(1);
    expect((error.mock.calls[0][0] as Error).message).toMatch(/JSON parse error/);
  });

  it('emits disconnected (and error) when connection drops after being established', async () => {
    // Fake timers must be active BEFORE connect() so schedule()'s setTimeout is fake.
    jest.useFakeTimers({ doNotFake: ['setImmediate'] });

    // First poll succeeds → connected
    setupHttpMock(buildStatusResponse());
    const p = collectStatus(client);
    client.connect();
    await flushPromises();
    await p;

    // Second poll fails
    (http.get as jest.Mock).mockImplementation(
      (_url: string, _opts: unknown, cb: (res: unknown) => void) => {
        cb(buildMockRes('bad json'));
        return mockReq;
      },
    );

    const disconnected = jest.fn();
    const error = jest.fn();
    client.once('disconnected', disconnected);
    client.once('error', error);

    jest.runOnlyPendingTimers();
    await flushPromises();

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('does not emit disconnected on error before ever connecting', async () => {
    (http.get as jest.Mock).mockImplementation(
      (_url: string, _opts: unknown, cb: (res: unknown) => void) => {
        cb(buildMockRes('bad'));
        return mockReq;
      },
    );

    const disconnected = jest.fn();
    client.once('disconnected', disconnected);
    client.once('error', () => { /* prevent unhandled EventEmitter error throw */ });
    client.connect();
    await flushPromises();

    expect(disconnected).not.toHaveBeenCalled();
  });
});

// ─── MoonrakerClient – reconnect ─────────────────────────────────────────────

describe('MoonrakerClient – reconnect', () => {
  it('clears temperature history on reconnect', async () => {
    setupHttpMock(buildStatusResponse());

    const p1 = collectStatus(client);
    client.connect();
    await flushPromises();
    const { history: h1 } = await p1;
    expect(h1).toHaveLength(1);

    // reconnect clears history
    const p2 = collectStatus(client);
    client.reconnect();
    await flushPromises();
    const { history: h2 } = await p2;
    expect(h2).toHaveLength(1); // starts fresh
  });
});
