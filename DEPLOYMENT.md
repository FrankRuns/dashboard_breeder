# Dashboard breeder — deployment notes

Two pieces: an HTML page that lives on franksprotos.com, and a tiny Node proxy on Render that holds the Anthropic API key.

## Architecture

```
visitor → franksprotos.com/breeder.html → your-app.onrender.com/api/breed → api.anthropic.com
```

The visitor's browser never sees your API key. The proxy applies rate limits and CORS restrictions before forwarding.

## Step 1: Set the Anthropic monthly spend cap FIRST

Before anything else, go to https://console.anthropic.com/ → Settings → Limits → set a monthly spend cap. Something like $10-20. This is your last line of defense. If every other protection fails, this is what bounds your loss.

Do this NOW. Before you deploy. Before anyone clicks anything.

## Step 2: Deploy the proxy to Render

1. Create a new GitHub repo with `server.js` and `package.json` (both included here).
2. Go to render.com → New → Web Service → connect the repo.
3. Settings:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free tier is fine to start
4. Environment variables:
   - `ANTHROPIC_API_KEY` → your real key from console.anthropic.com
5. Deploy. Render gives you a URL like `https://breeder-proxy-xyz.onrender.com`

## Step 3: Wire the HTML to the proxy

Open `dashboard_breeder.html`. Near the top of the `<script>` block:

```javascript
const PROXY_URL = 'https://YOUR-RENDER-APP.onrender.com/api/breed';
```

Replace `YOUR-RENDER-APP` with your actual Render subdomain.

## Step 4: Update the CORS allowlist

In `server.js`, the `ALLOWED_ORIGINS` array currently has:

```javascript
const ALLOWED_ORIGINS = [
  'https://franksprotos.com',
  'https://www.franksprotos.com',
  ...
];
```

If your site has a different domain (subdomain, etc.), add it. Redeploy.

## Step 5: Upload the HTML to franksprotos.com

Just drop `dashboard_breeder.html` wherever you host the rest. It's self-contained — no build step, no dependencies bundled, just one HTML file.

## What protects you

1. **API key never in client code.** It only lives in Render's environment.
2. **Rate limit: 30 breeds per IP per day.** Adjust in `server.js` if needed.
3. **CORS allowlist.** Only franksprotos.com can hit the proxy from a browser.
4. **Prompt size cap.** Server rejects requests over 50KB to prevent abuse.
5. **Response cache.** Identical parent pairs return the same cached output.
6. **Monthly spend cap on Anthropic side.** The bound on your worst case.

## Cost expectations

Sonnet 4 pricing is roughly $3/M input, $15/M output. A typical breed call is ~3K input tokens, ~3K output tokens. About $0.05 per breed.

With 30 breeds per IP per day, one bad actor maxes out at $1.50/day. The monthly cap caps the total. Cache hits are free.

## Troubleshooting

- **CORS errors in browser console**: your domain isn't in `ALLOWED_ORIGINS`. Update and redeploy.
- **"Daily limit reached"**: rate limit kicked in. Either increase the cap or wait.
- **Render's free tier sleeps after 15min idle**: first request after sleep takes ~30 seconds to wake. Subsequent requests are fast. Pay for the $7/mo tier if you want always-on.
- **API key not working**: check it's set in Render env vars (not in `.env` — Render reads from its own dashboard).
