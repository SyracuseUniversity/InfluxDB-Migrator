"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Verifier = void 0;
const influx2x_client_1 = require("./influx2x-client");
const influx3x_client_1 = require("./influx3x-client");
class Verifier {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.sourceClient = new influx2x_client_1.Influx2xClient(config.source);
        this.destClient = new influx3x_client_1.Influx3xClient(config.destination);
    }
    async verify() {
        this.logger.info('Starting verification', { component: 'verifier' });
        const result = {
            passed: true,
            checks: {
                recordCount: {
                    passed: false,
                    source: 0,
                    destination: 0,
                    difference: 0,
                    percentDifference: 0
                },
                timeRange: {
                    passed: false,
                    source: { earliest: '', latest: '' },
                    destination: { earliest: '', latest: '' },
                    message: ''
                }
            },
            warnings: [],
            errors: [],
            timestamp: new Date().toISOString()
        };
        try {
            // Check 1: Record count comparison
            await this.verifyRecordCount(result);
            // Check 2: Time range comparison
            await this.verifyTimeRange(result);
            // Determine overall pass/fail
            result.passed = result.checks.recordCount.passed &&
                result.checks.timeRange.passed &&
                result.errors.length === 0;
            this.logger.info('Verification completed', {
                component: 'verifier',
                passed: result.passed,
                warnings: result.warnings.length,
                errors: result.errors.length
            });
        }
        catch (error) {
            result.passed = false;
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.errors.push(`Verification failed: ${errorMessage}`);
            this.logger.error('Verification error', {
                component: 'verifier',
                error: errorMessage
            });
        }
        return result;
    }
    async verifyRecordCount(result) {
        this.logger.info('Verifying record counts', { component: 'verifier' });
        try {
            const [sourceCount, destCount] = await Promise.all([
                this.sourceClient.getRowCount(),
                this.destClient.getRowCount()
            ]);
            result.checks.recordCount.source = sourceCount;
            result.checks.recordCount.destination = destCount;
            result.checks.recordCount.difference = Math.abs(sourceCount - destCount);
            if (sourceCount > 0) {
                result.checks.recordCount.percentDifference =
                    (result.checks.recordCount.difference / sourceCount) * 100;
            }
            // Consider pass if within 0.1% tolerance (accounting for potential timing differences)
            const tolerance = 0.1;
            result.checks.recordCount.passed =
                result.checks.recordCount.percentDifference <= tolerance;
            if (!result.checks.recordCount.passed) {
                const message = `Record count mismatch: Source=${sourceCount}, Destination=${destCount}, Difference=${result.checks.recordCount.difference} (${result.checks.recordCount.percentDifference.toFixed(2)}%)`;
                if (result.checks.recordCount.percentDifference < 1) {
                    result.warnings.push(message);
                }
                else {
                    result.errors.push(message);
                }
            }
            this.logger.info('Record count check', {
                component: 'verifier',
                passed: result.checks.recordCount.passed,
                source: sourceCount,
                destination: destCount,
                difference: result.checks.recordCount.difference
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.errors.push(`Record count verification failed: ${errorMessage}`);
            this.logger.error('Record count check failed', {
                component: 'verifier',
                error: errorMessage
            });
        }
    }
    async verifyTimeRange(result) {
        this.logger.info('Verifying time ranges', { component: 'verifier' });
        try {
            const [sourceMetadata, destTimeRange] = await Promise.all([
                this.sourceClient.getMetadata(),
                this.destClient.getTimeRange()
            ]);
            result.checks.timeRange.source = sourceMetadata.timeRange;
            result.checks.timeRange.destination = destTimeRange;
            // Check if destination has data
            if (!destTimeRange.earliest || !destTimeRange.latest) {
                result.checks.timeRange.passed = false;
                result.checks.timeRange.message = 'Destination time range is empty';
                result.errors.push('Destination database appears to be empty or time range query failed');
                this.logger.warn('Time range check: destination empty', {
                    component: 'verifier'
                });
                return;
            }
            // Check if source has data
            if (!sourceMetadata.timeRange.earliest || !sourceMetadata.timeRange.latest) {
                result.checks.timeRange.passed = true;
                result.checks.timeRange.message = 'Source is empty, destination matches';
                result.warnings.push('Source database appears to be empty');
                this.logger.warn('Time range check: source empty', {
                    component: 'verifier'
                });
                return;
            }
            // Compare time ranges (within reasonable tolerance for migration timing)
            const sourceEarliest = new Date(sourceMetadata.timeRange.earliest).getTime();
            const sourceLatest = new Date(sourceMetadata.timeRange.latest).getTime();
            const destEarliest = new Date(destTimeRange.earliest).getTime();
            const destLatest = new Date(destTimeRange.latest).getTime();
            const earliestDiff = Math.abs(sourceEarliest - destEarliest);
            const latestDiff = Math.abs(sourceLatest - destLatest);
            // Allow 1 second tolerance for timing differences
            const toleranceMs = 1000;
            const earliestMatch = earliestDiff <= toleranceMs;
            const latestMatch = latestDiff <= toleranceMs;
            result.checks.timeRange.passed = earliestMatch && latestMatch;
            if (!result.checks.timeRange.passed) {
                const messages = [];
                if (!earliestMatch) {
                    messages.push(`Earliest timestamp mismatch (diff: ${earliestDiff}ms)`);
                }
                if (!latestMatch) {
                    messages.push(`Latest timestamp mismatch (diff: ${latestDiff}ms)`);
                }
                result.checks.timeRange.message = messages.join('; ');
                result.warnings.push(`Time range differences detected: ${result.checks.timeRange.message}`);
            }
            else {
                result.checks.timeRange.message = 'Time ranges match';
            }
            this.logger.info('Time range check', {
                component: 'verifier',
                passed: result.checks.timeRange.passed,
                sourceEarliest: sourceMetadata.timeRange.earliest,
                sourceLatest: sourceMetadata.timeRange.latest,
                destEarliest: destTimeRange.earliest,
                destLatest: destTimeRange.latest
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            result.errors.push(`Time range verification failed: ${errorMessage}`);
            this.logger.error('Time range check failed', {
                component: 'verifier',
                error: errorMessage
            });
        }
    }
    async testConnections() {
        this.logger.info('Testing connections for verification', { component: 'verifier' });
        const [sourceOk, destOk] = await Promise.all([
            this.sourceClient.testConnection(),
            this.destClient.testConnection()
        ]);
        this.logger.info('Connection test results', {
            component: 'verifier',
            source: sourceOk ? 'connected' : 'failed',
            destination: destOk ? 'connected' : 'failed'
        });
        return { source: sourceOk, destination: destOk };
    }
}
exports.Verifier = Verifier;
//# sourceMappingURL=verifier.js.map