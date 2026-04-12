const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');
const client = require('prom-client');
const { errorHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');
const config = require('./config/config');
const refreshWorker = require('./services/refreshWorker');

// Prometheus setup
client.collectDefaultMetrics();
const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status']
});

// Initialize express app
const app = express();

// Connect to MongoDB (supports Docker/K8s via MONGO_URI env)
const mongoUri = process.env.MONGODB_URI || config.mongodb.uri;
mongoose.connect(mongoUri)
.then(() => {
  console.log('Connected to MongoDB');
  
  // Changed to check every 30 minutes
  refreshWorker.start(); 
})
.catch(error => {
  console.error('MongoDB connection error:', error);
});

// Prometheus HTTP counter middleware
app.use((req, res, next) => {
  res.on('finish', () => {
    httpRequestCounter.inc({ method: req.method, route: req.path, status: res.statusCode });
  });
  next();
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// Middleware
app.use(helmet());
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(rateLimiter);

// CORS configuration
app.use(cors({
  origin: config.cors.origin || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Logging
if (config.nodeEnv === 'development') {
  app.use(morgan('dev'));
}

// Routes
app.use('/api/products', require('./routes/productRoutes'));

// Test route
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'API is working!', 
    env: config.nodeEnv, 
    dbConnected: mongoose.connection.readyState === 1
  });
});

// Error handler (must be after routes)
app.use(errorHandler);

// Start server
const PORT = config.port || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  
  // Stop the refresh worker
  refreshWorker.stop();
  
  // Close MongoDB connection
  await mongoose.connection.close();
  console.log('MongoDB connection closed');
  
  process.exit(0);
});