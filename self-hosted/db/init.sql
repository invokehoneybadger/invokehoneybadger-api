-- HoneyBadger Vanguard API - Database Schema
-- PostgreSQL 16+ with optimized indexes and triggers

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- API Keys Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key_hash VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_used_at TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_active ON api_keys(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- Agents Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id VARCHAR(255) NOT NULL UNIQUE,
    hostname VARCHAR(255),
    platform VARCHAR(100),
    ip_address INET,
    version VARCHAR(50),
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE,
    metadata JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX idx_agents_agent_id ON agents(agent_id);
CREATE INDEX idx_agents_last_seen ON agents(last_seen DESC);
CREATE INDEX idx_agents_active ON agents(is_active) WHERE is_active = TRUE;

-- ============================================================================
-- Beacons Table (Check-in History)
-- ============================================================================
CREATE TABLE IF NOT EXISTS beacons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id VARCHAR(255) NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_address INET,
    status VARCHAR(50) DEFAULT 'active',
    metadata JSONB DEFAULT '{}'::JSONB,
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
);

CREATE INDEX idx_beacons_agent_id ON beacons(agent_id);
CREATE INDEX idx_beacons_timestamp ON beacons(timestamp DESC);
CREATE INDEX idx_beacons_status ON beacons(status);

-- ============================================================================
-- Results Table (Scan/Recon Results)
-- ============================================================================
CREATE TABLE IF NOT EXISTS results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id VARCHAR(255) NOT NULL,
    module VARCHAR(100) NOT NULL,
    target VARCHAR(500),
    result_type VARCHAR(100),
    data JSONB NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    severity VARCHAR(50),
    metadata JSONB DEFAULT '{}'::JSONB,
    FOREIGN KEY (agent_id) REFERENCES agents(agent_id) ON DELETE CASCADE
);

CREATE INDEX idx_results_agent_id ON results(agent_id);
CREATE INDEX idx_results_module ON results(module);
CREATE INDEX idx_results_timestamp ON results(timestamp DESC);
CREATE INDEX idx_results_severity ON results(severity);
CREATE INDEX idx_results_target ON results(target);
CREATE INDEX idx_results_data_gin ON results USING GIN(data);

-- ============================================================================
-- Modules Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    version VARCHAR(50),
    category VARCHAR(100),
    is_enabled BOOLEAN DEFAULT TRUE,
    config JSONB DEFAULT '{}'::JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_modules_name ON modules(name);
CREATE INDEX idx_modules_category ON modules(category);
CREATE INDEX idx_modules_enabled ON modules(is_enabled) WHERE is_enabled = TRUE;

-- ============================================================================
-- Webhooks Table (v2 Feature)
-- ============================================================================
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    url VARCHAR(2048) NOT NULL,
    event_types TEXT[] NOT NULL,
    secret VARCHAR(255),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_triggered_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX idx_webhooks_active ON webhooks(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_webhooks_event_types ON webhooks USING GIN(event_types);

-- ============================================================================
-- Audit Log Table
-- ============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    event_type VARCHAR(100) NOT NULL,
    actor VARCHAR(255),
    resource_type VARCHAR(100),
    resource_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    ip_address INET,
    user_agent TEXT,
    details JSONB DEFAULT '{}'::JSONB
);

CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
CREATE INDEX idx_audit_log_event_type ON audit_log(event_type);
CREATE INDEX idx_audit_log_actor ON audit_log(actor);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_type, resource_id);

-- ============================================================================
-- Triggers
-- ============================================================================

-- Auto-update agents.last_seen on beacon
CREATE OR REPLACE FUNCTION update_agent_last_seen()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE agents
    SET last_seen = NEW.timestamp,
        is_active = TRUE
    WHERE agent_id = NEW.agent_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_agent_last_seen
    AFTER INSERT ON beacons
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_last_seen();

-- Auto-update modules.updated_at
CREATE OR REPLACE FUNCTION update_modified_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_modules_updated_at
    BEFORE UPDATE ON modules
    FOR EACH ROW
    EXECUTE FUNCTION update_modified_timestamp();

