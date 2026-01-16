import { AppConfig } from '../config/types';
import winston from 'winston';
export interface VerificationResult {
    passed: boolean;
    checks: {
        recordCount: {
            passed: boolean;
            source: number;
            destination: number;
            difference: number;
            percentDifference: number;
        };
        timeRange: {
            passed: boolean;
            source: {
                earliest: string;
                latest: string;
            };
            destination: {
                earliest: string;
                latest: string;
            };
            message: string;
        };
    };
    warnings: string[];
    errors: string[];
    timestamp: string;
}
export declare class Verifier {
    private sourceClient;
    private destClient;
    private config;
    private logger;
    constructor(config: AppConfig, logger: winston.Logger);
    verify(): Promise<VerificationResult>;
    private verifyRecordCount;
    private verifyTimeRange;
    testConnections(): Promise<{
        source: boolean;
        destination: boolean;
    }>;
}
//# sourceMappingURL=verifier.d.ts.map