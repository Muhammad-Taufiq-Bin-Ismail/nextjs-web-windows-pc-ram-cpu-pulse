# Pulse/PC

A Next.js dashboard that records CPU and memory usage for the machine running
the Node.js server and displays the latest six minutes of samples.

## Requirements

- Node.js 22.5 or later (uses the built-in `node:sqlite` module)
- A long-running Node.js server process; serverless deployments do not provide a
  persistent background collector

## Run

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>. In production, run `npm run build` followed by
`npm start` on the machine whose usage you want to monitor.

The server records a sample every 3 seconds. The browser dashboard refreshes
every 5 seconds and displays up to 120 recent samples. The SQLite file is stored
at `data/pc-status.sqlite`.

CPU and RAM values describe the host running the Next.js server, not the
computer viewing the page.
