#!/usr/bin/env node

import { Command } from 'commander';
import { ConfigLoader } from './config/loader';
import { AppConfig } from './config/types';
import { Migrator } from './migration/migrator';
import { Verifier } from './migration/verifier';
import { DashboardMigrator } from './dashboards/dashboard-migrator';
import { createLogger, LOG_LEVELS } from './utils/logger';
import * as fs from 'fs';
import * as path from 'path';

// Exit codes
const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  CONFIG_ERROR: 2,
  CONNECTION_ERROR: 3,
  MIGRATION_ERROR: 4,
  VERIFICATION_ERROR: 5
};

const program = new Command();

program
  .name('influx-migrate')
  .description('CLI tool for migrating InfluxDB 2.x to 3.x with Grafana dashboard transformation')
  .version('1.0.0');

// Global options
program
  .option('-l, --log-level <level>', 'Log level (error, warn, info, debug)', 'info')
  .option('--log-file <file>', 'Log file path')
  .option('--config <file>', 'Configuration file path (JSON)');

// Migrate command
program
  .command('migrate')
  .description('Migrate data from InfluxDB 2.x to 3.x')
  .option('--source-host <host>', 'Source InfluxDB 2.x host')
  .option('--source-port <port>', 'Source InfluxDB 2.x port', '8086')
  .option('--source-token <token>', 'Source InfluxDB 2.x token')
  .option('--source-org <org>', 'Source InfluxDB 2.x organization')
  .option('--source-bucket <bucket>', 'Source InfluxDB 2.x bucket')
  .option('--dest-host <host>', 'Destination InfluxDB 3.x host')
  .option('--dest-port <port>', 'Destination InfluxDB 3.x port', '8181')
  .option('--dest-token <token>', 'Destination InfluxDB 3.x token')
  .option('--dest-database <database>', 'Destination InfluxDB 3.x database')
  .option('--start-time <time>', 'Start time for data migration (e.g., -7d, 2024-01-01)')
  .option('--end-time <time>', 'End time for data migration (e.g., now(), 2024-12-31)')
  .option('--batch-size <size>', 'Batch size for migration', '10000')
  .option('--checkpoint-interval <interval>', 'Checkpoint interval', '100000')
  .option('--checkpoint-path <path>', 'Checkpoint directory path', './checkpoints')
  .option('--no-verify', 'Skip post-migration verification')
  .action(async (options) => {
    const logger = createLogger(program.opts().logLevel, program.opts().logFile);

    try {
      logger.info('Starting migration', { component: 'cli' });

      // Build configuration
      const config = await buildConfig(options, program.opts(), logger);

      // Test connections
      logger.info('Testing connections', { component: 'cli' });
      const migrator = new Migrator(config, logger);
      const connections = await migrator.testConnections();

      if (!connections.source) {
        logger.error('Failed to connect to source InfluxDB 2.x', { component: 'cli' });
        process.exit(EXIT_CODES.CONNECTION_ERROR);
      }

      if (!connections.destination) {
        logger.error('Failed to connect to destination InfluxDB 3.x', { component: 'cli' });
        process.exit(EXIT_CODES.CONNECTION_ERROR);
      }

      logger.info('Connections successful', { component: 'cli' });

      // Get source metadata
      const metadata = await migrator.getSourceMetadata();
      logger.info('Source database metadata', {
        component: 'cli',
        measurements: metadata.measurements.length,
        timeRange: metadata.timeRange
      });

      // Run migration
      const progress = await migrator.migrate(options.startTime, options.endTime);
      logger.info('Migration completed', {
        component: 'cli',
        migratedRecords: progress.migratedRecords,
        status: progress.status
      });

      // Run verification if enabled
      if (options.verify !== false) {
        logger.info('Running verification', { component: 'cli' });
        const verifier = new Verifier(config, logger);
        const verificationResult = await verifier.verify();

        if (verificationResult.passed) {
          logger.info('Verification passed', {
            component: 'cli',
            warnings: verificationResult.warnings.length
          });
        } else {
          logger.error('Verification failed', {
            component: 'cli',
            errors: verificationResult.errors
          });
          process.exit(EXIT_CODES.VERIFICATION_ERROR);
        }
      }

      logger.info('Migration successful', { component: 'cli' });
      process.exit(EXIT_CODES.SUCCESS);

    } catch (error) {
      logger.error('Migration failed', {
        component: 'cli',
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(EXIT_CODES.MIGRATION_ERROR);
    }
  });

// Resume command
program
  .command('resume <migration-id>')
  .description('Resume a migration from checkpoint')
  .option('--source-host <host>', 'Source InfluxDB 2.x host')
  .option('--source-port <port>', 'Source InfluxDB 2.x port', '8086')
  .option('--source-token <token>', 'Source InfluxDB 2.x token')
  .option('--source-org <org>', 'Source InfluxDB 2.x organization')
  .option('--source-bucket <bucket>', 'Source InfluxDB 2.x bucket')
  .option('--dest-host <host>', 'Destination InfluxDB 3.x host')
  .option('--dest-port <port>', 'Destination InfluxDB 3.x port', '8181')
  .option('--dest-token <token>', 'Destination InfluxDB 3.x token')
  .option('--dest-database <database>', 'Destination InfluxDB 3.x database')
  .option('--checkpoint-path <path>', 'Checkpoint directory path', './checkpoints')
  .action(async (migrationId, options) => {
    const logger = createLogger(program.opts().logLevel, program.opts().logFile);

    try {
      logger.info('Resuming migration', { component: 'cli', migrationId });

      // Build configuration
      const config = await buildConfig(options, program.opts(), logger);

      // Resume migration
      const migrator = new Migrator(config, logger);
      const progress = await migrator.resume(migrationId);

      logger.info('Migration resumed and completed', {
        component: 'cli',
        migrationId,
        migratedRecords: progress.migratedRecords,
        status: progress.status
      });

      process.exit(EXIT_CODES.SUCCESS);

    } catch (error) {
      logger.error('Resume failed', {
        component: 'cli',
        migrationId,
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(EXIT_CODES.MIGRATION_ERROR);
    }
  });

// Verify command
program
  .command('verify')
  .description('Verify data migration integrity')
  .option('--source-host <host>', 'Source InfluxDB 2.x host')
  .option('--source-port <port>', 'Source InfluxDB 2.x port', '8086')
  .option('--source-token <token>', 'Source InfluxDB 2.x token')
  .option('--source-org <org>', 'Source InfluxDB 2.x organization')
  .option('--source-bucket <bucket>', 'Source InfluxDB 2.x bucket')
  .option('--dest-host <host>', 'Destination InfluxDB 3.x host')
  .option('--dest-port <port>', 'Destination InfluxDB 3.x port', '8181')
  .option('--dest-token <token>', 'Destination InfluxDB 3.x token')
  .option('--dest-database <database>', 'Destination InfluxDB 3.x database')
  .action(async (options) => {
    const logger = createLogger(program.opts().logLevel, program.opts().logFile);

    try {
      logger.info('Starting verification', { component: 'cli' });

      // Build configuration
      const config = await buildConfig(options, program.opts(), logger);

      // Run verification
      const verifier = new Verifier(config, logger);
      const result = await verifier.verify();

      // Display results
      console.log('\n' + '='.repeat(80));
      console.log('VERIFICATION RESULTS');
      console.log('='.repeat(80));
      console.log(`\nOverall Status: ${result.passed ? '✓ PASSED' : '✗ FAILED'}`);
      console.log(`\nRecord Count Check: ${result.checks.recordCount.passed ? '✓' : '✗'}`);
      console.log(`  Source: ${result.checks.recordCount.source}`);
      console.log(`  Destination: ${result.checks.recordCount.destination}`);
      console.log(`  Difference: ${result.checks.recordCount.difference} (${result.checks.recordCount.percentDifference.toFixed(2)}%)`);

      console.log(`\nTime Range Check: ${result.checks.timeRange.passed ? '✓' : '✗'}`);
      console.log(`  ${result.checks.timeRange.message}`);

      if (result.warnings.length > 0) {
        console.log('\nWarnings:');
        result.warnings.forEach(warn => console.log(`  ⚠️  ${warn}`));
      }

      if (result.errors.length > 0) {
        console.log('\nErrors:');
        result.errors.forEach(error => console.log(`  ✗ ${error}`));
      }

      console.log('\n' + '='.repeat(80) + '\n');

      process.exit(result.passed ? EXIT_CODES.SUCCESS : EXIT_CODES.VERIFICATION_ERROR);

    } catch (error) {
      logger.error('Verification failed', {
        component: 'cli',
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(EXIT_CODES.VERIFICATION_ERROR);
    }
  });

// Dashboards command
program
  .command('dashboards')
  .description('Migrate Grafana dashboards from InfluxDB 2.x to 3.x')
  .option('--grafana-url <url>', 'Grafana URL')
  .option('--grafana-token <token>', 'Grafana API token')
  .option('--influx2x-datasource <uid>', 'InfluxDB 2.x datasource UID')
  .option('--influx3x-datasource <uid>', 'InfluxDB 3.x datasource UID')
  .option('--dry-run', 'Perform dry run without creating dashboards', false)
  .option('--output <file>', 'Output report file path')
  .action(async (options) => {
    const logger = createLogger(program.opts().logLevel, program.opts().logFile);

    try {
      logger.info('Starting dashboard migration', {
        component: 'cli',
        dryRun: options.dryRun
      });

      // Build configuration
      const config = await buildConfig(options, program.opts(), logger);

      if (!config.grafana) {
        logger.error('Grafana configuration is required', { component: 'cli' });
        process.exit(EXIT_CODES.CONFIG_ERROR);
      }

      // Test Grafana connection
      const dashboardMigrator = new DashboardMigrator(config, logger);
      const connected = await dashboardMigrator.testConnection();

      if (!connected) {
        logger.error('Failed to connect to Grafana', { component: 'cli' });
        process.exit(EXIT_CODES.CONNECTION_ERROR);
      }

      // Run dashboard migration
      const summary = await dashboardMigrator.migrateDashboards(options.dryRun);

      // Generate report
      const report = await dashboardMigrator.generateMigrationReport(summary);
      console.log('\n' + report);

      // Save report to file if specified
      if (options.output) {
        fs.writeFileSync(options.output, report, 'utf-8');
        logger.info('Report saved', { component: 'cli', file: options.output });
      }

      logger.info('Dashboard migration completed', {
        component: 'cli',
        total: summary.totalDashboards,
        successful: summary.successfulMigrations,
        requiresReview: summary.dashboardsRequiringReview
      });

      process.exit(EXIT_CODES.SUCCESS);

    } catch (error) {
      logger.error('Dashboard migration failed', {
        component: 'cli',
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(EXIT_CODES.MIGRATION_ERROR);
    }
  });

// Checkpoints command
program
  .command('checkpoints')
  .description('List available migration checkpoints')
  .option('--checkpoint-path <path>', 'Checkpoint directory path', './checkpoints')
  .action(async (options) => {
    const logger = createLogger(program.opts().logLevel, program.opts().logFile);

    try {
      const config = await buildConfig(options, program.opts(), logger);
      const migrator = new Migrator(config, logger);
      const checkpoints = await migrator.listCheckpoints();

      if (checkpoints.length === 0) {
        console.log('No checkpoints found');
        process.exit(EXIT_CODES.SUCCESS);
      }

      console.log('\n' + '='.repeat(80));
      console.log('AVAILABLE CHECKPOINTS');
      console.log('='.repeat(80) + '\n');

      checkpoints.forEach((checkpoint, index) => {
        console.log(`${index + 1}. Migration ID: ${checkpoint.migrationId}`);
        console.log(`   Source: ${checkpoint.sourceConfig.host}/${checkpoint.sourceConfig.bucket}`);
        console.log(`   Destination: ${checkpoint.destConfig.host}/${checkpoint.destConfig.database}`);
        console.log(`   Migrated Records: ${checkpoint.migratedRecords.toLocaleString()}`);
        console.log(`   Last Update: ${checkpoint.lastUpdateTime}`);
        console.log('');
      });

      process.exit(EXIT_CODES.SUCCESS);

    } catch (error) {
      logger.error('Failed to list checkpoints', {
        component: 'cli',
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(EXIT_CODES.GENERAL_ERROR);
    }
  });

// Build configuration from multiple sources
async function buildConfig(
  commandOptions: any,
  globalOptions: any,
  logger: winston.Logger
): Promise<AppConfig> {
  // Load from environment variables
  const envConfig = ConfigLoader.loadFromEnv();

  // Load from config file if specified
  let fileConfig: Partial<AppConfig> = {};
  if (globalOptions.config) {
    try {
      const configPath = path.resolve(globalOptions.config);
      const configContent = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(configContent);
      logger.info('Loaded configuration file', { component: 'cli', file: configPath });
    } catch (error) {
      logger.error('Failed to load configuration file', {
        component: 'cli',
        file: globalOptions.config,
        error: error instanceof Error ? error.message : String(error)
      });
      process.exit(EXIT_CODES.CONFIG_ERROR);
    }
  }

  // Build from command-line flags
  const flagConfig = ConfigLoader.buildFromFlags(commandOptions);

  // Merge configurations (priority: flags > file > env > defaults)
  const config = ConfigLoader.merge(envConfig, fileConfig, flagConfig);

  // Validate configuration
  const errors = ConfigLoader.validate(config);
  if (errors.length > 0) {
    logger.error('Configuration validation failed', { component: 'cli', errors });
    errors.forEach(error => console.error(`  ✗ ${error}`));
    process.exit(EXIT_CODES.CONFIG_ERROR);
  }

  return config;
}

// Import winston for type
import winston from 'winston';

// Parse command line arguments
program.parse(process.argv);

// Show help if no command specified
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
