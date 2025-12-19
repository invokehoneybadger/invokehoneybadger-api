# HoneyBadger Vanguard - Self-Hosted API

Complete production-ready command & control API stack for HoneyBadger Vanguard security tools.

## Overview

This self-hosted deployment provides a fully functional API for managing HBV agents, collecting reconnaissance results, and centralizing security operations data - all while maintaining complete OPSEC with zero public exposure.

### Tech Stack

- **API**: Node.js 18 + Express
- **Database**: PostgreSQL 16 with optimized schema
- **Cache**: Redis 7 for rate limiting
- **Auth**: Bcrypt + JWT + API keys
- **Rate Limit**: 100 req/min (configurable)

### Features

- Complete API v1 implementation
- Bcrypt-hashed API key authentication
- Redis-backed rate limiting
- PostgreSQL with auto-tracking triggers
- Comprehensive audit logging
- Health monitoring endpoints
- Docker Compose orchestration
- Zero-trust Twingate integration

---

## Quick Start

### Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 2GB RAM available
- (Optional) Twingate Connector for zero-trust access

### 1. Clone Repository

```bash
git clone https://github.com/invokehoneybadger/invokehoneybadger-api.git
cd invokehoneybadger-api/self-hosted
```

### 2. Configure Environment

```bash
# Copy template
cp .env.example .env

# Edit configuration (REQUIRED)
nano .env
```

**Important**: Change all default passwords and secrets in `.env`:

```bash
# Generate secure passwords
openssl rand -base64 32  # For POSTGRES_PASSWORD
openssl rand -base64 32  # For REDIS_PASSWORD
openssl rand -hex 32     # For JWT_SECRET
```

### 3. Deploy Stack

```bash
# Start all services
docker-compose up -d

# Verify services are healthy
docker-compose ps

# Check logs
docker-compose logs -f api
```

### 4. Generate API Key

```bash
# Generate your first API key
docker-compose exec api npm run generate-api-key -- "Primary Key"

# Save the generated key securely (it won't be shown again)
```

### 5. Test API

```bash
# Test health endpoint
curl http://localhost:3000/api/v1/status

# Test with API key (replace with your generated key)
curl -H "X-API-Key: hbv_your_generated_key_here" \
  http://localhost:3000/api/v1/modules
```

---

## API Endpoints

### Public Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/status` | Health check and service status |
| GET | `/api/v1/modules` | List available HBV modules |

### Protected Endpoints (Require API Key)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/beacon` | Agent check-in/registration |
| POST | `/api/v1/results` | Submit scan/recon results |
| GET | `/api/v1/results` | Query results with filters |
| GET | `/api/v1/agents` | List registered agents |

### Authentication

Include API key in requests using either method:

```bash
# Header method
curl -H "X-API-Key: hbv_your_key" http://localhost:3000/api/v1/agents

# Bearer token method
curl -H "Authorization: Bearer hbv_your_key" http://localhost:3000/api/v1/agents
```

---

## Usage Examples

### Agent Beacon (Check-in)

```bash
curl -X POST http://localhost:3000/api/v1/beacon \
  -H "X-API-Key: hbv_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "hostname": "recon-box-01",
    "platform": "linux",
    "version": "1.0.0",
    "metadata": {"location": "datacenter-1"}
  }'
```

### Submit Results

```bash
curl -X POST http://localhost:3000/api/v1/results \
  -H "X-API-Key: hbv_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agent-001",
    "module": "port-scan",
    "target": "example.com",
    "result_type": "open_ports",
    "data": {
      "ports": [80, 443, 22],
      "scan_time": 2.5
    },
    "severity": "low"
  }'
```

### Query Results

```bash
# Get all results for an agent
curl -H "X-API-Key: hbv_your_key" \
  "http://localhost:3000/api/v1/results?agent_id=agent-001"

# Filter by module
curl -H "X-API-Key: hbv_your_key" \
  "http://localhost:3000/api/v1/results?module=port-scan"

# Filter by severity
curl -H "X-API-Key: hbv_your_key" \
  "http://localhost:3000/api/v1/results?severity=high"

# Combine filters with pagination
curl -H "X-API-Key: hbv_your_key" \
  "http://localhost:3000/api/v1/results?agent_id=agent-001&limit=50&offset=0"
```

### List Agents

