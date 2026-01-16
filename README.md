# InfluxDB 2.x to 3.x Migration Tool

A comprehensive CLI tool for migrating data from InfluxDB 2.x to InfluxDB 3.x with automatic Grafana dashboard transformation.

## Features

- **Data Migration**: Batch migration with checkpoint/resume support
- **Verification**: Automated data integrity verification
- **Grafana Integration**: Automatic dashboard query transformation from Flux to SQL/InfluxQL 3.x
- **Resumable**: Save progress and resume from checkpoints
- **Structured Logging**: JSON-formatted logs with configurable levels
- **Automation-Ready**: Exit codes and scriptable commands

## Installation

```bash
npm install
npm run build
npm link  # Optional: makes influx-migrate globally available
```

## Quick Start

### 1. Setup Configuration

Copy the example config and edit with your credentials:

```bash
cp config.example.json config.json
# Edit config.json with your actual InfluxDB and Grafana credentials
```

### 2. Migrate Data

```bash
influx-migrate migrate --config config.json
```

### 3. Verify Migration

```bash
influx-migrate verify --config config.json
```

### 4. Migrate Grafana Dashboards

```bash
influx-migrate dashboards --config config.json --dry-run
```

## Configuration

### Configuration File (Recommended)

Copy the example config and edit with your credentials:

```bash
cp config.example.json config.json
# Edit config.json with your actual values
```

The config file should look like this (see `config.example.json`):

```json
{
  "source": {
    "host": "localhost",
    "port": 8086,
    "token": "your-2x-token",
    "org": "your-org",
    "bucket": "your-bucket"
  },
  "destination": {
    "host": "localhost",
    "port": 8086,
    "token": "your-3x-token",
    "database": "your-database"
  },
  "grafana": {
    "url": "http://localhost:3000",
    "token": "your-grafana-token",
    "influx2xDatasource": "2x-datasource-uid",
    "influx3xDatasource": "3x-datasource-uid"
  },
  "migration": {
    "batchSize": 10000,
    "checkpointInterval": 100000,
    "checkpointPath": "./checkpoints",
    "verify": true
  }
}
```

Then use with `--config` flag:

```bash
influx-migrate migrate --config config.json
influx-migrate verify --config config.json
influx-migrate dashboards --config config.json
```

### Environment Variables (Alternative)

You can also use environment variables instead of a config file:

```bash
# Source InfluxDB 2.x
export INFLUX_2X_HOST=localhost
export INFLUX_2X_PORT=8086
export INFLUX_2X_TOKEN=your-2x-token
export INFLUX_2X_ORG=your-org
export INFLUX_2X_BUCKET=your-bucket

# Destination InfluxDB 3.x
export INFLUX_3X_HOST=localhost
export INFLUX_3X_PORT=8086
export INFLUX_3X_TOKEN=your-3x-token
export INFLUX_3X_DATABASE=your-database

# Grafana (optional)
export GRAFANA_URL=http://localhost:3000
export GRAFANA_TOKEN=your-grafana-token
export GRAFANA_INFLUX2X_DATASOURCE=2x-datasource-uid
export GRAFANA_INFLUX3X_DATASOURCE=3x-datasource-uid

# Migration settings
export MIGRATION_BATCH_SIZE=10000
export MIGRATION_CHECKPOINT_INTERVAL=100000
export MIGRATION_CHECKPOINT_PATH=./checkpoints
```

**Configuration Priority:** Command-line flags > Config file > Environment variables > Defaults

## Commands

### `migrate`

Migrate data from InfluxDB 2.x to 3.x.

```bash
influx-migrate migrate [options]
```

