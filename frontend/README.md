# Portfolio frontend

A responsive Vite frontend for the portfolio. In production it is built into
`frontend/dist` and served by the Node.js backend.

## Features

- Dynamic About, Skills, Projects, Experience, and Education content
- Responsive Skills grid and project detail dialogs
- English and German CV download links
- Backend-served images and icons
- Vite development server with backend proxying

## Analytics

The site uses a first-party tracking client in `script.js`. It sends page views and
link clicks to the endpoint configured in `tracking-config.js`; no third-party
analytics service is required.

Before deploying:

1. Change `endpoint` in `tracking-config.js` to your own API endpoint.
2. Set `enabled` to `false` if tracking should be disabled.
3. Implement a `POST` endpoint that accepts JSON in this shape:

   ```json
   {
     "name": "outbound_link_click",
     "properties": {
       "url": "https://example.com/",
       "text": "Live demo"
     },
     "path": "/",
     "referrer": null,
     "timestamp": "2026-11-12T21:33:14.523Z"
   }
   ```

The client sends no cookies, visitor IDs, or personal profiles. Your server and
hosting provider may still log IP addresses or other request metadata, so configure
retention and privacy controls on the backend.

### Run the frontend and backend

The frontend is a Vite application. Install its dependencies and build it
before serving it through the backend:

```powershell
cd frontend
npm install
npm run build
```

For development, run `npm run dev` in `frontend`. Its API, image, icon, upload,
and CV requests are proxied to the backend at `http://localhost:30073`.

The `backend` folder contains a Node.js server with a login-protected dashboard.
It stores editable content and persistent assets in `backend/data`.

1. Copy `backend/.env.example` to `backend/.env` and set a strong password.
2. Keep the credentials in `backend/.env`; the backend loads this file at
   startup. You can also set environment variables in your hosting platform.
3. Build the frontend, then start the server from the backend folder:

   ```text
   node server.js
   ```

4. Open `http://localhost:30073` for the portfolio and
   `http://localhost:30073/admin` for the tracking login and contact messages.

The Vite development server runs on `http://localhost:30074`; use that URL
while developing. In production, the backend serves the built frontend and
assets on port `30073`, so there is no separate production frontend port.

### Backend asset routes

The frontend receives asset paths from the content API. The backend serves:

```text
/images/<filename>       Managed project images
/uploads/<filename>      Uploaded project images
/icons/<filename>        Built-in portfolio icons
/skill-icons/<filename>  Uploaded skill SVGs
/cv-en.pdf               English CV download
/cv-de.pdf               German CV download
```

Use the admin panel at `/admin` to edit portfolio content, upload or select
images and SVGs, delete managed assets, and upload the two CV versions.

For Windows PowerShell, set the credentials before starting if you are not
using `backend/.env`:

```powershell
$env:ADMIN_USERNAME = "admin"
$env:ADMIN_PASSWORD = "use-a-long-random-password"
node .\server.js
```

The included server keeps sessions in memory, so all users are logged out when
the server restarts. Deploy it behind HTTPS and do not commit real passwords
or private runtime files such as CVs, uploads, analytics events, and contact
messages.

## Production

Use the repository root `Dockerfile` and `docker-compose.yml` for production.
The multi-stage Docker build creates the Vite bundle, then runs the backend on
port `30073`. The Compose volume keeps `backend/data` persistent across
container rebuilds.
