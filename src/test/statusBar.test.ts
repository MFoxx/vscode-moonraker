import * as vscode from 'vscode';
import { StatusBarManager, formatSeconds, stateLabel } from '../statusBar';
import { PrinterStatus } from '../moonrakerClient';
import { mockStatusBarItem, mockConfigValues } from '../../__mocks__/vscode';

// ─── formatSeconds ────────────────────────────────────────────────────────────

describe('formatSeconds', () => {
  it.each([
    [0,    '0s'],
    [1,    '1s'],
    [45,   '45s'],
    [60,   '1m 0s'],
    [90,   '1m 30s'],
    [3600, '1h 0m'],
    [3661, '1h 1m'],
    [7384, '2h 3m'],
  ])('formats %ds as "%s"', (input, expected) => {
    expect(formatSeconds(input)).toBe(expected);
  });
});

// ─── stateLabel ───────────────────────────────────────────────────────────────

describe('stateLabel', () => {
  it('returns OFF when not connected regardless of state', () => {
    expect(stateLabel('printing', false)).toBe('OFF');
    expect(stateLabel('idle',     false)).toBe('OFF');
  });

  it.each([
    ['printing', 'PRINTING'],
    ['paused',   'PAUSED'],
    ['finished', 'FINISHED'],
    ['error',    'ERROR'],
    ['idle',     'IDLE'],
    ['off',      'OFF'],
  ] as const)('maps state %s → label %s when connected', (state, label) => {
    expect(stateLabel(state, true)).toBe(label);
  });
});

// ─── StatusBarManager ─────────────────────────────────────────────────────────

function makeStatus(overrides: Partial<PrinterStatus> = {}): PrinterStatus {
  return {
    state: 'printing',
    filename: 'model.gcode',
    hotendTemp: 210,
    hotendTarget: 210,
    bedTemp: 60,
    bedTarget: 60,
    progress: 0.5,
    printDuration: 3661,
    totalDuration: 3700,
    etaSeconds: 3600,
    ...overrides,
  };
}