**Options:**
- `--source-host <host>` - Source InfluxDB 2.x host
- `--source-port <port>` - Source InfluxDB 2.x port (default: 8086)
- `--source-token <token>` - Source InfluxDB 2.x token
- `--source-org <org>` - Source InfluxDB 2.x organization
- `--source-bucket <bucket>` - Source InfluxDB 2.x bucket
- `--dest-host <host>` - Destination InfluxDB 3.x host
- `--dest-port <port>` - Destination InfluxDB 3.x port (default: 8086)
- `--dest-token <token>` - Destination InfluxDB 3.x token
- `--dest-database <database>` - Destination InfluxDB 3.x database
- `--start-time <time>` - Start time (e.g., -7d, 2024-01-01)
- `--end-time <time>` - End time (e.g., now(), 2024-12-31)
- `--batch-size <size>` - Batch size (default: 10000)
- `--checkpoint-interval <interval>` - Checkpoint interval (default: 100000)
- `--checkpoint-path <path>` - Checkpoint directory (default: ./checkpoints)
- `--no-verify` - Skip post-migration verification

**Examples:**

Migrate with config file:
```bash
influx-migrate migrate --config config.json
```

Migrate last 7 days of data:
```bash
influx-migrate migrate --config config.json --start-time -7d
```

Migrate specific time range:
```bash
influx-migrate migrate --config config.json \
  --start-time 2024-01-01 --end-time 2024-12-31
```

Or use command-line flags only:
```bash
influx-migrate migrate \
  --source-host localhost --source-token <token> \
  --source-org myorg --source-bucket mybucket \
  --dest-host localhost --dest-token <token> \
  --dest-database mydb
```

### `resume`

Resume a migration from checkpoint.

```bash
influx-migrate resume <migration-id> [options]
```

**Arguments:**
- `<migration-id>` - Migration ID from checkpoint file

**Examples:**

```bash
# List available checkpoints
influx-migrate checkpoints --config config.json

# Resume specific migration with config file
influx-migrate resume localhost_mybucket_to_localhost_mydb_2024-01-15T10-30-00-000Z \
  --config config.json
```

### `verify`

Verify data migration integrity.

```bash
influx-migrate verify [options]
```

Performs the following checks:
- Record count comparison (with 0.1% tolerance)
- Time range validation
- Reports warnings and errors

**Example:**

```bash
influx-migrate verify --config config.json
```

### `dashboards`

Migrate Grafana dashboards from InfluxDB 2.x to 3.x.

```bash
influx-migrate dashboards [options]
```

**Options:**
- `--grafana-url <url>` - Grafana URL
- `--grafana-token <token>` - Grafana API token
- `--influx2x-datasource <uid>` - InfluxDB 2.x datasource UID
- `--influx3x-datasource <uid>` - InfluxDB 3.x datasource UID
- `--dry-run` - Perform dry run without creating dashboards
- `--output <file>` - Save report to file

**Features:**
- Discovers dashboards using InfluxDB 2.x datasources
- Transforms Flux queries to SQL/InfluxQL 3.x
- Creates new dashboards with "(InfluxDB 3.x)" suffix
- Generates detailed transformation report
- Flags queries requiring manual review

**Examples:**

Dry run with config file (no changes):
```bash
influx-migrate dashboards --config config.json --dry-run
```

Migrate dashboards and save report:
```bash
influx-migrate dashboards --config config.json --output dashboard-migration-report.txt
```

Or use command-line flags:
```bash
influx-migrate dashboards \
  --grafana-url http://localhost:3000 \
  --grafana-token <token> \
  --influx2x-datasource abc123 \
  --influx3x-datasource xyz789 \
  --dry-run
```

### `checkpoints`

List available migration checkpoints.

```bash
influx-migrate checkpoints [options]
```

**Options:**
- `--checkpoint-path <path>` - Checkpoint directory (default: ./checkpoints)

## Global Options

Available for all commands:

- `-l, --log-level <level>` - Log level: error, warn, info, debug (default: info)
- `--log-file <file>` - Log file path
- `--config <file>` - Configuration file path (JSON)

**Examples:**

Use config file:
```bash
influx-migrate migrate --config config.json
```

Enable debug logging:
```bash
influx-migrate migrate --config config.json --log-level debug
```

Log to file:
```bash
influx-migrate migrate --config config.json --log-file migration.log
```

## Exit Codes

The CLI uses specific exit codes for automation:

- `0` - Success
- `1` - General error
- `2` - Configuration error
- `3` - Connection error
- `4` - Migration error
- `5` - Verification error