```bash
# List all active agents
curl -H "X-API-Key: hbv_your_key" \
  http://localhost:3000/api/v1/agents

# List all agents (including inactive)
curl -H "X-API-Key: hbv_your_key" \
  "http://localhost:3000/api/v1/agents?active_only=false"
```

---

## Database Schema

### Tables

- **api_keys** - API key management with bcrypt hashing
- **agents** - HBV agent registry
- **beacons** - Check-in history with auto-tracking triggers
- **results** - Scan/recon results with JSONB storage
- **modules** - Available HBV capabilities (pre-seeded)
- **webhooks** - Event notification system (v2 feature)
- **audit_log** - Complete audit trail

### Automatic Triggers

1. **Agent Last Seen**: Automatically updates `agents.last_seen` on beacon
2. **Module Updates**: Automatically updates `modules.updated_at` on changes
3. **API Key Tracking**: Tracks last usage timestamp for all keys

### Pre-Seeded Modules

The database comes with 8 pre-configured modules:

- `port-scan` - Network port scanning
- `subdomain-enum` - Subdomain discovery
- `web-crawl` - Web application mapping
- `vuln-scan` - Vulnerability assessment
- `screenshot` - Web page capture
- `dns-enum` - DNS enumeration
- `ssl-analysis` - SSL/TLS analysis
- `directory-brute` - Directory brute forcing

---

## Twingate Zero-Trust Integration

### Why Twingate?

Deploying the HBV API with Twingate provides:

- **Zero Public Exposure**: API never touches the internet
- **Network Segmentation**: Control which agents can access
- **Audit Trail**: Track all access through Twingate logs
- **No VPN Overhead**: Direct encrypted connections
- **Multi-Network**: Access from any Twingate-connected network

### Deployment Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Twingate Network                      │
│                                                          │
│  ┌──────────────┐         ┌──────────────┐             │
│  │ HBV Agent 1  │────┐    │ HBV Agent 2  │─────┐       │
│  │ (Network A)  │    │    │ (Network B)  │     │       │
│  └──────────────┘    │    └──────────────┘     │       │
│                      │                          │       │
│                   Twingate                   Twingate   │
│                   Connector                  Connector  │
│                      │                          │       │
│                      └──────────┬───────────────┘       │
│                                 │                        │
│                      ┌──────────▼──────────┐            │
│                      │   HBV API Server    │            │
│                      │  (Self-Hosted)      │            │
│                      │  - PostgreSQL       │            │
│                      │  - Redis            │            │
│                      │  - API (Node.js)    │            │
│                      └─────────────────────┘            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Setup Steps

1. **Deploy HBV API on Twingate-connected server**

```bash
# Ensure Twingate Connector is running on deployment server
twingate-connector status

# Deploy API stack
cd invokehoneybadger-api/self-hosted
docker-compose up -d
```

2. **Configure Twingate Resource**

- Add resource in Twingate Admin Console
- Name: `HBV API`
- Address: `internal-server-ip:3000` or `hostname:3000`
- Protocol: TCP
- Assign to appropriate groups/users

3. **Access from HBV Agents**

```bash
# Export API configuration
export HBV_API_URL="http://internal-server-ip:3000"
export HBV_API_KEY="hbv_your_generated_key"

# Your HBV tools automatically route through Twingate
hbv-recon --target example.com --api $HBV_API_URL
```

4. **Security Best Practices**

- Only expose port 3000 to Twingate network
- Use firewall rules to block public access
- Rotate API keys regularly
- Monitor Twingate audit logs
- Use separate API keys per agent/team

---

## Database Management

### Connect to Database

```bash
# Using docker-compose
docker-compose exec postgres psql -U hbv -d honeybadger

# Direct connection
psql postgresql://hbv:your_password@localhost:5432/honeybadger
```

### Useful Queries

```sql
-- View active agents
SELECT * FROM active_agents_summary;

-- Results summary by module
SELECT * FROM results_by_module_summary;

-- Recent high-severity results
SELECT agent_id, module, target, timestamp
FROM results
WHERE severity = 'high'
ORDER BY timestamp DESC
LIMIT 20;

-- Agent activity in last 24 hours
SELECT a.agent_id, a.hostname, COUNT(b.id) as beacons
FROM agents a
LEFT JOIN beacons b ON a.agent_id = b.agent_id
  AND b.timestamp > NOW() - INTERVAL '24 hours'
GROUP BY a.agent_id, a.hostname
ORDER BY beacons DESC;
```

