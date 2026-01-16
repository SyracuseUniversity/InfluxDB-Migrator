import { GrafanaClient, DashboardDetail, Panel, QueryTarget } from './grafana-client';
import { QueryTransformer, TransformResult } from './query-transformer';
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

export class DashboardMigrator {
  private grafanaClient: GrafanaClient;
  private queryTransformer: QueryTransformer;
  private config: AppConfig;
  private logger: winston.Logger;

  constructor(config: AppConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;

    if (!config.grafana) {
      throw new Error('Grafana configuration is required for dashboard migration');
    }

    this.grafanaClient = new GrafanaClient(config.grafana, logger);
    this.queryTransformer = new QueryTransformer(logger);
  }

  async testConnection(): Promise<boolean> {
    return await this.grafanaClient.testConnection();
  }

  async migrateDashboards(dryRun: boolean = false): Promise<MigrationSummary> {
    this.logger.info('Starting dashboard migration', {
      component: 'dashboard-migrator',
      dryRun
    });

    const summary: MigrationSummary = {
      totalDashboards: 0,
      successfulMigrations: 0,
      failedMigrations: 0,
      dashboardsRequiringReview: 0,
      results: [],
      timestamp: new Date().toISOString()
    };

    try {
      // Find InfluxDB 2.x datasources
      const influx2xDatasources = await this.grafanaClient.findInflux2xDatasources();

      if (influx2xDatasources.length === 0) {
        this.logger.warn('No InfluxDB 2.x datasources found', {
          component: 'dashboard-migrator'
        });
        return summary;
      }

      this.logger.info('Found InfluxDB 2.x datasources', {
        component: 'dashboard-migrator',
        count: influx2xDatasources.length,
        datasources: influx2xDatasources.map(ds => ({ uid: ds.uid, name: ds.name }))
      });

      // Find dashboards using these datasources
      const allDashboards: DashboardDetail[] = [];
      for (const datasource of influx2xDatasources) {
        const dashboards = await this.grafanaClient.findDashboardsUsingDatasource(datasource.uid);
        allDashboards.push(...dashboards);
      }

      // Remove duplicates
      const uniqueDashboards = this.deduplicateDashboards(allDashboards);
      summary.totalDashboards = uniqueDashboards.length;

      this.logger.info('Found dashboards to migrate', {
        component: 'dashboard-migrator',
        count: uniqueDashboards.length
      });

      // Migrate each dashboard
      for (const dashboard of uniqueDashboards) {
        const result = await this.migrateDashboard(dashboard, dryRun);
        summary.results.push(result);

        if (result.success) {
          summary.successfulMigrations++;
        } else {
          summary.failedMigrations++;
        }

        if (result.requiresManualReview) {
          summary.dashboardsRequiringReview++;
        }
      }

      this.logger.info('Dashboard migration completed', {
        component: 'dashboard-migrator',
        total: summary.totalDashboards,
        successful: summary.successfulMigrations,
        failed: summary.failedMigrations,
        requiresReview: summary.dashboardsRequiringReview
      });

    } catch (error) {
      this.logger.error('Dashboard migration failed', {
        component: 'dashboard-migrator',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }

    return summary;
  }

  private async migrateDashboard(
    originalDashboard: DashboardDetail,
    dryRun: boolean
  ): Promise<DashboardMigrationResult> {
    this.logger.info('Migrating dashboard', {
      component: 'dashboard-migrator',
      uid: originalDashboard.dashboard.uid,
      title: originalDashboard.dashboard.title,
      dryRun
    });

    const result: DashboardMigrationResult = {
      originalDashboard,
      transformations: [],
      success: false,
      requiresManualReview: false,
      errors: []
    };

    try {
      // Clone the dashboard
      const newDashboard = JSON.parse(JSON.stringify(originalDashboard.dashboard));

      // Remove id and uid to create new dashboard
      delete newDashboard.id;
      newDashboard.uid = null;
      newDashboard.title = `${newDashboard.title} (InfluxDB 3.x)`;

      // Process each panel
      if (newDashboard.panels) {
        for (const panel of newDashboard.panels) {
          const panelResult = await this.migratePanel(panel);

          if (panelResult) {
            result.transformations.push(panelResult);

            // Check if any transformation requires manual review
            if (panelResult.queries.some(q => q.requiresManualReview)) {
              result.requiresManualReview = true;
            }
          }
        }
      }

      // Create the new dashboard if not dry run
      if (!dryRun && this.config.grafana) {
        try {
          const created = await this.grafanaClient.createDashboard(
            newDashboard,
            originalDashboard.meta.folderId,
            false
          );
          result.newDashboard = created;
          result.success = true;

          this.logger.info('Dashboard created', {
            component: 'dashboard-migrator',
            originalUid: originalDashboard.dashboard.uid,
            newUid: created.dashboard.uid,
            title: created.dashboard.title
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          result.errors.push(`Failed to create dashboard: ${errorMessage}`);
          this.logger.error('Failed to create dashboard', {
            component: 'dashboard-migrator',
            error: errorMessage
          });
        }
      } else {
        result.success = true; // Dry run is successful if no errors
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.errors.push(`Migration error: ${errorMessage}`);
      this.logger.error('Dashboard migration error', {
        component: 'dashboard-migrator',
        uid: originalDashboard.dashboard.uid,
        error: errorMessage
      });
    }

    return result;
  }

  private async migratePanel(panel: Panel): Promise<{
    panelId: number;
    panelTitle: string;
    queries: TransformResult[];
  } | null> {
    if (!panel.targets || panel.targets.length === 0) {
      return null;
    }

    const queries: TransformResult[] = [];

    for (const target of panel.targets) {
      // Update datasource to InfluxDB 3.x
      if (target.datasource && this.config.grafana) {
        target.datasource.uid = this.config.grafana.influx3xDatasource;
      }

      // Transform query if it exists
      if (target.query) {
        const transformed = this.queryTransformer.transform(target.query);
        queries.push(transformed);

        // Update the target with transformed query
        target.query = transformed.transformed;
      }
    }

    // Update panel datasource
    if (panel.datasource && this.config.grafana) {
      panel.datasource.uid = this.config.grafana.influx3xDatasource;
    }

    return {
      panelId: panel.id,
      panelTitle: panel.title,
      queries
    };
  }

  private deduplicateDashboards(dashboards: DashboardDetail[]): DashboardDetail[] {
    const seen = new Set<string>();
    return dashboards.filter(dashboard => {
      const uid = dashboard.dashboard.uid;
      if (seen.has(uid)) {
        return false;
      }
      seen.add(uid);
      return true;
    });
  }

  async generateMigrationReport(summary: MigrationSummary): Promise<string> {
    const lines: string[] = [];

    lines.push('='.repeat(80));
    lines.push('GRAFANA DASHBOARD MIGRATION REPORT');
    lines.push('='.repeat(80));
    lines.push('');
    lines.push(`Timestamp: ${summary.timestamp}`);
    lines.push(`Total Dashboards: ${summary.totalDashboards}`);
    lines.push(`Successful Migrations: ${summary.successfulMigrations}`);
    lines.push(`Failed Migrations: ${summary.failedMigrations}`);
    lines.push(`Require Manual Review: ${summary.dashboardsRequiringReview}`);
    lines.push('');

    for (const result of summary.results) {
      lines.push('-'.repeat(80));
      lines.push(`Dashboard: ${result.originalDashboard.dashboard.title}`);
      lines.push(`UID: ${result.originalDashboard.dashboard.uid}`);
      lines.push(`Status: ${result.success ? 'SUCCESS' : 'FAILED'}`);

      if (result.requiresManualReview) {
        lines.push(`⚠️  REQUIRES MANUAL REVIEW`);
      }

      if (result.newDashboard) {
        lines.push(`New Dashboard UID: ${result.newDashboard.dashboard.uid}`);
      }

      if (result.errors.length > 0) {
        lines.push('');
        lines.push('Errors:');
        result.errors.forEach(error => lines.push(`  - ${error}`));
      }

      if (result.transformations.length > 0) {
        lines.push('');
        lines.push('Query Transformations:');

        for (const transformation of result.transformations) {
          lines.push(`  Panel: ${transformation.panelTitle} (ID: ${transformation.panelId})`);

          for (const query of transformation.queries) {
            lines.push(`    Confidence: ${query.confidence.toUpperCase()}`);

            if (query.warnings.length > 0) {
              lines.push('    Warnings:');
              query.warnings.forEach(warn => lines.push(`      - ${warn}`));
            }

            if (query.requiresManualReview) {
              lines.push('    ⚠️  Requires manual review');
            }
          }
        }
      }

      lines.push('');
    }

    lines.push('='.repeat(80));

    return lines.join('\n');
  }
}
