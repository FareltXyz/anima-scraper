const express = require('express');
const path = require('path');
const myanimelistRouter = require('./routes/myanimelist');
const sokujaIdRouter = require('./routes/sokujaId');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// Middleware Bawaan & Parsing Request Body
// ==========================================
app.use(express.json()); // Parsing application/json
app.use(express.urlencoded({ extended: true })); // Parsing application/x-www-form-urlencoded

// ==========================================
// Custom Logger Middleware
// ==========================================
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.url}`);
  next();
});

// ==========================================
// CORS Sederhana (Opsional jika diakses frontend)
// ==========================================
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ==========================================
// Static Files
// ==========================================
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// Routes / Endpoints
// ==========================================

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Documentation endpoint
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime()
  });
});

// Info Endpoint API
app.get('/api/v1/info', (req, res) => {
  res.json({
    project: 'anima-scraper',
    version: '1.0.0',
    description: 'Anime Scraper Service',
    providers: ['myanimelist', 'sokujaId']
  });
});

app.use('/api/v1/myanimelist', myanimelistRouter);
app.use('/api/v1/sokujaId', sokujaIdRouter);

// ==========================================
// 404 Not Found Middleware
// ==========================================
app.use((req, res, next) => {
  res.status(404).json({
    status: 'error',
    message: `Route not found: ${req.method} ${req.originalUrl}`
  });
});

app.use((err, req, res, next) => {
  const statusCode = err.status || 500;
  if (statusCode >= 500) {
    console.error('Unhandled Error:', err.stack || err.message);
  }

  res.status(statusCode).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && statusCode >= 500 && { stack: err.stack })
  });
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server berjalan di http://localhost:${PORT}`);
    console.log(`👉 Mode: ${process.env.NODE_ENV || 'development'}`);
  });

  // Graceful Shutdown
  const handleShutdown = (signal) => {
    console.log(`\n${signal} diterima. Menutup server dengan aman...`);
    server.close(() => {
      console.log('Server ditutup.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

module.exports = app;