### Maintenance Functions

```sql
-- Archive old beacons (keep last 30 days)
SELECT archive_old_beacons();

-- Mark inactive agents (no beacon in 7 days)
SELECT mark_inactive_agents();
```

### Backup Database

```bash
# Create backup
docker-compose exec postgres pg_dump -U hbv honeybadger > backup.sql

# Restore from backup
docker-compose exec -T postgres psql -U hbv honeybadger < backup.sql
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `honeybadger` | Database name |
| `POSTGRES_USER` | `hbv` | Database user |
| `POSTGRES_PASSWORD` | *(required)* | Database password |
| `REDIS_PASSWORD` | *(required)* | Redis password |
| `API_PORT` | `3000` | API port to expose |
| `NODE_ENV` | `production` | Environment mode |
| `JWT_SECRET` | *(required)* | JWT signing secret |
| `API_RATE_LIMIT` | `100` | Requests per minute |
| `LOG_LEVEL` | `info` | Logging level |

### Rate Limiting

Customize rate limits in `.env`:

```bash
# Allow 200 requests per minute
API_RATE_LIMIT=200
```

Or modify `docker-compose.yml` for different strategies:

```yaml
environment:
  API_RATE_LIMIT: ${API_RATE_LIMIT:-200}
```

### Scaling

**Horizontal Scaling** (multiple API instances):

```yaml
# docker-compose.yml
services:
  api:
    deploy:
      replicas: 3
```

Add a load balancer (nginx/traefik) in front of API instances.

**Database Connection Pool**:

Edit `src/server.js`:

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,  // Increase pool size
  // ...
});
```

---

## Security Best Practices

### 1. Secrets Management

- Never commit `.env` file
- Use strong passwords (32+ characters)
- Rotate credentials regularly
- Consider using secret managers (Vault, AWS Secrets Manager)

### 2. Network Security

- Use Twingate or VPN for access
- Never expose database/Redis ports publicly
- Enable firewall rules
- Monitor access logs

### 3. API Key Management

- Generate unique keys per agent/team
- Revoke unused keys
- Monitor `api_keys.last_used_at`
- Disable keys instead of deleting (for audit trail)

```sql
-- Disable an API key
UPDATE api_keys SET is_active = FALSE WHERE name = 'old-key';

-- List unused keys (not used in 30 days)
SELECT name, created_at, last_used_at
FROM api_keys
WHERE last_used_at < NOW() - INTERVAL '30 days'
  OR last_used_at IS NULL;
```

### 4. Database Security

- Use read-only credentials for reporting
- Enable SSL for database connections
- Regular backups
- Monitor for SQL injection attempts

### 5. Application Security

- Keep dependencies updated
- Review audit logs regularly
- Set up monitoring/alerting
- Use security headers (provided by Helmet)

---

## Monitoring & Logging

### Health Checks

```bash
# API health
curl http://localhost:3000/api/v1/status

# Container health
docker-compose ps

# Service logs
docker-compose logs -f api
docker-compose logs -f postgres
docker-compose logs -f redis
```

### Log Levels

Configure in `.env`:

```bash
# Options: error, warn, info, debug
LOG_LEVEL=info
```

### Monitoring Queries

```sql
-- API key usage
SELECT name, last_used_at,
  EXTRACT(EPOCH FROM (NOW() - last_used_at))/3600 as hours_since_use
FROM api_keys
WHERE is_active = TRUE
ORDER BY last_used_at DESC;

-- Top agents by result count
SELECT agent_id, COUNT(*) as result_count
FROM results
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY agent_id
ORDER BY result_count DESC
LIMIT 10;

-- Audit trail for security events
SELECT timestamp, event_type, actor, action, ip_address
FROM audit_log
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;
```

---

## Troubleshooting

### API Won't Start

```bash
# Check logs
docker-compose logs api

# Common issues:
# 1. Database not ready - wait for postgres healthcheck
# 2. Missing JWT_SECRET in .env
# 3. Invalid DATABASE_URL format
```

### Database Connection Failed

```bash
# Verify postgres is running
docker-compose ps postgres

# Check database logs
docker-compose logs postgres

# Test connection manually
docker-compose exec postgres psql -U hbv -d honeybadger -c "SELECT 1;"
```

