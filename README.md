# Pulse/PC

A Next.js dashboard that records system-wide CPU and memory usage plus
per-process CPU and RAM usage for the machine running the Node.js server.

## Requirements

- Node.js 22.5 or later (uses the built-in `node:sqlite` module)
- Windows PowerShell and CIM for per-process metrics
- A long-running Node.js server process; serverless deployments do not provide a
  persistent background collector

## Run

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>. In production, run `npm run build` followed by
`npm start` on the machine whose usage you want to monitor.

The server records system and per-process metrics every 3 seconds. The browser
dashboard refreshes every 5 seconds, displays up to 120 system samples, and lists
the latest snapshot of all running processes, sorted by CPU usage. Task name and
PID columns can be sorted by clicking their headers. Each process row includes
CPU and RAM trend charts with up to 120 points. Per-process snapshots are
retained for one hour. The SQLite file is stored at `data/pc-status.sqlite`.
Use the dashboard header toggle to switch between light and dark themes; the
selected theme is saved in browser local storage.

CPU and RAM values describe the host running the Next.js server, not the
computer viewing the page. Per-process CPU percentages are normalized across
logical CPU cores; RAM uses each process's working set and is also shown as a
percentage of total system memory. Use the historical overview date and time
pickers to load overall CPU and RAM charts for a selected range; hover over a
chart to see the sample value and local date/time. Click a point on either
historical chart to show all process metrics from the closest retained snapshot
within five seconds of that sample.
The selected process snapshot table can be sorted by every column. Hovering on
either system chart shows both CPU and RAM values for that sample. Drag across a
historical chart to highlight and zoom into that time range; the date and time
controls update to match the selected zone.
System samples also record real-time processor clock speed in MHz using Windows
performance counters and the hardware maximum from CIM.
CPU speed is shown in the live summary, history chart, and chart tooltips.
Historical overview and PID history include quick-range controls for the last
hour or a configurable number of minutes. Click a process PID to open a history
popover with selectable date/time controls, CPU/RAM charts, and task-name
observations showing the first and last time each name appeared for that PID.
Per-process history is retained for one hour.
