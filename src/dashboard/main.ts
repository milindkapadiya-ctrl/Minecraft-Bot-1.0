import { startDashboard } from "./server.js";
const dashboard = await startDashboard();
console.log(
  `Minecraft Bot Control Center — SIMULATION\nOpen ${dashboard.url}\nPress Ctrl+C to stop.`,
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void dashboard.close().then(() => {
      process.exitCode = 0;
    });
  });
