export interface InfluxDB2Config {
    host: string;
    port: number;
    token: string;
    org: string;
    bucket: string;
}
export interface InfluxDB3Config {
    host: string;
    port: number;
    token: string;
    database: string;
}
export interface GrafanaConfig {
    url: string;
    token: string;
    influx2xDatasource: string;
    influx3xDatasource: string;
}
export interface MigrationConfig {
    batchSize: number;
    checkpointInterval: number;
    checkpointPath: string;
    verify: boolean;
}
export interface AppConfig {
    source: InfluxDB2Config;
    destination: InfluxDB3Config;
    grafana?: GrafanaConfig;
    migration: MigrationConfig;
}
//# sourceMappingURL=types.d.ts.map