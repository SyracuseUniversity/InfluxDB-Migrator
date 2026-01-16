import * as fs from 'fs';
import * as path from 'path';
import winston from 'winston';

export interface CheckpointData {
  migrationId: string;
  lastTimestamp: string;
  migratedRecords: number;
  totalRecords: number;
  currentBatch: number;
  startTime: string;
  lastUpdateTime: string;
  sourceConfig: {
    host: string;
    org: string;
    bucket: string;
  };
  destConfig: {
    host: string;
    database: string;
  };
  metadata?: {
    measurements?: string[];
    timeRange?: {
      earliest: string;
      latest: string;
    };
  };
}

export class CheckpointManager {
  private checkpointDir: string;
  private logger: winston.Logger;

  constructor(checkpointDir: string, logger: winston.Logger) {
    this.checkpointDir = checkpointDir;
    this.logger = logger;
  }

  private ensureCheckpointDir(): void {
    if (!fs.existsSync(this.checkpointDir)) {
      fs.mkdirSync(this.checkpointDir, { recursive: true });
      this.logger.info('Created checkpoint directory', {
        component: 'checkpoint',
        path: this.checkpointDir
      });
    }
  }

  private getCheckpointPath(migrationId: string): string {
    return path.join(this.checkpointDir, `${migrationId}.json`);
  }

  generateMigrationId(sourceHost: string, sourceBucket: string, destHost: string, destDatabase: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${sourceHost}_${sourceBucket}_to_${destHost}_${destDatabase}_${timestamp}`;
  }

  async save(data: CheckpointData): Promise<void> {
    try {
      this.ensureCheckpointDir();
      const checkpointPath = this.getCheckpointPath(data.migrationId);

      data.lastUpdateTime = new Date().toISOString();

      await fs.promises.writeFile(
        checkpointPath,
        JSON.stringify(data, null, 2),
        'utf-8'
      );

      this.logger.info('Checkpoint saved', {
        component: 'checkpoint',
        migrationId: data.migrationId,
        migratedRecords: data.migratedRecords,
        path: checkpointPath
      });
    } catch (error) {
      this.logger.error('Failed to save checkpoint', {
        component: 'checkpoint',
        error: error instanceof Error ? error.message : String(error),
        migrationId: data.migrationId
      });
      throw error;
    }
  }

  async load(migrationId: string): Promise<CheckpointData | null> {
    try {
      const checkpointPath = this.getCheckpointPath(migrationId);

      if (!fs.existsSync(checkpointPath)) {
        this.logger.info('No checkpoint found', {
          component: 'checkpoint',
          migrationId,
          path: checkpointPath
        });
        return null;
      }

      const content = await fs.promises.readFile(checkpointPath, 'utf-8');
      const data = JSON.parse(content) as CheckpointData;

      this.logger.info('Checkpoint loaded', {
        component: 'checkpoint',
        migrationId,
        migratedRecords: data.migratedRecords,
        lastTimestamp: data.lastTimestamp
      });

      return data;
    } catch (error) {
      this.logger.error('Failed to load checkpoint', {
        component: 'checkpoint',
        error: error instanceof Error ? error.message : String(error),
        migrationId
      });
      return null;
    }
  }

  async list(): Promise<CheckpointData[]> {
    try {
      this.ensureCheckpointDir();
      const files = await fs.promises.readdir(this.checkpointDir);
      const checkpoints: CheckpointData[] = [];

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(this.checkpointDir, file);
          const content = await fs.promises.readFile(filePath, 'utf-8');
          try {
            const data = JSON.parse(content) as CheckpointData;
            checkpoints.push(data);
          } catch (parseError) {
            this.logger.warn('Failed to parse checkpoint file', {
              component: 'checkpoint',
              file,
              error: parseError instanceof Error ? parseError.message : String(parseError)
            });
          }
        }
      }

      this.logger.info('Listed checkpoints', {
        component: 'checkpoint',
        count: checkpoints.length
      });

      return checkpoints.sort((a, b) =>
        new Date(b.lastUpdateTime).getTime() - new Date(a.lastUpdateTime).getTime()
      );
    } catch (error) {
      this.logger.error('Failed to list checkpoints', {
        component: 'checkpoint',
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  async delete(migrationId: string): Promise<boolean> {
    try {
      const checkpointPath = this.getCheckpointPath(migrationId);

      if (!fs.existsSync(checkpointPath)) {
        this.logger.warn('Checkpoint not found for deletion', {
          component: 'checkpoint',
          migrationId
        });
        return false;
      }

      await fs.promises.unlink(checkpointPath);

      this.logger.info('Checkpoint deleted', {
        component: 'checkpoint',
        migrationId,
        path: checkpointPath
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to delete checkpoint', {
        component: 'checkpoint',
        error: error instanceof Error ? error.message : String(error),
        migrationId
      });
      return false;
    }
  }
}
