const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const rootDir = path.resolve(__dirname, "..", "frontend", "dist");
const dataDir = path.join(__dirname, "data");
const eventsFile = path.join(dataDir, "events.jsonl");
const contactsFile = path.join(dataDir, "contacts.jsonl");
const adminFile = path.join(__dirname, "public", "admin.html");
const port = Number(process.env.PORT || 30073);
const sessionTtl = Number(process.env.SESSION_TTL_MS || 86400000);
const adminUsername = process.env.ADMIN_USERNAME;
const adminPassword = process.env.ADMIN_PASSWORD;
const requireHttps = process.env.REQUIRE_HTTPS === "true" ||
  process.env.NODE_ENV === "production";
const trustProxy = process.env.TRUST_PROXY === "true";
const sessions = new Map();
const maxBodyBytes = 16 * 1024;
const validEventNames = new Set([
  "page_view",
  "navigation_link_click",
  "outbound_link_click",
]);

if (!adminUsername || !adminPassword) {
  throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set before starting the server.");
}

fs.mkdirSync(dataDir, { recursive: true });

function jsonResponse(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.cookie || "")
      .split(";")
      .filter(Boolean)
      .map((cookie) => {
        const separator = cookie.indexOf("=");
        return [
          cookie.slice(0, separator).trim(),
          decodeURIComponent(cookie.slice(separator + 1).trim()),
        ];
      })
  );
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function authenticated(request) {
  const token = parseCookies(request).tracking_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) {
      sessions.delete(token);
    }
    return false;
  }
  return true;
}

function secureRequest(request) {
  return Boolean(
    request.socket.encrypted ||
    (trustProxy && request.headers["x-forwarded-proto"] === "https")
  );
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBodyBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function validEvent(body) {
  return (
    body &&
    validEventNames.has(body.name) &&
    typeof body.path === "string" &&
    typeof body.timestamp === "string" &&
    body.properties &&
    typeof body.properties === "object" &&
    !Array.isArray(body.properties)
  );
}

function loadEvents() {
  if (!fs.existsSync(eventsFile)) {
    return [];
  }
  return fs.readFileSync(eventsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function dashboardData() {
  const events = loadEvents();
  const byName = {};
  const byPath = {};
  for (const event of events) {
    byName[event.name] = (byName[event.name] || 0) + 1;
    byPath[event.path] = (byPath[event.path] || 0) + 1;
  }
  return {
    total: events.length,
    byName,
    byPath,
    recent: events.slice(-100).reverse(),
    contacts: loadContacts().slice(-100).reverse(),
  };
}

function loadContacts() {
  if (!fs.existsSync(contactsFile)) {
    return [];
  }
  return fs.readFileSync(contactsFile, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function serveStatic(request, response, pathname) {
  const requestedFile = pathname === "/"
    ? path.join(rootDir, "index.html")
    : pathname === "/admin"
      ? adminFile
      : path.join(rootDir, pathname);
  const resolvedFile = path.resolve(requestedFile);
  const isFrontendFile = resolvedFile.startsWith(`${rootDir}${path.sep}`);
  if ((!isFrontendFile && resolvedFile !== adminFile) || !fs.existsSync(resolvedFile)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const extension = path.extname(resolvedFile);
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
  };
  response.writeHead(200, {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
  });
  fs.createReadStream(resolvedFile).pipe(response);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/health") {
      jsonResponse(response, 200, { ok: true });
      return;
    }

    const secure = secureRequest(request);
    if (requireHttps && !secure) {
      if (request.method === "GET" && request.headers.host) {
        response.writeHead(308, {
          Location: `https://${request.headers.host}${request.url}`,
        });
      } else {
        response.writeHead(426, {
          "Content-Type": "application/json; charset=utf-8",
          "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
        });
        response.end(JSON.stringify({ error: "HTTPS is required." }));
      }
      return;
    }
    if (secure) {
      response.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains"
      );
    }
    if (request.method === "POST" && url.pathname === "/api/track") {
      const event = JSON.parse(await readBody(request));
      if (!validEvent(event)) {
        jsonResponse(response, 400, { error: "Invalid tracking event." });
        return;
      }
      fs.appendFileSync(eventsFile, `${JSON.stringify({
        name: event.name,
        properties: event.properties,
        path: event.path,
        referrer: event.referrer || null,
        timestamp: event.timestamp,
        receivedAt: new Date().toISOString(),
      })}\n`);
      jsonResponse(response, 201, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/contact") {
      const contact = JSON.parse(await readBody(request));
      const email = typeof contact.email === "string" ? contact.email.trim() : "";
      const message = typeof contact.message === "string" ? contact.message.trim() : "";
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        message.length < 1 ||
        message.length > 5000
      ) {
        jsonResponse(response, 400, { error: "Enter a valid email and message." });
        return;
      }
      fs.appendFileSync(contactsFile, `${JSON.stringify({
        email,
        message,
        receivedAt: new Date().toISOString(),
      })}\n`);
      jsonResponse(response, 201, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      const credentials = JSON.parse(await readBody(request));
      if (
        !credentials ||
        typeof credentials.username !== "string" ||
        typeof credentials.password !== "string" ||
        !safeEqual(credentials.username, adminUsername) ||
        !safeEqual(credentials.password, adminPassword)
      ) {
        jsonResponse(response, 401, { error: "Invalid username or password." });
        return;
      }
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, { expiresAt: Date.now() + sessionTtl });
      const secureCookie = secure ? "; Secure" : "";
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie": `tracking_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(sessionTtl / 1000)}${secureCookie}`,
      });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/logout") {
      const token = parseCookies(request).tracking_session;
      if (token) {
        sessions.delete(token);
      }
      response.writeHead(204, {
        "Set-Cookie": "tracking_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
      });
      response.end();
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/events") {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      jsonResponse(response, 200, dashboardData());
      return;
    }

    if (
      request.method === "DELETE" &&
      (url.pathname === "/api/events" || url.pathname === "/api/contacts")
    ) {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      const file = url.pathname === "/api/events" ? eventsFile : contactsFile;
      fs.writeFileSync(file, "");
      jsonResponse(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET") {
      serveStatic(request, response, url.pathname);
      return;
    }

    jsonResponse(response, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error(error);
    jsonResponse(response, 400, { error: "Request could not be processed." });
  }
});

server.listen(port, () => {
  console.log(`Portfolio server running at http://localhost:${port}`);
});
