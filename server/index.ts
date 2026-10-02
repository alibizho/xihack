import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleTrainingFeedback } from "./trainingFeedback.ts";

const root = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const port = Number(process.env.PORT || 3000);
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

createServer(async (request, response) => {
  let pathname: string;
  try { pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname); }
  catch { response.writeHead(400).end(); return; }

  if (pathname === "/api/training-feedback") {
    await handleTrainingFeedback(request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }

  const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`XiHack server listening at http://127.0.0.1:${port}`));
