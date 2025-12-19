require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { Pool } = require('pg');
const { createClient } = require('redis');
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const winston = require('winston');
const Joi = require('joi');

// ============================================================================
// Configuration
// ============================================================================
const CONFIG = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'production',
  jwtSecret: process.env.JWT_SECRET,
  rateLimit: parseInt(process.env.API_RATE_LIMIT || '100', 10),
  logLevel: process.env.LOG_LEVEL || 'info'
};

// ============================================================================
// Logger Setup
// ============================================================================
const logger = winston.createLogger({
  level: CONFIG.logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// ============================================================================
// Database Setup
// ============================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected database error', { error: err.message });
});

// ============================================================================
// Redis Setup
// ============================================================================
let redisClient;
(async () => {
  redisClient = createClient({
    url: process.env.REDIS_URL
  });

  redisClient.on('error', (err) => {
    logger.error('Redis error', { error: err.message });
  });

  await redisClient.connect();
  logger.info('Redis connected');
})();

// ============================================================================
// Express App Setup
// ============================================================================
const app = express();

// Security middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: CONFIG.rateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  message: { error: 'Too many requests, please try again later' }
});

app.use('/api/', limiter);

// ============================================================================
// Authentication Middleware
// ============================================================================
async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');

  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  try {
    // Check if API key exists and is valid
    const result = await pool.query(
      'SELECT id, name, is_active FROM api_keys WHERE is_active = TRUE'
    );

    let validKey = null;
    for (const row of result.rows) {
      const match = await bcrypt.compare(apiKey, row.key_hash || '');
      if (match) {
        validKey = row;
        break;
      }
    }

    if (!validKey) {
      logger.warn('Invalid API key attempt', { ip: req.ip });
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Update last used timestamp
    await pool.query(
      'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = $1',
      [validKey.id]
    );

    req.apiKey = validKey;
    next();
  } catch (error) {
    logger.error('API key authentication error', { error: error.message });
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// ============================================================================
// Validation Schemas
// ============================================================================
const schemas = {
  beacon: Joi.object({
    agent_id: Joi.string().required(),
    hostname: Joi.string().optional(),
    platform: Joi.string().optional(),
    version: Joi.string().optional(),
    metadata: Joi.object().optional()
  }),

  result: Joi.object({
    agent_id: Joi.string().required(),
    module: Joi.string().required(),
    target: Joi.string().optional(),
    result_type: Joi.string().optional(),
    data: Joi.object().required(),
    severity: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
    metadata: Joi.object().optional()
  })
};

// ============================================================================
// API Routes - Public
// ============================================================================

// Health check
app.get('/api/v1/status', async (req, res) => {
  try {
    // Check database
    await pool.query('SELECT 1');

    // Check Redis
    await redisClient.ping();

    res.json({
      status: 'operational',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      services: {
        database: 'healthy',
        cache: 'healthy'
      }
    });
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      status: 'degraded',
      error: 'Service unavailable'
    });
  }
});

// List available modules
app.get('/api/v1/modules', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT name, description, version, category FROM modules WHERE is_enabled = TRUE ORDER BY category, name'
    );

    res.json({
      modules: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Failed to fetch modules', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch modules' });
  }
});

// ============================================================================
// API Routes - Protected
// ============================================================================

