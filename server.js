// Horizon proxy backend (Node.js 20+)
import http from "node:http";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 8080);
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || "example.com,www.example.com")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, allowedHosts: ALLOWED_HOSTS }));
    return;
  }

  if (requestUrl.pathname !== "/proxy") {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found. Use /proxy?url=https%3A%2F%2Fexample.com");
    return;
  }

  const rawTarget = requestUrl.searchParams.get("url");
  if (!rawTarget) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Missing url parameter.");
    return;
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Invalid URL.");
    return;
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Only HTTP and HTTPS destinations are allowed.");
    return;
  }

  const host = target.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some(allowed => host === allowed || host.endsWith("." + allowed))) {
    res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    res.end(`Destination not allowed. Configure ALLOWED_HOSTS to include ${host}.`);
    return;
  }

  try {
    const upstream = await fetch(target.href, {
      redirect: "manual",
      headers: { "user-agent": "HorizonProxy/1.0" },
      signal: AbortSignal.timeout(15000)
    });

    // Keep redirects on the proxy endpoint so the browser doesn't leave proxy mode.
    if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get("location")) {
      const next = new URL(upstream.headers.get("location"), target);
      if (!["http:", "https:"].includes(next.protocol) ||
          !ALLOWED_HOSTS.some(allowed => next.hostname.toLowerCase() === allowed || next.hostname.toLowerCase().endsWith("." + allowed))) {
        res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
        res.end("Redirect destination is not in ALLOWED_HOSTS.");
        return;
      }
      const redirectThroughProxy = `/proxy?url=${encodeURIComponent(next.href)}`;
      res.writeHead(302, { location: redirectThroughProxy, "access-control-allow-origin": "*" });
      res.end();
      return;
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      "content-type": contentType,
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store"
    });
    res.end(body);
  } catch (error) {
    res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Proxy fetch failed or timed out. " + (error?.message || ""));
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Horizon proxy listening on port ${PORT}`);
  console.log(`Allowed destination hosts: ${ALLOWED_HOSTS.join(", ") || "(none)"}`);
});