### Redis Connection Failed

```bash
# Verify redis is running
docker-compose ps redis

# Test redis connection
docker-compose exec redis redis-cli -a your_redis_password ping
```

### Rate Limit Issues

```bash
# Check Redis connection
docker-compose logs redis

# Temporarily disable rate limiting (testing only)
# Edit docker-compose.yml: API_RATE_LIMIT=10000
```

### API Key Authentication Failed

```bash
# Verify API key exists
docker-compose exec postgres psql -U hbv -d honeybadger -c \
  "SELECT name, is_active FROM api_keys;"

# Generate new key if needed
docker-compose exec api npm run generate-api-key -- "Test Key"
```

---

## Performance Tuning

### PostgreSQL Optimization

Add to `docker-compose.yml` under postgres service:

```yaml
command:
  - "postgres"
  - "-c"
  - "max_connections=200"
  - "-c"
  - "shared_buffers=256MB"
  - "-c"
  - "effective_cache_size=1GB"
  - "-c"
  - "work_mem=16MB"
```

### Redis Configuration

```yaml
redis:
  command:
    - redis-server
    - --requirepass ${REDIS_PASSWORD}
    - --maxmemory 512mb
    - --maxmemory-policy allkeys-lru
```

### Node.js Tuning

```yaml
api:
  environment:
    NODE_OPTIONS: "--max-old-space-size=2048"
```

---

## Integrating with HBV Tools

### Example: Python Integration

```python
import requests
import os

class HBVClient:
    def __init__(self):
        self.api_url = os.getenv('HBV_API_URL', 'http://localhost:3000')
        self.api_key = os.getenv('HBV_API_KEY')
        self.headers = {'X-API-Key': self.api_key}

    def beacon(self, agent_id, hostname, platform):
        response = requests.post(
            f'{self.api_url}/api/v1/beacon',
            headers=self.headers,
            json={
                'agent_id': agent_id,
                'hostname': hostname,
                'platform': platform
            }
        )
        return response.json()

    def submit_result(self, agent_id, module, target, data):
        response = requests.post(
            f'{self.api_url}/api/v1/results',
            headers=self.headers,
            json={
                'agent_id': agent_id,
                'module': module,
                'target': target,
                'data': data
            }
        )
        return response.json()

# Usage
client = HBVClient()
client.beacon('agent-001', 'recon-box', 'linux')
client.submit_result('agent-001', 'port-scan', 'example.com', {'ports': [80, 443]})
```

### Example: Bash Integration

```bash
#!/bin/bash

# Configuration
HBV_API_URL="${HBV_API_URL:-http://localhost:3000}"
HBV_API_KEY="${HBV_API_KEY}"
AGENT_ID="$(hostname)-$$"

# Beacon function
hbv_beacon() {
    curl -s -X POST "${HBV_API_URL}/api/v1/beacon" \
        -H "X-API-Key: ${HBV_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"agent_id\":\"${AGENT_ID}\",\"hostname\":\"$(hostname)\",\"platform\":\"linux\"}"
}

# Submit results function
hbv_submit() {
    local module="$1"
    local target="$2"
    local data="$3"

    curl -s -X POST "${HBV_API_URL}/api/v1/results" \
        -H "X-API-Key: ${HBV_API_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"agent_id\":\"${AGENT_ID}\",\"module\":\"${module}\",\"target\":\"${target}\",\"data\":${data}}"
}

# Usage
hbv_beacon
hbv_submit "port-scan" "example.com" '{"ports":[80,443]}'
```

---

## Updating

### Update Application Code

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose build api
docker-compose up -d api
```

### Update Dependencies

```bash
# Update package.json versions
cd api/
npm update

# Rebuild container
docker-compose build api
docker-compose up -d api
```

### Database Migrations

Future schema changes should be applied as migrations:

```bash
# Example migration
docker-compose exec postgres psql -U hbv -d honeybadger < migrations/001_add_column.sql
```

---

## License

© 2025 HoneyBadger Vanguard. All rights reserved.

---

## Support

For issues, questions, or contributions:

- GitHub Issues: https://github.com/invokehoneybadger/invokehoneybadger-api/issues
- Documentation: https://api.invokehoneybadger.com

---

**Remember**: This is a command & control API for security tools. Use responsibly and only on authorized systems. Maintain proper OPSEC at all times.
