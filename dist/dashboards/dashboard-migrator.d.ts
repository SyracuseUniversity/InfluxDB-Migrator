import { DashboardDetail } from './grafana-client';
import { TransformResult } from './query-transformer';
import { AppConfig } from '../config/types';
import winston from 'winston';
export interface DashboardMigrationResult {
    originalDashboard: DashboardDetail;
    newDashboard?: DashboardDetail;
    transformations: {
        panelId: number;
        panelTitle: string;
        queries: TransformResult[];
    }[];
    success: boolean;
    requiresManualReview: boolean;
    errors: string[];
}
export interface MigrationSummary {
    totalDashboards: number;
    successfulMigrations: number;
    failedMigrations: number;
    dashboardsRequiringReview: number;
    results: DashboardMigrationResult[];
    timestamp: string;
}
export declare class DashboardMigrator {
    private grafanaClient;
    private queryTransformer;
    private config;
    private logger;
    constructor(config: AppConfig, logger: winston.Logger);
    testConnection(): Promise<boolean>;
    migrateDashboards(dryRun?: boolean): Promise<MigrationSummary>;
    private migrateDashboard;
    private migratePanel;
    private deduplicateDashboards;
    generateMigrationReport(summary: MigrationSummary): Promise<string>;
}
//# sourceMappingURL=dashboard-migrator.d.ts.map