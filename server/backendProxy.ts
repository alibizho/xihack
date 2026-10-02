import { request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";

const hopByHopHeaders = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

export function proxyBackend(request: IncomingMessage, response: ServerResponse, backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8000") {
  let target: URL;
  try {
    const base = new URL(backendUrl);
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "::1", "backend"].includes(base.hostname)) throw new Error("backend must be local");
    const route = new URL(request.url || "/", "http://localhost");
    if (!route.pathname.startsWith("/api/")) throw new Error("invalid API path");
    target = new URL(base);
    target.pathname = route.pathname;
    target.search = route.search;
  } catch {
    response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ code: "BACKEND_CONFIG", message: "后端地址配置有误" }));
    return;
  }

  const headers = Object.fromEntries(Object.entries(request.headers).filter(([name]) => !hopByHopHeaders.has(name)));
  headers.host = target.host;
  const fromLocalProxy = process.env.TRUST_PROXY === "true" || ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.socket.remoteAddress || "");
  const clientIp = fromLocalProxy && typeof request.headers["x-real-ip"] === "string"
    ? request.headers["x-real-ip"]
    : request.socket.remoteAddress;
  if (clientIp) headers["x-forwarded-for"] = clientIp;

  const upstream = httpRequest(target, { method: request.method, headers }, (upstreamResponse) => {
    const responseHeaders = Object.fromEntries(Object.entries(upstreamResponse.headers).filter(([name]) => !hopByHopHeaders.has(name)));
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (response.headersSent) response.destroy();
    else response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ code: "BACKEND_UNAVAILABLE", message: "后端暂时不可用，请稍后重试" }));
  });
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
}
