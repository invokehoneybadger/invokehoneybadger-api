#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Pool } = require('pg');

// ============================================================================
// Configuration
// ============================================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// ============================================================================
// Generate API Key
// ============================================================================
async function generateApiKey(name) {
  if (!name) {
    console.error('Error: API key name is required');
    console.log('\nUsage:');
    console.log('  npm run generate-api-key -- "Key Name"');
    console.log('\nExample:');
    console.log('  npm run generate-api-key -- "Primary Production Key"');
    process.exit(1);
  }

  try {
    // Generate a secure random API key
    const apiKey = 'hbv_' + crypto.randomBytes(32).toString('hex');

    // Hash the API key for storage
    const saltRounds = 12;
    const keyHash = await bcrypt.hash(apiKey, saltRounds);

    // Store in database
    const result = await pool.query(
      `INSERT INTO api_keys (key_hash, name, is_active)
       VALUES ($1, $2, TRUE)
       RETURNING id, created_at`,
      [keyHash, name]
    );

    console.log('\n='.repeat(80));
    console.log('API Key Generated Successfully');
    console.log('='.repeat(80));
    console.log('\nKey Details:');
    console.log(`  Name:       ${name}`);
    console.log(`  ID:         ${result.rows[0].id}`);
    console.log(`  Created:    ${result.rows[0].created_at}`);
    console.log('\n' + '='.repeat(80));
    console.log('API KEY (save this securely - it will not be shown again):');
    console.log('='.repeat(80));
    console.log(`\n  ${apiKey}\n`);
    console.log('='.repeat(80));
    console.log('\nUsage:');
    console.log('  curl -H "X-API-Key: ' + apiKey + '" http://your-api-url/api/v1/status');
    console.log('\nEnvironment variable:');
    console.log('  export HBV_API_KEY="' + apiKey + '"');
    console.log('='.repeat(80));
    console.log('\nWARNING: Store this key securely. It cannot be retrieved later.');
    console.log('='.repeat(80) + '\n');

  } catch (error) {
    console.error('\nError generating API key:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// ============================================================================
// Main
// ============================================================================
const keyName = process.argv[2];
generateApiKey(keyName);
