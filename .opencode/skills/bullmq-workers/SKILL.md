---
name: bullmq-workers
description: BullMQ 5 + Redis job queues and worker best practices for dash-bi. Use when defining background queues, job handlers, worker concurrency, Puppeteer PDF export jobs, or handling Redis connections. Triggers on: BullMQ, Redis, worker, queue, pdf-export, job processing, concurrency.
---

# BullMQ & Background Workers Guidelines (dash-bi)

Guidelines for creating and maintaining asynchronous background queues, job processors, and workers in `dash-bi`.

---

## 🏗️ Architecture Overview

- **Queue Library:** BullMQ v5
- **Redis Client:** `ioredis` v5
- **Workers Directory:** `src/worker/`
- **Main Queues:** `pdf-export` (Puppeteer PDF rendering)

---

## 🛑 Critical Rules for Workers

### 1. Graceful Shutdown & Resource Cleanup
Workers must properly close Redis connections and terminate browser contexts (e.g. Puppeteer pages/browsers) on process signals (`SIGTERM`, `SIGINT`).

```ts
const shutdown = async (signal: string) => {
  logger.info({ signal }, 'worker shutting down');
  await worker.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

### 2. Puppeteer Memory Leak Prevention
Always ensure Puppeteer browser pages are closed in a `finally` block:

```ts
let page: Page | null = null;
try {
  page = await browser.newPage();
  // Perform rendering...
} finally {
  if (page) await page.close();
}
```

### 3. Logger Redaction & Structured Logging
Always use `logger` from `@/lib/logger` (Pino). Never log raw tokens, PII, or internal credentials in job payloads or error events.

### 4. Rate Limiting & Concurrency Limits
Bound worker concurrency according to container resources (e.g. `concurrency: 3` for memory-intensive PDF jobs).

---

## ⚡ Job Idempotency & Retries

- Always configure exponential backoff on retries for transient failures:
  ```ts
  await pdfQueue.add('export-pdf', data, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
  });
  ```