**Example automation script:**

```bash
#!/bin/bash
influx-migrate migrate --config config.json
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "Migration successful"
  influx-migrate dashboards --config config.json
elif [ $EXIT_CODE -eq 4 ]; then
  echo "Migration failed, checking for checkpoint..."
  # Handle checkpoint resume logic
else
  echo "Error: $EXIT_CODE"
  exit $EXIT_CODE
fi
```

## Query Transformation

The dashboard migrator transforms Flux queries to SQL/InfluxQL 3.x format.

### Supported Transformations

**Simple queries:**
```flux
from(bucket: "mybucket")
  |> range(start: -1h)
  |> filter(fn: (r) => r._measurement == "cpu")
  |> filter(fn: (r) => r._field == "usage_idle")
```

Transforms to:
```sql
-- Transformed from Flux query
SELECT "usage_idle"
FROM "cpu"
WHERE time >= NOW() - INTERVAL '1' HOURS
```

**Aggregations:**
```flux
from(bucket: "mybucket")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "mem")
  |> aggregateWindow(every: 5m, fn: mean)
```

Transforms to:
```sql
-- Transformed from Flux query
SELECT MEAN("value") AS value_mean
FROM "mem"
WHERE time >= NOW() - INTERVAL '24' HOURS
GROUP BY time(5m)
```

### Confidence Levels

- **High** - Simple queries, no manual review needed
- **Medium** - Mostly straightforward, review recommended
- **Low** - Complex queries, manual review required

Dashboards with low-confidence transformations are flagged in the report.

## Checkpoints and Resume

The migration automatically saves checkpoints at configurable intervals. If migration is interrupted, resume from the last checkpoint.

**Checkpoint structure:**
```
./checkpoints/
  localhost_mybucket_to_localhost_mydb_2024-01-15T10-30-00-000Z.json
```

**Checkpoint file contents:**
- Migration ID
- Last processed timestamp
- Records migrated
- Source/destination configuration
- Metadata

## Logging

Logs are structured JSON format for easy parsing:

```json
{
  "level": "info",
  "message": "Migration checkpoint",
  "timestamp": "2024-01-15 10:30:00",
  "component": "migrator",
  "migratedRecords": 100000,
  "totalRecords": 500000,
  "percentComplete": "20.00%",
  "recordsPerSecond": 5000
}
```

## Development

### Build

```bash
npm run build
```

### Run locally

```bash
npm run dev -- migrate --config config.json
```

### Project Structure

```
src/
  ├── cli.ts                    # Main CLI entry point
  ├── config/
  │   ├── types.ts             # Configuration interfaces
  │   └── loader.ts            # Configuration loading logic
  ├── migration/
  │   ├── influx2x-client.ts   # InfluxDB 2.x client wrapper
  │   ├── influx3x-client.ts   # InfluxDB 3.x client wrapper
  │   ├── migrator.ts          # Core migration engine
  │   ├── checkpoint.ts        # Checkpoint management
  │   └── verifier.ts          # Data verification
  ├── dashboards/
  │   ├── grafana-client.ts    # Grafana API client
  │   ├── query-transformer.ts # Flux to SQL transformer
  │   └── dashboard-migrator.ts # Dashboard migration orchestrator
  └── utils/
      └── logger.ts            # Winston logger configuration
```

## Troubleshooting

### Connection Errors

If you see connection errors, verify:
1. InfluxDB instances are running
2. Tokens have correct permissions (read for source, write for destination)
3. Network connectivity and firewall rules
4. Correct host and port configuration

### Verification Failures

If verification fails:
1. Check record count difference percentage
2. Review time range discrepancies
3. Consider data still being written to source during migration
4. Re-run migration with specific time range

### Dashboard Transformation Issues

If queries require manual review:
1. Check transformation report for warnings
2. Complex Flux queries may need manual conversion
3. Test transformed queries in InfluxDB 3.x
4. Update dashboard manually if needed

## License

MIT

## Contributing

Issues and pull requests welcome!
