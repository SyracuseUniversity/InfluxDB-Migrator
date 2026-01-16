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
export declare class CheckpointManager {
    private checkpointDir;
    private logger;
    constructor(checkpointDir: string, logger: winston.Logger);
    private ensureCheckpointDir;
    private getCheckpointPath;
    generateMigrationId(sourceHost: string, sourceBucket: string, destHost: string, destDatabase: string): string;
    save(data: CheckpointData): Promise<void>;
    load(migrationId: string): Promise<CheckpointData | null>;
    list(): Promise<CheckpointData[]>;
    delete(migrationId: string): Promise<boolean>;
}
//# sourceMappingURL=checkpoint.d.ts.map