-- Auto-update api_keys.last_used_at (must be called from application)
CREATE OR REPLACE FUNCTION update_api_key_last_used(key_hash_param VARCHAR)
RETURNS VOID AS $$
BEGIN
    UPDATE api_keys
    SET last_used_at = CURRENT_TIMESTAMP
    WHERE key_hash = key_hash_param;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Seed Data - Default Modules
-- ============================================================================
INSERT INTO modules (name, description, version, category, is_enabled, config) VALUES
    ('port-scan', 'Network port scanning and service detection', '1.0.0', 'recon', TRUE, '{"default_ports": [80, 443, 22, 21, 25, 3389]}'::JSONB),
    ('subdomain-enum', 'Subdomain enumeration and discovery', '1.0.0', 'recon', TRUE, '{"sources": ["dns", "certificate-transparency", "search-engines"]}'::JSONB),
    ('web-crawl', 'Web application crawling and mapping', '1.0.0', 'recon', TRUE, '{"max_depth": 3, "follow_redirects": true}'::JSONB),
    ('vuln-scan', 'Vulnerability scanning and assessment', '1.0.0', 'exploit', TRUE, '{"severity_threshold": "medium"}'::JSONB),
    ('screenshot', 'Web page screenshot capture', '1.0.0', 'recon', TRUE, '{"resolution": "1920x1080", "format": "png"}'::JSONB),
    ('dns-enum', 'DNS enumeration and zone transfer testing', '1.0.0', 'recon', TRUE, '{"record_types": ["A", "AAAA", "MX", "TXT", "CNAME"]}'::JSONB),
    ('ssl-analysis', 'SSL/TLS configuration analysis', '1.0.0', 'recon', TRUE, '{"check_expiry": true, "check_cipher_strength": true}'::JSONB),
    ('directory-brute', 'Directory and file brute forcing', '1.0.0', 'recon', TRUE, '{"wordlist": "common.txt", "threads": 10}'::JSONB)
ON CONFLICT (name) DO NOTHING;

-- ============================================================================
-- Views for Common Queries
-- ============================================================================

-- Active agents with recent beacon count
CREATE OR REPLACE VIEW active_agents_summary AS
SELECT
    a.agent_id,
    a.hostname,
    a.platform,
    a.last_seen,
    COUNT(b.id) as beacon_count_24h,
    COUNT(r.id) as result_count_24h
FROM agents a
LEFT JOIN beacons b ON a.agent_id = b.agent_id
    AND b.timestamp > NOW() - INTERVAL '24 hours'
LEFT JOIN results r ON a.agent_id = r.agent_id
    AND r.timestamp > NOW() - INTERVAL '24 hours'
WHERE a.is_active = TRUE
GROUP BY a.agent_id, a.hostname, a.platform, a.last_seen;

-- Results summary by module
CREATE OR REPLACE VIEW results_by_module_summary AS
SELECT
    module,
    COUNT(*) as total_results,
    COUNT(DISTINCT agent_id) as unique_agents,
    MIN(timestamp) as first_result,
    MAX(timestamp) as last_result
FROM results
GROUP BY module;

-- ============================================================================
-- Maintenance Functions
-- ============================================================================

-- Archive old beacons (keep last 30 days)
CREATE OR REPLACE FUNCTION archive_old_beacons()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM beacons
    WHERE timestamp < NOW() - INTERVAL '30 days'
    RETURNING COUNT(*) INTO deleted_count;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Mark inactive agents (no beacon in 7 days)
CREATE OR REPLACE FUNCTION mark_inactive_agents()
RETURNS INTEGER AS $$
DECLARE
    updated_count INTEGER;
BEGIN
    UPDATE agents
    SET is_active = FALSE
    WHERE last_seen < NOW() - INTERVAL '7 days'
        AND is_active = TRUE
    RETURNING COUNT(*) INTO updated_count;
    RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Grant Permissions
-- ============================================================================
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO hbv;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO hbv;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO hbv;