// Agent beacon (check-in)
app.post('/api/v1/beacon', authenticateApiKey, async (req, res) => {
  try {
    const { error, value } = schemas.beacon.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { agent_id, hostname, platform, version, metadata } = value;
    const ip_address = req.ip;

    // Upsert agent
    await pool.query(
      `INSERT INTO agents (agent_id, hostname, platform, version, ip_address, metadata, first_seen, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (agent_id)
       DO UPDATE SET
         hostname = EXCLUDED.hostname,
         platform = EXCLUDED.platform,
         version = EXCLUDED.version,
         ip_address = EXCLUDED.ip_address,
         metadata = EXCLUDED.metadata,
         last_seen = CURRENT_TIMESTAMP,
         is_active = TRUE`,
      [agent_id, hostname, platform, version, ip_address, JSON.stringify(metadata || {})]
    );

    // Record beacon
    await pool.query(
      'INSERT INTO beacons (agent_id, ip_address, metadata) VALUES ($1, $2, $3)',
      [agent_id, ip_address, JSON.stringify(metadata || {})]
    );

    logger.info('Agent beacon received', { agent_id, hostname });

    res.json({
      success: true,
      agent_id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Beacon failed', { error: error.message });
    res.status(500).json({ error: 'Beacon failed' });
  }
});

// Submit results
app.post('/api/v1/results', authenticateApiKey, async (req, res) => {
  try {
    const { error, value } = schemas.result.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const { agent_id, module, target, result_type, data, severity, metadata } = value;

    const result = await pool.query(
      `INSERT INTO results (agent_id, module, target, result_type, data, severity, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, timestamp`,
      [agent_id, module, target, result_type, JSON.stringify(data), severity, JSON.stringify(metadata || {})]
    );

    logger.info('Result submitted', { agent_id, module, result_id: result.rows[0].id });

    res.status(201).json({
      success: true,
      id: result.rows[0].id,
      timestamp: result.rows[0].timestamp
    });
  } catch (error) {
    logger.error('Result submission failed', { error: error.message });
    res.status(500).json({ error: 'Failed to submit result' });
  }
});

// Query results
app.get('/api/v1/results', authenticateApiKey, async (req, res) => {
  try {
    const {
      agent_id,
      module,
      severity,
      limit = 100,
      offset = 0,
      since
    } = req.query;

    let query = 'SELECT * FROM results WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (agent_id) {
      params.push(agent_id);
      query += ` AND agent_id = $${++paramCount}`;
    }

    if (module) {
      params.push(module);
      query += ` AND module = $${++paramCount}`;
    }

    if (severity) {
      params.push(severity);
      query += ` AND severity = $${++paramCount}`;
    }

    if (since) {
      params.push(since);
      query += ` AND timestamp >= $${++paramCount}`;
    }

    query += ' ORDER BY timestamp DESC';

    params.push(parseInt(limit, 10));
    query += ` LIMIT $${++paramCount}`;

    params.push(parseInt(offset, 10));
    query += ` OFFSET $${++paramCount}`;

    const result = await pool.query(query, params);

    res.json({
      results: result.rows,
      count: result.rows.length,
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10)
    });
  } catch (error) {
    logger.error('Failed to query results', { error: error.message });
    res.status(500).json({ error: 'Failed to query results' });
  }
});

// List agents
app.get('/api/v1/agents', authenticateApiKey, async (req, res) => {
  try {
    const { active_only = 'true' } = req.query;

    let query = 'SELECT * FROM agents';
    if (active_only === 'true') {
      query += ' WHERE is_active = TRUE';
    }
    query += ' ORDER BY last_seen DESC';

    const result = await pool.query(query);

    res.json({
      agents: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    logger.error('Failed to list agents', { error: error.message });
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

// ============================================================================
// Error Handling
// ============================================================================
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(500).json({
    error: 'Internal server error'
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    path: req.path
  });
});

// ============================================================================
// Server Startup
// ============================================================================
const server = app.listen(CONFIG.port, () => {
  logger.info(`HoneyBadger Vanguard API started`, {
    port: CONFIG.port,
    environment: CONFIG.nodeEnv,
    rateLimit: `${CONFIG.rateLimit} req/min`
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');

  server.close(async () => {
    await pool.end();
    await redisClient.quit();
    logger.info('Server shut down complete');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');

  server.close(async () => {
    await pool.end();
    await redisClient.quit();
    logger.info('Server shut down complete');
    process.exit(0);
  });
});

module.exports = app;
