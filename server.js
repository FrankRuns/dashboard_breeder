// server.js — Anthropic API proxy for the dashboard breeder
// Deploy to Render. Set ANTHROPIC_API_KEY in the dashboard env vars.

import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

const app = express();
const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY env var not set');
  process.exit(1);
}

// --- Trust Render's proxy so req.ip reflects the real client ---
app.set('trust proxy', 1);

// --- CORS allowlist ---
const ALLOWED_ORIGINS = [
  'https://franksprotos.com',
  'https://www.franksprotos.com',
  // Add localhost for development
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:5500'
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server) — they get rate-limited anyway
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '64kb' }));

// --- Rate limit: 30 breeds per IP per day ---
const limiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 30,
  message: { error: 'Daily limit reached. Come back tomorrow!' },
  standardHeaders: true,
  legacyHeaders: false
});

// --- Cache: identical parent pairs return identical output ---
const cache = new Map();
const CACHE_MAX = 500;

function cacheKey(messages) {
  // Hash the full message content
  const content = JSON.stringify(messages);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  // Move to end (LRU)
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    // Drop oldest
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, value);
}

// --- Main breeding endpoint ---
app.post('/api/breed', limiter, async (req, res) => {
  try {
    const { messages, max_tokens } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array required' });
    }

    // Total size sanity check — prevent abuse via massive prompts
    const totalSize = JSON.stringify(messages).length;
    if (totalSize > 50000) {
      return res.status(400).json({ error: 'prompt too large' });
    }

    // Cache check
    const key = cacheKey(messages);
    const cached = cacheGet(key);
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      return res.json(cached);
    }

    // Forward to Anthropic
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: Math.min(max_tokens || 6000, 8000),
        messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', data);
      return res.status(response.status).json({ error: data.error?.message || 'upstream error' });
    }

    // Cache the successful response
    cacheSet(key, data);
    res.setHeader('X-Cache', 'MISS');
    res.json(data);

  } catch (err) {
    console.error('breed endpoint error:', err);
    res.status(500).json({ error: 'internal error' });
  }
});

// --- Health check ---
app.get('/health', (req, res) => {
  res.json({ ok: true, cache_size: cache.size });
});

app.listen(PORT, () => {
  console.log(`Breeder proxy listening on :${PORT}`);
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
