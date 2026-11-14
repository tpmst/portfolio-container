const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const rootDir = path.resolve(__dirname, "..", "frontend", "dist");
const dataDir = path.join(__dirname, "data");
const uploadsDir = path.join(dataDir, "uploads");
const imagesDir = path.join(dataDir, "images");
const skillIconsDir = path.join(dataDir, "skill-icons");
const iconsDir = path.join(dataDir, "icons");
const builtAssetsDir = path.join(rootDir, "assets");
const eventsFile = path.join(dataDir, "events.jsonl");
const contactsFile = path.join(dataDir, "contacts.jsonl");
const contentFile = path.join(dataDir, "content.json");
const cvFiles = {
  en: path.join(dataDir, "cv-en.pdf"),
  de: path.join(dataDir, "cv-de.pdf"),
};
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
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(skillIconsDir, { recursive: true });

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

function readUpload(request) {
  const maxUploadBytes = 8 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxUploadBytes) {
        reject(new Error("Uploaded file is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function saveUploadedImage(request, body) {
  const boundaryMatch = (request.headers["content-type"] || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw new Error("Multipart boundary is missing.");
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const partStart = body.indexOf(Buffer.from("\r\n\r\n"));
  const partEnd = body.lastIndexOf(boundary);
  if (partStart < 0 || partEnd <= partStart) {
    throw new Error("Uploaded file is invalid.");
  }
  const headers = body.subarray(0, partStart).toString("utf8");
  const mimeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
  const mime = mimeMatch && mimeMatch[1].trim().toLowerCase();
  const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
  if (!extensions[mime]) {
    throw new Error("Only JPG, PNG, WEBP, and GIF images are supported.");
  }
  const image = body.subarray(partStart + 4, partEnd - 2);
  const filename = `${crypto.randomBytes(16).toString("hex")}${extensions[mime]}`;
  fs.writeFileSync(path.join(uploadsDir, filename), image);
  return `/uploads/${filename}`;
}

function extractMultipartFile(request, body) {
  const boundaryMatch = (request.headers["content-type"] || "").match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error("Multipart boundary is missing.");
  const boundary = Buffer.from(`--${boundaryMatch[1] || boundaryMatch[2]}`);
  const partStart = body.indexOf(Buffer.from("\r\n\r\n"));
  const partEnd = body.lastIndexOf(boundary);
  if (partStart < 0 || partEnd <= partStart) throw new Error("Uploaded file is invalid.");
  return body.subarray(partStart + 4, partEnd - 2);
}

function listImages() {
  const images = [];
  const imagePattern = /\.(gif|jpe?g|png|webp)$/i;
  for (const [directory, prefix] of [[uploadsDir, "/uploads/"], [imagesDir, "/images/"], [builtAssetsDir, "/assets/"]]) {
    if (!fs.existsSync(directory)) continue;
    for (const filename of fs.readdirSync(directory)) {
      if (imagePattern.test(filename)) images.push(`${prefix}${filename}`);
    }

  }
  return [...new Set(images)].sort();
}

function listSkillIcons() {
  const icons = [];
  for (const [directory, prefix] of [[iconsDir, "/icons/"], [skillIconsDir, "/skill-icons/"]]) {
    if (!fs.existsSync(directory)) continue;
    for (const filename of fs.readdirSync(directory)) {
      if (/\.svg$/i.test(filename)) icons.push(`${prefix}${filename}`);
    }
  }
  return [...new Set(icons)].sort();
}

function saveSkillIcon(request, body) {
  const svg = extractMultipartFile(request, body).toString("utf8").trim();
  if ((!svg.startsWith("<svg") && !svg.startsWith("<?xml")) || !svg.includes("<svg") || !svg.includes("</svg>") || svg.length > 500000) {
    throw new Error("The uploaded file must be a valid SVG.");
  }
  const filename = `${crypto.randomBytes(16).toString("hex")}.svg`;
  fs.writeFileSync(path.join(skillIconsDir, filename), svg);
  return `/skill-icons/${filename}`;
}

function deleteManagedFile(filePath, locations, extensionPattern) {
  if (typeof filePath !== "string") {
    throw new Error("A file must be selected.");
  }
  const location = locations.find((candidate) => filePath.startsWith(candidate.prefix));
  if (!location) {
    throw new Error("The selected file is not managed by the portfolio.");
  }
  const relativePath = filePath.slice(location.prefix.length);
  if (!relativePath || relativePath.includes("/") || relativePath.includes("\\") || !extensionPattern.test(relativePath)) {
    throw new Error("The selected file type is not supported.");
  }
  const file = path.join(location.directory, relativePath);
  if (!fs.existsSync(file)) {
    throw new Error("The selected file does not exist.");
  }
  fs.unlinkSync(file);
}

function normalizeContent(content) {
  const normalizeAssetPath = (assetPath) => {
    if (typeof assetPath !== "string") return assetPath;
    return assetPath.replace(/^\.\/assets\/images\//, "/images/")
      .replace(/^\.\/assets\/icons\//, "/icons/");
  };
  return {
    ...content,
    skills: Array.isArray(content.skills) ? content.skills.map((skill) => ({ ...skill, icon: normalizeAssetPath(skill.icon) })) : [],
    projects: (content.projects || []).map((project) => ({
      ...project,
      image: normalizeAssetPath(project.image),
      technologies: Array.isArray(project.technologies) ? project.technologies : [],
      status: ["completed", "in-progress", "archived"].includes(project.status) ? project.status : "completed",
    })),
  };
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

function loadContent() {
  if (!fs.existsSync(contentFile)) {
    throw new Error("Portfolio content file is missing.");
  }
  return normalizeContent(JSON.parse(fs.readFileSync(contentFile, "utf8")));
}

function validText(value, maxLength) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function validContent(content) {
  if (!content || !content.about || !validText(content.about.lead, 500) || !validText(content.about.body, 5000)) {
    return false;
  }
  for (const section of ["projects", "experience", "education"]) {
    if (!Array.isArray(content[section]) || content[section].length > 100) return false;
  }
  if (!Array.isArray(content.skills)) return false;
  if (!content.skills.every((skill) => validText(skill.name, 100) && validText(skill.level, 100))) return false;
  return content.projects.every((item) =>
    validText(item.title, 200) && validText(item.description, 5000) &&
    validText(item.image, 500) && Array.isArray(item.technologies) &&
    item.technologies.length <= 30 && item.technologies.every((tag) => validText(tag, 80)) &&
    ["completed", "in-progress", "archived"].includes(item.status) && Array.isArray(item.links) &&
    item.links.length <= 10 && item.links.every((link) =>
      validText(link.label, 100) && validText(link.url, 1000) &&
      validText(link.icon, 500))
  ) && ["experience", "education"].every((section) => content[section].every((item) =>
    validText(item.title, 200) && validText(item.period, 200) &&
    validText(item.organization, 300) &&
    (section === "education"
      ? validText(item.description, 2000)
      : Array.isArray(item.details) && item.details.length <= 50 &&
        item.details.every((detail) => validText(detail, 1000)))
  ));
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

    if (request.method === "POST" && url.pathname === "/api/uploads") {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      const imagePath = saveUploadedImage(request, await readUpload(request));
      jsonResponse(response, 201, { path: imagePath });
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/cv/")) {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      const language = url.pathname.endsWith("/de") ? "de" : url.pathname.endsWith("/en") ? "en" : null;
      if (!language) {
        jsonResponse(response, 400, { error: "CV language must be en or de." });
        return;
      }

      const body = await readUpload(request);
      fs.writeFileSync(cvFiles[language], extractMultipartFile(request, body));
      jsonResponse(response, 201, { path: `/cv-${language}.pdf` });
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/skill-icons") {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      jsonResponse(response, 200, { icons: listSkillIcons() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/skill-icons") {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      jsonResponse(response, 201, { path: saveSkillIcon(request, await readUpload(request)) });
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/uploads") {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      deleteManagedFile(
        url.searchParams.get("path"),
        [
          { directory: uploadsDir, prefix: "/uploads/" },
          { directory: imagesDir, prefix: "/images/" },
        ],
        /\.(gif|jpe?g|png|webp)$/i
      );
      jsonResponse(response, 200, { ok: true });
      return;
    }

    if (request.method === "DELETE" && url.pathname === "/api/skill-icons") {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      deleteManagedFile(
        url.searchParams.get("path"),
        [
          { directory: skillIconsDir, prefix: "/skill-icons/" },
          { directory: iconsDir, prefix: "/icons/" },
        ],
        /\.svg$/i
      );
      jsonResponse(response, 200, { ok: true });
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

    if (request.method === "GET" && url.pathname === "/api/content") {
      jsonResponse(response, 200, loadContent());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/images") {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      jsonResponse(response, 200, { images: listImages() });
      return;
    }

    if (request.method === "PUT" && url.pathname === "/api/content") {
      if (!authenticated(request)) {
        jsonResponse(response, 401, { error: "Login required." });
        return;
      }
      const content = JSON.parse(await readBody(request));
      if (!validContent(content)) {
        jsonResponse(response, 400, { error: "Invalid portfolio content." });
        return;
      }
      const temporaryFile = `${contentFile}.tmp`;
      fs.writeFileSync(temporaryFile, `${JSON.stringify(content, null, 2)}\n`);
      fs.renameSync(temporaryFile, contentFile);
      jsonResponse(response, 200, { ok: true });
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
      if (url.pathname === "/cv-en.pdf" || url.pathname === "/cv-de.pdf") {
        const language = url.pathname === "/cv-de.pdf" ? "de" : "en";
        if (!fs.existsSync(cvFiles[language])) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        response.writeHead(200, {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="cv-${language}.pdf"`,
        });
        fs.createReadStream(cvFiles[language]).pipe(response);
        return;
      }
      if (url.pathname.startsWith("/icons/") || url.pathname.startsWith("/assets/icons/") || url.pathname.startsWith("/skill-icons/")) {
        const filename = path.basename(url.pathname);
        const iconDirectory = url.pathname.startsWith("/skill-icons/") ? skillIconsDir : iconsDir;
        const iconFile = path.join(iconDirectory, filename);
        if (!fs.existsSync(iconFile)) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=31536000, immutable" });
        fs.createReadStream(iconFile).pipe(response);
        return;
      }
      if (url.pathname.startsWith("/images/") || url.pathname.startsWith("/uploads/")) {
        const filename = path.basename(url.pathname);
        const imageDirectory = url.pathname.startsWith("/images/") ? imagesDir : uploadsDir;
        const uploadedFile = path.join(imageDirectory, filename);
        if (!fs.existsSync(uploadedFile)) {
          response.writeHead(404);
          response.end("Not found");
          return;
        }
        const extension = path.extname(filename).toLowerCase();
        const contentTypes = { ".gif": "image/gif", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
        response.writeHead(200, { "Content-Type": contentTypes[extension] || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" });
        fs.createReadStream(uploadedFile).pipe(response);
        return;
      }
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
