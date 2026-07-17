# TrustLink Market

A working escrow/middleman marketplace for digital goods (game accounts, crypto wallets, gift cards, etc). Built with plain Node.js (no external npm packages needed to run) so it starts instantly.

## How it works

1. **Seller** lists a product with a title, price (USDT), and a private delivery code/credentials.
2. **Buyer** clicks buy, gets shown your USDT deposit address, sends payment, and submits the transaction ID (+ optional screenshot).
3. **Admin (you)** reviews the submitted transaction manually in the admin panel and approves or rejects it.
4. On approval, the delivery code is instantly revealed to the buyer in their orders page.

The delivery code is never shown to the buyer, or exposed by the API, until an admin approves the order — it's stored server-side and only attached to the response after approval.

## Running it

Requires only Node.js (v18+), no `npm install` needed.

```bash
node server.js
```

Then open **http://localhost:3000**

By default it runs on port 3000. To change it: `PORT=8080 node server.js`

### Default admin login
On first run, an admin account is created automatically:
- Username: `admin`
- Password: `admin123`

**Change this password immediately** — there's no "change password" UI yet, so for now: stop the server, open `data/users.json`, delete the admin user object, and restart the server (it will generate a fresh one), or add a change-password endpoint yourself.

## Configuring your payment address

Edit `config.json`:

```json
{
  "payment": {
    "currency": "USDT",
    "network": "BSC (BEP20)",
    "contractAddress": "0x55d398326f99059ff775485246999027b3197955",
    "depositAddress": "YOUR_WALLET_ADDRESS_HERE"
  }
}
```

This is the address shown to every buyer at checkout. Replace `depositAddress` with your real wallet.

## Data storage

Everything is stored as JSON files in the `data/` folder (`users.json`, `products.json`, `orders.json`, `sessions.json`) — created automatically on first run. This is fine for getting started and for moderate traffic, but for real production use with many concurrent users you'll eventually want to migrate to a proper database (e.g. PostgreSQL or SQLite) — the `lib/db.js` file is a single, small module you can swap out.

## Deploying to Railway (easiest option)

1. Push this folder to a new GitHub repository (create the repo on github.com, then drag-and-drop this whole folder into "Add file → Upload files" — no `git` command line needed).
2. Go to [railway.app](https://railway.app), sign in with GitHub.
3. **New Project → Deploy from GitHub repo** → select your repo. Railway detects Node.js automatically and runs `node server.js`.
4. **Add a persistent volume** (important — without this, your users/products/orders reset on every redeploy):
   - In your Railway service, go to **Settings → Volumes → New Volume**
   - Mount path: `/app/data`
5. **Set environment variables** (Settings → Variables):
   - `COOKIE_SECURE` = `true` (Railway serves everything over HTTPS, so this keeps session cookies safe)
6. Deploy. Railway gives you a public URL like `yourapp.up.railway.app` — that's your live site.
7. Open the site, log in as `admin` / `admin123`, and **change the admin password immediately** (for now: use the Railway volume's file browser or a one-off shell to edit `data/users.json`, or add a change-password endpoint).
8. Optional: in Settings → Networking, attach your own custom domain instead of the railway.app subdomain.

## Deploying online (VPS)

You can deploy this to any host that runs Node.js: a VPS (DigitalOcean, Hetzner, etc), Render, Railway, or Fly.io. Since it has zero external dependencies, deployment is just: upload the files, run `node server.js` (ideally behind a process manager like `pm2` and a reverse proxy like `nginx` with HTTPS).

**Important before going live:**
- Put it behind HTTPS (use nginx/Caddy or a platform that provides TLS) — right now cookies aren't marked `Secure`.
- Change the default admin password.
- Back up the `data/` folder regularly.
- Since payment verification is manual, always double check the transaction on a block explorer (e.g. bscscan.com) before approving — don't rely on the buyer's screenshot or txn ID text alone.

## Project structure

```
server.js          — everything: HTTP server, routes, database, auth (single file, no lib/ folder)
config.json          — site name + payment address
public/               — all frontend pages (plain HTML/CSS/JS, no build step)
  index.html          — marketplace / browse listings
  login.html, register.html
  product.html         — listing detail + buy button
  seller.html          — seller dashboard (add/manage listings, see orders)
  orders.html          — buyer dashboard (pay, see delivered codes)
  admin.html           — verify payments, approve/reject
  style.css, app.js
```

## Known limitations / next steps to harden this for real money

- Payment verification is 100% manual by design (as requested) — there's no blockchain integration, so always verify on-chain yourself.
- No rate limiting / anti-abuse on registration or login.
- No email verification or password reset flow.
- No image storage optimization — screenshots are stored as base64 directly in `orders.json`, which is fine for light use but will bloat the file over time.
- No dispute/refund workflow beyond reject.
