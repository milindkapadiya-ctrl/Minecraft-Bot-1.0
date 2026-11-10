import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Simulation, type TaskKind } from "./simulation.js";

export async function startDashboard(
  options: { host?: string; port?: number; simulation?: Simulation } = {},
) {
  if (options.host !== undefined && options.host !== "127.0.0.1")
    throw Error("loopback_required");
  const token = randomBytes(32).toString("hex");
  let origin = "";
  const assets = new Map<string, { type: string; body: Buffer }>();
  for (const [route, file, type] of [
    ["/", "index.html", "text/html"],
    ["/app.js", "app.js", "text/javascript"],
    ["/style.css", "style.css", "text/css"],
  ]) {
    assets.set(route!, {
      type: type!,
      body: await readFile(
        new URL(`../../../web/dashboard/${file}`, import.meta.url),
      ),
    });
  }
  const simulation = options.simulation ?? new Simulation();
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    const send = (status: number, value: unknown) => {
      if (res.headersSent || res.destroyed) return;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (
        req.headers.host !== new URL(origin).host ||
        (req.headers.origin !== undefined && req.headers.origin !== origin) ||
        (req.headers["sec-fetch-site"] &&
          !["same-origin", "none"].includes(
            String(req.headers["sec-fetch-site"]),
          ))
      )
        return send(403, { error: "origin_rejected" });
      if (req.method === "GET" && assets.has(req.url ?? "")) {
        const asset = assets.get(req.url!)!;
        res.writeHead(200, { "Content-Type": asset.type + "; charset=utf-8" });
        res.end(asset.body);
        return;
      }
      if (req.method === "GET" && req.url === "/api/session")
        return send(200, { token, ...simulation.snapshot() });
      if (req.method === "GET" && req.url === "/api/status")
        return send(200, simulation.snapshot());
      if (!["/api/tasks", "/api/cancel", "/api/reset"].includes(req.url ?? ""))
        return send(404, { error: "route_not_found" });
      if (req.method !== "POST")
        return send(405, { error: "method_not_allowed" });
      const auth = String(req.headers["x-dashboard-token"] ?? "");
      if (
        req.headers.origin !== origin ||
        !/^[a-f0-9]{64}$/.test(auth) ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(token))
      )
        return send(403, { error: "authorization_required" });
      if (req.headers["content-type"] !== "application/json")
        return send(415, { error: "json_required" });
      if (Number(req.headers["content-length"] ?? 0) > 1024) {
        req.resume();
        return send(413, { error: "payload_too_large" });
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 1024) {
          send(413, { error: "payload_too_large" });
          return;
        }
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(body);
      } catch {
        return send(400, { error: "invalid_json" });
      }
      if (!data || typeof data !== "object" || Array.isArray(data))
        return send(400, { error: "invalid_payload" });
      const keys = Object.keys(data).sort().join(",");
      if (req.url === "/api/tasks") {
        if (
          keys !== "id,kind" ||
          typeof data.id !== "string" ||
          typeof data.kind !== "string"
        )
          return send(400, { error: "invalid_payload" });
        return send(202, simulation.start(data.id, data.kind as TaskKind));
      }
      if (req.url === "/api/cancel") {
        if (keys !== "id" || typeof data.id !== "string")
          return send(400, { error: "invalid_payload" });
        simulation.cancel(data.id);
        return send(202, { state: "cancellation_requested" });
      }
      if (keys !== "") return send(400, { error: "invalid_payload" });
      simulation.reset();
      send(200, simulation.snapshot());
    } catch (error) {
      send(409, {
        error:
          error instanceof Error && /^[a-z_]+$/.test(error.message)
            ? error.message
            : "request_failed",
      });
    }
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 30;
  server.maxConnections = 20;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", resolve);
    });
  } catch (error) {
    await simulation.close();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw Error("listen_failed");
  origin = `http://127.0.0.1:${address.port}`;
  let closing: Promise<void> | undefined;
  return {
    url: origin,
    close: () =>
      (closing ??= (async () => {
        const stopped = new Promise<void>((resolve) =>
          server.close(() => resolve()),
        );
        server.closeAllConnections();
        await simulation.close();
        await stopped;
      })()),
  };
}
