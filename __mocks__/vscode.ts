// Manual mock for the 'vscode' module.
// Tests can mutate mockConfigValues to change config returns per-test.

export const mockConfigValues: Record<string, unknown> = {
  // moonraker.*
  apiUrl: 'http://localhost',
  port: 7125,
  pollingInterval: 100,
  temperatureHistorySize: 5,
  chamberSensorName: '',
  // moonraker.statusBar.*
  showStatus: true,
  showFileName: true,
  showHotendTemp: true,
  showBedTemp: true,
  showETA: true,
  showTotalTime: true,
};

export const mockConfig = {
  get: jest.fn((key: string, defaultVal?: unknown): unknown =>
    key in mockConfigValues ? mockConfigValues[key] : defaultVal,
  ),
};

export const workspace = {
  getConfiguration: jest.fn().mockReturnValue(mockConfig),
  onDidChangeConfiguration: jest.fn(() => ({ dispose: jest.fn() })),
};

export const mockStatusBarItem = {
  text: '',
  tooltip: '',
  command: '',
  backgroundColor: undefined as unknown,
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
};

export const window = {
  createStatusBarItem: jest.fn(() => mockStatusBarItem),
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    dispose: jest.fn(),
  })),
};

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;

export class ThemeColor {
  constructor(public id: string) {}
}
