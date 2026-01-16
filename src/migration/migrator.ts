import { Influx2xClient } from './influx2x-client';
import { Influx3xClient } from './influx3x-client';
import { AppConfig } from '../config/types';
import { CheckpointManager, CheckpointData } from './checkpoint';
import winston from 'winston';

export interface MigrationProgress {
  migrationId: string;
  totalRecords: number;
  migratedRecords: number;
  startTime: Date;
  currentBatch: number;
  lastTimestamp?: string;
  status: 'running' | 'completed' | 'failed' | 'paused';
  error?: string;
}

export class Migrator {
  private sourceClient: Influx2xClient;
  private destClient: Influx3xClient;
  private config: AppConfig;
  private logger: winston.Logger;
  private checkpointManager: CheckpointManager;
  private progress: MigrationProgress;

  constructor(config: AppConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;
    this.sourceClient = new Influx2xClient(config.source);
    this.destClient = new Influx3xClient(config.destination);
    this.checkpointManager = new CheckpointManager(config.migration.checkpointPath, logger);

    // Generate migration ID
    const migrationId = this.checkpointManager.generateMigrationId(
      config.source.host,
      config.source.bucket,
      config.destination.host,
      config.destination.database
    );

    this.progress = {
      migrationId,
      totalRecords: 0,
      migratedRecords: 0,
      startTime: new Date(),
      currentBatch: 0,
      status: 'running'
    };
  }

  async testConnections(): Promise<{ source: boolean; destination: boolean }> {
    this.logger.info('Testing connections...', { component: 'migrator' });

    const [sourceOk, destOk] = await Promise.all([
      this.sourceClient.testConnection(),
      this.destClient.testConnection()
    ]);

    this.logger.info('Connection test results', {
      component: 'migrator',
      source: sourceOk ? 'connected' : 'failed',
      destination: destOk ? 'connected' : 'failed'
    });

    return { source: sourceOk, destination: destOk };
  }

  async getSourceMetadata() {
    this.logger.info('Fetching source metadata...', { component: 'migrator' });
    const metadata = await this.sourceClient.getMetadata();

    this.logger.info('Source metadata retrieved', {
      component: 'migrator',
      measurements: metadata.measurements.length,
      timeRange: metadata.timeRange
    });

    return metadata;
  }

  async migrate(startTime?: string, endTime?: string): Promise<MigrationProgress> {
    try {
      this.progress.status = 'running';
      this.progress.startTime = new Date();

      this.logger.info('Starting migration', {
        component: 'migrator',
        batchSize: this.config.migration.batchSize,
        startTime,
        endTime
      });

      // Get estimated row count for progress tracking
      try {
        const rowCount = await this.sourceClient.getRowCount();
        this.progress.totalRecords = rowCount;
        this.logger.info('Estimated records to migrate', {
          component: 'migrator',
          totalRecords: rowCount
        });
      } catch (error) {
        this.logger.warn('Could not get row count estimate', {
          component: 'migrator',
          error: error instanceof Error ? error.message : String(error)
        });
      }

      // Process data in batches using async generator
      const dataGenerator = this.sourceClient.queryData(startTime, endTime);
      let batchNumber = 0;

      for await (const batch of dataGenerator) {
        if (batch.length === 0) continue;

        batchNumber++;
        this.progress.currentBatch = batchNumber;

        this.logger.info('Processing batch', {
          component: 'migrator',
          batchNumber,
          batchSize: batch.length,
          migratedRecords: this.progress.migratedRecords
        });

        // Write batch to destination
        await this.destClient.writeBatch(batch);

        this.progress.migratedRecords += batch.length;

        // Get last timestamp from batch
        const lastRecord = batch[batch.length - 1];
        if (lastRecord && lastRecord._time) {
          this.progress.lastTimestamp = lastRecord._time;
        }

        // Save checkpoint and log progress at checkpoint intervals
        if (this.progress.migratedRecords % this.config.migration.checkpointInterval === 0) {
          const elapsed = Date.now() - this.progress.startTime.getTime();
          const rate = this.progress.migratedRecords / (elapsed / 1000);

          // Save checkpoint
          await this.saveCheckpoint();

          this.logger.info('Migration checkpoint', {
            component: 'migrator',
            migratedRecords: this.progress.migratedRecords,
            totalRecords: this.progress.totalRecords,
            percentComplete: this.progress.totalRecords > 0
              ? ((this.progress.migratedRecords / this.progress.totalRecords) * 100).toFixed(2) + '%'
              : 'unknown',
            recordsPerSecond: Math.round(rate),
            elapsedSeconds: Math.round(elapsed / 1000)
          });
        }
      }

      this.progress.status = 'completed';
      const totalElapsed = Date.now() - this.progress.startTime.getTime();

      this.logger.info('Migration completed', {
        component: 'migrator',
        migratedRecords: this.progress.migratedRecords,
        batches: batchNumber,
        elapsedSeconds: Math.round(totalElapsed / 1000),
        averageRecordsPerSecond: Math.round(this.progress.migratedRecords / (totalElapsed / 1000))
      });

      return this.progress;

    } catch (error) {
      this.progress.status = 'failed';
      this.progress.error = error instanceof Error ? error.message : String(error);

      this.logger.error('Migration failed', {
        component: 'migrator',
        error: this.progress.error,
        migratedRecords: this.progress.migratedRecords,
        currentBatch: this.progress.currentBatch
      });

      throw error;
    }
  }

