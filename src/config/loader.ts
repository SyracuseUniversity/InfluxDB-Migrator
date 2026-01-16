import { AppConfig, InfluxDB2Config, InfluxDB3Config, GrafanaConfig, MigrationConfig } from './types';

export class ConfigLoader {
  static loadFromEnv(): Partial<AppConfig> {
    const config: Partial<AppConfig> = {};

    // Source InfluxDB 2.x configuration
    if (process.env.INFLUX_2X_HOST) {
      config.source = {
        host: process.env.INFLUX_2X_HOST,
        port: parseInt(process.env.INFLUX_2X_PORT || '8086', 10),
        token: process.env.INFLUX_2X_TOKEN || '',
        org: process.env.INFLUX_2X_ORG || '',
        bucket: process.env.INFLUX_2X_BUCKET || ''
      };
    }

    // Destination InfluxDB 3.x configuration
    if (process.env.INFLUX_3X_HOST) {
      config.destination = {
        host: process.env.INFLUX_3X_HOST,
        port: parseInt(process.env.INFLUX_3X_PORT || '8086', 10),
        token: process.env.INFLUX_3X_TOKEN || '',
        database: process.env.INFLUX_3X_DATABASE || ''
      };
    }

    // Grafana configuration
    if (process.env.GRAFANA_URL) {
      config.grafana = {
        url: process.env.GRAFANA_URL,
        token: process.env.GRAFANA_TOKEN || '',
        influx2xDatasource: process.env.GRAFANA_INFLUX2X_DATASOURCE || '',
        influx3xDatasource: process.env.GRAFANA_INFLUX3X_DATASOURCE || ''
      };
    }

    // Migration configuration
    config.migration = {
      batchSize: parseInt(process.env.MIGRATION_BATCH_SIZE || '10000', 10),
      checkpointInterval: parseInt(process.env.MIGRATION_CHECKPOINT_INTERVAL || '100000', 10),
      checkpointPath: process.env.MIGRATION_CHECKPOINT_PATH || './checkpoints',
      verify: process.env.MIGRATION_VERIFY !== 'false'
    };

    return config;
  }

  static buildFromFlags(flags: any): Partial<AppConfig> {
    const config: Partial<AppConfig> = {};

    // Source configuration from flags
    if (flags.sourceHost) {
      config.source = {
        host: flags.sourceHost,
        port: flags.sourcePort || 8086,
        token: flags.sourceToken || '',
        org: flags.sourceOrg || '',
        bucket: flags.sourceBucket || ''
      };
    }

    // Destination configuration from flags
    if (flags.destHost) {
      config.destination = {
        host: flags.destHost,
        port: flags.destPort || 8086,
        token: flags.destToken || '',
        database: flags.destDatabase || ''
      };
    }

    // Grafana configuration from flags
    if (flags.grafanaUrl) {
      config.grafana = {
        url: flags.grafanaUrl,
        token: flags.grafanaToken || '',
        influx2xDatasource: flags.influx2xDatasource || '',
        influx3xDatasource: flags.influx3xDatasource || ''
      };
    }

    // Migration configuration from flags
    if (flags.batchSize || flags.checkpointInterval) {
      config.migration = {
        batchSize: flags.batchSize || 10000,
        checkpointInterval: flags.checkpointInterval || 100000,
        checkpointPath: flags.checkpointPath || './checkpoints',
        verify: flags.verify !== false
      };
    }

    return config;
  }

  static merge(...configs: Partial<AppConfig>[]): AppConfig {
    const merged: any = {
      migration: {
        batchSize: 10000,
        checkpointInterval: 100000,
        checkpointPath: './checkpoints',
        verify: true
      }
    };

    for (const config of configs) {
      if (config.source) merged.source = { ...merged.source, ...config.source };
      if (config.destination) merged.destination = { ...merged.destination, ...config.destination };
      if (config.grafana) merged.grafana = { ...merged.grafana, ...config.grafana };
      if (config.migration) merged.migration = { ...merged.migration, ...config.migration };
    }

    return merged as AppConfig;
  }

  static validate(config: AppConfig): string[] {
    const errors: string[] = [];

    if (!config.source) {
      errors.push('Source InfluxDB 2.x configuration is required');
    } else {
      if (!config.source.host) errors.push('Source host is required');
      if (!config.source.token) errors.push('Source token is required');
      if (!config.source.org) errors.push('Source organization is required');
      if (!config.source.bucket) errors.push('Source bucket is required');
    }

    if (!config.destination) {
      errors.push('Destination InfluxDB 3.x configuration is required');
    } else {
      if (!config.destination.host) errors.push('Destination host is required');
      if (!config.destination.token) errors.push('Destination token is required');
      if (!config.destination.database) errors.push('Destination database is required');
    }

    return errors;
  }
}
