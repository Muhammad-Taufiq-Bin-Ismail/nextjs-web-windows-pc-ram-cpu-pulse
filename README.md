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
the latest snapshot of all running processes, sorted by CPU usage. Per-process
snapshots are retained for 15 minutes. The SQLite file is stored at
`data/pc-status.sqlite`.

CPU and RAM values describe the host running the Next.js server, not the
computer viewing the page. Per-process CPU percentages are normalized across
logical CPU cores; RAM uses each process's working set and is also shown as a
percentage of total system memory.