describe('StatusBarManager', () => {
  let manager: StatusBarManager;
  const mockContext = { subscriptions: [] as { dispose(): void }[] };

  beforeEach(() => {
    // Reset config flags to all-on
    Object.assign(mockConfigValues, {
      showStatus: true, showFileName: true, showHotendTemp: true,
      showBedTemp: true, showETA: true, showTotalTime: true,
    });
    // Reset item state
    mockStatusBarItem.text = '';
    mockStatusBarItem.backgroundColor = undefined;

    manager = new StatusBarManager(mockContext as never);
  });

  afterEach(() => {
    manager.dispose();
    mockContext.subscriptions.length = 0;
  });

  // ── PRINTING state ──────────────────────────────────────────────────────────

  describe('PRINTING state', () => {
    it('includes PRINTING label', () => {
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).toContain('PRINTING');
    });

    it('includes hotend temp and target', () => {
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).toContain('H:210°/210°');
    });

    it('includes bed temp and target', () => {
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).toContain('B:60°/60°');
    });

    it('includes filename without .gcode extension', () => {
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).toContain('model');
      expect(mockStatusBarItem.text).not.toContain('.gcode');
    });

    it('includes ETA', () => {
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).toContain('ETA:1h 0m');
    });

    it('includes elapsed time', () => {
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).toContain('T:1h 1m');
    });

    it('truncates long filenames to ≤20 chars + ellipsis', () => {
      const name = 'a_very_long_filename_that_exceeds_limit.gcode';
      manager.update(makeStatus({ filename: name }));
      const text = mockStatusBarItem.text;
      // The truncated name should end with ellipsis
      expect(text).toMatch(/[a-z_]{18}…/);
    });

    it('does not show ETA when etaSeconds is undefined', () => {
      manager.update(makeStatus({ etaSeconds: undefined }));
      expect(mockStatusBarItem.text).not.toContain('ETA:');
    });

    it('does not show elapsed time when printDuration is 0', () => {
      manager.update(makeStatus({ printDuration: 0 }));
      expect(mockStatusBarItem.text).not.toContain('T:');
    });

    it('uses error icon when state is error', () => {
      manager.update(makeStatus({ state: 'error' }));
      expect(mockStatusBarItem.text).toContain('$(error)');
    });

    it('sets error background color on error state', () => {
      manager.update(makeStatus({ state: 'error' }));
      expect(mockStatusBarItem.backgroundColor).toBeInstanceOf(vscode.ThemeColor);
      expect((mockStatusBarItem.backgroundColor as vscode.ThemeColor).id).toBe('statusBarItem.errorBackground');
    });

    it('clears background color on non-error state', () => {
      manager.update(makeStatus());
      expect(mockStatusBarItem.backgroundColor).toBeUndefined();
    });
  });

  // ── IDLE state ──────────────────────────────────────────────────────────────

  describe('IDLE state', () => {
    it('shows IDLE label', () => {
      manager.update(makeStatus({ state: 'idle', filename: undefined }));
      expect(mockStatusBarItem.text).toContain('IDLE');
    });

    it('does not show filename when idle', () => {
      manager.update(makeStatus({ state: 'idle', filename: 'test.gcode' }));
      expect(mockStatusBarItem.text).not.toContain('test');
    });

    it('does not show ETA when idle', () => {
      manager.update(makeStatus({ state: 'idle', etaSeconds: 999 }));
      expect(mockStatusBarItem.text).not.toContain('ETA:');
    });

    it('does not show elapsed time when idle', () => {
      manager.update(makeStatus({ state: 'idle', printDuration: 1234 }));
      expect(mockStatusBarItem.text).not.toContain('T:');
    });

    it('still shows temperatures when idle', () => {
      manager.update(makeStatus({ state: 'idle' }));
      expect(mockStatusBarItem.text).toContain('H:');
      expect(mockStatusBarItem.text).toContain('B:');
    });
  });

  // ── Config flag toggles ─────────────────────────────────────────────────────

  describe('config flag toggles', () => {
    it('hides state label when showStatus=false', () => {
      mockConfigValues.showStatus = false;
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).not.toContain('PRINTING');
    });

    it('hides filename when showFileName=false', () => {
      mockConfigValues.showFileName = false;
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).not.toContain('model');
    });

    it('hides hotend temp when showHotendTemp=false', () => {
      mockConfigValues.showHotendTemp = false;
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).not.toContain('H:');
    });

    it('hides bed temp when showBedTemp=false', () => {
      mockConfigValues.showBedTemp = false;
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).not.toContain('B:');
    });

    it('hides ETA when showETA=false', () => {
      mockConfigValues.showETA = false;
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).not.toContain('ETA:');
    });

    it('hides elapsed time when showTotalTime=false', () => {
      mockConfigValues.showTotalTime = false;
      manager.update(makeStatus());
      expect(mockStatusBarItem.text).not.toContain('T:');
    });
  });

  // ── setConnected / refresh ──────────────────────────────────────────────────

  describe('setConnected', () => {
    it('shows OFF and warning background when disconnected', () => {
      manager.setConnected(false);
      expect(mockStatusBarItem.text).toContain('OFF');
      expect(mockStatusBarItem.backgroundColor).toBeInstanceOf(vscode.ThemeColor);
      expect((mockStatusBarItem.backgroundColor as vscode.ThemeColor).id).toBe('statusBarItem.warningBackground');
    });

    it('clears background when reconnected', () => {
      manager.setConnected(false);
      manager.setConnected(true);
      expect(mockStatusBarItem.backgroundColor).toBeUndefined();
    });
  });

  describe('refresh', () => {
    it('resets text to OFF', () => {
      manager.update(makeStatus());
      manager.refresh();
      expect(mockStatusBarItem.text).toContain('OFF');
    });
  });
});