  getProgress(): MigrationProgress {
    return { ...this.progress };
  }

  private async saveCheckpoint(): Promise<void> {
    const metadata = await this.getSourceMetadata();

    const checkpointData: CheckpointData = {
      migrationId: this.progress.migrationId,
      lastTimestamp: this.progress.lastTimestamp || '',
      migratedRecords: this.progress.migratedRecords,
      totalRecords: this.progress.totalRecords,
      currentBatch: this.progress.currentBatch,
      startTime: this.progress.startTime.toISOString(),
      lastUpdateTime: new Date().toISOString(),
      sourceConfig: {
        host: this.config.source.host,
        org: this.config.source.org,
        bucket: this.config.source.bucket
      },
      destConfig: {
        host: this.config.destination.host,
        database: this.config.destination.database
      },
      metadata: {
        measurements: metadata.measurements,
        timeRange: metadata.timeRange
      }
    };

    await this.checkpointManager.save(checkpointData);
  }

  async resume(migrationId: string): Promise<MigrationProgress> {
    this.logger.info('Attempting to resume migration', {
      component: 'migrator',
      migrationId
    });

    const checkpoint = await this.checkpointManager.load(migrationId);

    if (!checkpoint) {
      throw new Error(`No checkpoint found for migration ID: ${migrationId}`);
    }

    // Validate that source and destination match
    if (checkpoint.sourceConfig.host !== this.config.source.host ||
        checkpoint.sourceConfig.bucket !== this.config.source.bucket ||
        checkpoint.destConfig.host !== this.config.destination.host ||
        checkpoint.destConfig.database !== this.config.destination.database) {
      throw new Error('Checkpoint source/destination does not match current configuration');
    }

    // Restore progress from checkpoint
    this.progress = {
      migrationId: checkpoint.migrationId,
      totalRecords: checkpoint.totalRecords,
      migratedRecords: checkpoint.migratedRecords,
      startTime: new Date(checkpoint.startTime),
      currentBatch: checkpoint.currentBatch,
      lastTimestamp: checkpoint.lastTimestamp,
      status: 'running'
    };

    this.logger.info('Resuming migration from checkpoint', {
      component: 'migrator',
      migrationId,
      migratedRecords: checkpoint.migratedRecords,
      lastTimestamp: checkpoint.lastTimestamp
    });

    // Resume migration from last timestamp
    return await this.migrate(checkpoint.lastTimestamp);
  }

  async listCheckpoints(): Promise<CheckpointData[]> {
    return await this.checkpointManager.list();
  }

  async deleteCheckpoint(migrationId: string): Promise<boolean> {
    return await this.checkpointManager.delete(migrationId);
  }
}
