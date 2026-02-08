# Budget Master — 24/7 Zero-Token Beast Mode

Real-time anomaly detection, predictive budgeting, OCR receipts, and live dashboard with **zero LLM tokens** for core pipelines.

## Features

- **Real-Time Anomaly Detection** — Amount (Z-score + MAD), frequency (Poisson), new merchant, category shift, time-based
- **Predictive Budgeting** — LSTM (TensorFlow.js), 14-day lookback, 30-day forecast, trend & seasonality
- **OCR Receipt Processing** — Tesseract + Sharp, rule-based extraction + local AI categorization
- **24/7 Background Workers** — Receipt queue, anomaly queue, forecast job (6h), alert notifications
- **Real-Time Dashboard** — Socket.IO stats, new transactions, alerts

## Setup

```bash
cd server
npm install
mkdir -p models receipts
cp .env.example .env
# Edit .env: UPSTASH_REDIS_URL, UPSTASH_REDIS_TOKEN; optional: ANTHROPIC_API_KEY, UPSTASH_VECTOR_*
```

## Run

```bash
npm run build && npm start
# or
npm run dev
```

- **Health:** `GET http://localhost:3000/health`
- **Cost report:** `GET http://localhost:3000/metrics`
- **Socket.IO:** Connect to `http://localhost:3000`, emit `subscribe` with `userId` to get live stats.

## Queue Usage

- **Receipts:** `LPUSH receipt_queue '{"userId":"u1","imageBuffer":"<base64>"}'`
- **Anomaly:** Pushed automatically after receipt processing.
- **Alerts:** Popped by alert worker; stored in `user:<id>:alerts`.

## Cost Estimate

| Feature              | Token Cost | Cost/Day |
|----------------------|------------|----------|
| Anomaly detection    | 0          | $0       |
| Predictive budgeting | 0*         | $0       |
| OCR                  | 0          | $0       |
| Cache hits / Local   | 0          | $0       |
| LLM fallback         | ~30%       | ~$1.75   |

\* One-time training amortized.
