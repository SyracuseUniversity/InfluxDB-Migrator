import { InfluxDB2Config } from '../config/types';
export declare class Influx2xClient {
    private client;
    private config;
    constructor(config: InfluxDB2Config);
    testConnection(): Promise<boolean>;
    queryData(startTime?: string, endTime?: string): AsyncGenerator<any[]>;
    getMetadata(): Promise<{
        measurements: string[];
        fieldKeys: string[];
        tagKeys: string[];
        timeRange: {
            earliest: string;
            latest: string;
        };
    }>;
    getRowCount(): Promise<number>;
}
//# sourceMappingURL=influx2x-client.d.ts.map