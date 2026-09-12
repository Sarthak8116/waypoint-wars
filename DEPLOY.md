# Deploying Waypoint Wars

Repo: https://github.com/Sarthak8116/waypoint-wars

**GitHub cannot host this app.** Pages is static-only, and this needs a Node
server for Next.js plus a long-lived process for Colyseus WebSockets. The repo
is the code; hosting is two services.

Both steps below need a browser login, so they are yours to run — I cannot
authenticate as you.

---

## Why two hosts

| Piece | Needs | Where |
| --- | --- | --- |
| Next.js web app | Node, HTTPS, edge caching | **Vercel** |
| Colyseus server | a long-lived process holding open WebSockets | **Railway** or **Render** |

Vercel does support WebSockets now, but Colyseus expects a persistent server
process with in-memory room state, which is a poor fit for per-request
functions. Keep it on a normal container.

**HTTPS matters more than convenience here.** Mobile browsers block
geolocation and the camera on plain `http://`, so phones can only play against
an HTTPS deployment. `localhost` is exempt, which is why the laptop demo works
without any of this.

---

## 1. Colyseus server — do this FIRST

The web app needs its URL, so deploy the server before the front end.

### Railway

```bash
npm i -g @railway/cli
railway login
railway init            # in the repo root
railway up
```

Then in the Railway dashboard for the service:

- **Root directory**: `/` (the monorepo root — pnpm workspaces need it)
- **Build command**: `pnpm install --frozen-lockfile`
- **Start command**: `pnpm --filter @ww/multiplayer-server start`
- **Variables**:
  ```
  GEMINI_API_KEY = <your rotated key>
  PORT           = provided by Railway automatically
  ```

`PORT` is read from the environment (`process.env.PORT ?? 2567`), so Railway's
injected port works without a change.

Note the public URL it gives you, e.g. `waypoint-wars-production.up.railway.app`.

### Render (alternative)

New **Web Service** → connect the repo → Environment **Node** →
Build `pnpm install --frozen-lockfile` →
Start `pnpm --filter @ww/multiplayer-server start`.
Same environment variables.

---

## 2. Web app — Vercel

```bash
vercel login
vercel link             # in the repo root
vercel env add NEXT_PUBLIC_API_URL production
vercel env add NEXT_PUBLIC_MULTIPLAYER_URL production
vercel --prod
```

Values for those two, using the host from step 1:

```
NEXT_PUBLIC_API_URL          https://<your-server-host>
NEXT_PUBLIC_MULTIPLAYER_URL  wss://<your-server-host>
```

**`wss://`, not `ws://`.** A page served over HTTPS cannot open an insecure
WebSocket; the browser blocks it as mixed content and the lobby silently fails
to connect.

`vercel.json` in the repo root already sets the build command, install command
and output directory for the pnpm workspace, so Vercel should not need any
dashboard configuration.

---

## 3. CORS

The server currently runs `cors()` with no options, which allows every origin.
That is fine for a hackathon demo and wrong for anything that outlives it.
To lock it down, in `apps/multiplayer-server/src/index.ts`:

```ts
app.use(cors({ origin: process.env.WEB_ORIGIN ?? true }));
```

and set `WEB_ORIGIN` to your Vercel URL.

---

## 4. Verify the deployment

The same checks that pass locally work against the deployed hosts:

```bash
WEB_URL=https://<vercel-url> API_URL=https://<server-url> pnpm check:browser
WEB_URL=https://<vercel-url> API_URL=https://<server-url> pnpm demo:check
```

Then the thing that actually matters: **open it on a real phone.** Camera and
GPS are the two capabilities that only exist over HTTPS, so this is the first
moment they can be tested at all.

---

## Known cost

- Vercel: free tier is fine.
- Railway: free trial credit, then roughly $5/month for a service that never
  sleeps. A sleeping service adds a cold-start delay to the first player who
  joins a room, which is a bad look mid-demo.
- Gemini: free tier, and **rate limits reject submissions**. A throttled
  verdict looks like a broken feature rather than a throttled one.
