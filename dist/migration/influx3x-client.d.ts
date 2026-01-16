import { InfluxDB3Config } from '../config/types';
export declare class Influx3xClient {
    private client;
    private config;
    constructor(config: InfluxDB3Config);
    testConnection(): Promise<boolean>;
    writeBatch(points: any[]): Promise<void>;
    getRowCount(): Promise<number>;
    getTimeRange(): Promise<{
        earliest: string;
        latest: string;
    }>;
}
//# sourceMappingURL=influx3x-client.d.ts.map