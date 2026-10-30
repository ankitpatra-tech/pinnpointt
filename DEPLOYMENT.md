# PinnPointt — Free Lifetime Hosting & Deployment Guide

This guide details how to host both the **PinnPointt Web App** and the **Product Website** for **$0.00 forever** with zero monthly bills, zero bandwidth caps, and free SSL certificates.

---

## Why PinnPointt is Free to Host for Life

Unlike traditional cloud file storage platforms (Dropbox, Google Drive, WeTransfer) that must pay thousands of dollars for storage disks and terabytes of bandwidth, **PinnPointt is architecturally decentralized**:

1. **Zero Bandwidth Costs for File Transfers**: All files, videos, and chats travel directly between device memory buffers over encrypted WebRTC DataChannels. The server **never** touches file bytes.
2. **Static Frontend**: The entire UI (Web App + Showcase Website) compiles into pure static HTML, JavaScript, and CSS. It can be hosted on global edge CDNs for free.
3. **Microscopic Signaling**: The WebSocket server only brokers lightweight 6-digit room handshakes (~1 KB total per connection) and self-destructs the room. A free-tier 512 MB server can comfortably handle thousands of simultaneous connections.

---

## Recommended Free Architecture

| Component | Recommended Free Host | Lifetime Cost | Key Advantages |
| :--- | :--- | :---: | :--- |
| **Frontend** (`about.html` + `index.html`) | **Vercel** or **Cloudflare Pages** | **$0.00 / mo** | Global edge CDN, unlimited bandwidth, instant git-push deploys, free automated HTTPS/SSL, custom domains. |
| **Signaling Relay** (`server/signaling.ts`) | **Render.com** or **Koyeb** | **$0.00 / mo** | Native WebSocket (`wss://`) support, free container hosting, automatic SSL, zero maintenance. |

---

## Step-by-Step Deployment (5 Minutes)

### Step 1: Deploy the Signaling Server (Free WebSocket Relay)

#### Option A: Render.com (Recommended)
1. Push your repository to **GitHub**.
2. Sign up at [Render.com](https://render.com) (free).
3. Click **New +** → **Web Service**.
4. Connect your GitHub repository.
5. Render will automatically detect [`render.yaml`](./render.yaml) or [`Dockerfile`](./Dockerfile):
   - **Environment**: `Docker`
   - **Plan**: `Free`
   - **Health Check Path**: `/health`
6. Click **Create Web Service**.
7. Once deployed, copy your secure WebSocket URL:
   `wss://pinnpointt-signaling.onrender.com`

#### Option B: Koyeb (Always-On Free Tier)
1. Sign up at [Koyeb.com](https://www.koyeb.com).
2. Create a new service from your GitHub repository using the [`Dockerfile`](./Dockerfile).
3. Set Port to `8787`.
4. Koyeb automatically provisions a free `https://` and `wss://` endpoint.

---

### Step 2: Deploy the Frontend (Vercel)

1. Sign up at [Vercel.com](https://vercel.com) (free).
2. Click **Add New...** → **Project**.
3. Import your GitHub repository.
4. Vercel will automatically read [`vercel.json`](./vercel.json):
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. In **Environment Variables**, add:
   - `VITE_SIGNAL_URL` = `wss://your-signaling-service.onrender.com` (from Step 1)
6. Click **Deploy**.

Your site will be live instantly with global SSL:
- **Web App**: `https://your-project.vercel.app/`
- **Product Showcase**: `https://your-project.vercel.app/about`

---

### Step 3: Add a Custom Domain (Optional & Free)

Both Vercel and Cloudflare Pages allow you to connect a custom domain (e.g., `pinnpointt.com`) with 100% free automatic SSL:
1. In your Vercel Dashboard, go to **Settings** → **Domains**.
2. Enter your domain (e.g. `pinnpointt.com` and `www.pinnpointt.com`).
3. Add the two CNAME/A records provided by Vercel to your domain registrar (Namecheap, Cloudflare, GoDaddy).
4. SSL certificates are issued automatically in seconds.

---

## Alternative: 1-Command Self-Hosting (Docker)

If you wish to run PinnPointt completely self-hosted on your own home server or VPS:

```bash
# Build the Docker image
docker build -t pinnpointt-signal .

# Run on port 8787
docker run -d -p 8787:8787 --name pinnpointt pinnpointt-signal
```
