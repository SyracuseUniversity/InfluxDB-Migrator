import { AppConfig } from '../config/types';
import { CheckpointData } from './checkpoint';
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
export declare class Migrator {
    private sourceClient;
    private destClient;
    private config;
    private logger;
    private checkpointManager;
    private progress;
    constructor(config: AppConfig, logger: winston.Logger);
    testConnections(): Promise<{
        source: boolean;
        destination: boolean;
    }>;
    getSourceMetadata(): Promise<{
        measurements: string[];
        fieldKeys: string[];
        tagKeys: string[];
        timeRange: {
            earliest: string;
            latest: string;
        };
    }>;
    migrate(startTime?: string, endTime?: string): Promise<MigrationProgress>;
    getProgress(): MigrationProgress;
    private saveCheckpoint;
    resume(migrationId: string): Promise<MigrationProgress>;
    listCheckpoints(): Promise<CheckpointData[]>;
    deleteCheckpoint(migrationId: string): Promise<boolean>;
}
//# sourceMappingURL=migrator.d.ts.map