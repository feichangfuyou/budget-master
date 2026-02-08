# Budget Master — Integration Stack

Token-optimized budget API + React frontend. Zero-token anomaly detection, forecasting, and receipt OCR; optional AI chat with semantic cache.

## Quick start

```bash
cd budget-master
cp .env.example .env
# Fill DATABASE_URL (Neon), optional: UPSTASH_*, ANTHROPIC_API_KEY

npm install
npx drizzle-kit push

npm run dev          # API on :3000
npm run dev:frontend # Frontend on :5174 (proxies /api and /socket.io to :3000)
```

Optional second terminal: `npm run worker` for background anomaly + forecast passes.

## Env

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `ANTHROPIC_API_KEY` | For chat | Enables /api/chat streaming |
| `UPSTASH_VECTOR_*` | Optional | Semantic cache for chat |
| `UPSTASH_REDIS_*` | Optional | Metrics + monitoring dashboard |

## Scripts

- `npm run dev` — API with tsx watch
- `npm run worker` — Background workers (anomaly + forecast)
- `npm run dev:frontend` — Vite React app (proxy to API)
- `npm run db:push` — Push schema to Neon
- `npm run db:studio` — Drizzle Studio

## Deploy (Railway)

```bash
railway login
railway init
railway up
```

Set env vars in Railway dashboard. `railway.toml` is included.

## API

- `GET/POST /api/transactions` — List, create (with anomaly detection)
- `POST /api/receipts/upload` — Base64 image → OCR → transaction
- `GET /api/anomalies`, `POST /api/anomalies/:id/acknowledge`
- `GET/POST /api/forecasts`, `POST /api/forecasts/generate`
- `POST /api/chat` — SSE stream (token-optimized)
- `GET /api/metrics`, `GET /health`

Use header `X-User-Id` (e.g. `demo-user`) until you add auth.
