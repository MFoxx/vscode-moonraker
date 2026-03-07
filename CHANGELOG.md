# Changelog

## [0.2.0]

### New Features

- **API key authentication** — connect to Moonraker instances secured with an API key via `moonraker.apiKey`
- **Klipper macro buttons** — auto-discovered macros shown as one-click sidebar buttons
- **Config file editor** — browse and edit printer config files (`printer.cfg`, `moonraker.conf`, etc.) directly in VS Code's native editor with save-back to the printer and optional firmware/host restart prompt
- **Job queue management** — collapsible sidebar section to manage Moonraker's print queue: add G-code files from the printer, start/pause the queue, remove individual jobs or clear all, with live state updates
- **Printer log viewer** — browse and view Klipper/Moonraker log files directly in VS Code via the sidebar "Show Logs" button

### Bug Fixes

- Fix thumbnail download path

### Improvements

- Move recent prints section to the bottom of the sidebar
- Add slicer thumbnail setup guide to README
- Updated extension sidebar icon
- Updated extension marketplace icon

## [0.1.0] — Initial Release

- Sidebar panel with real-time temperatures, progress, thumbnail, layer count, ETA, and stats
- Temperature history chart
- Status bar with configurable items
- State-change notifications (print started, finished, paused, resumed, cancelled, error)
- Web UI button for Mainsail/Fluidd
- Collapsible recent print history
- Experimental controls: emergency stop, home axes, heat bed/extruder, speed factor, fan speed
- Real-time isometric 3D toolhead position visualization
