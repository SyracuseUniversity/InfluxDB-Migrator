"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Influx2xClient = void 0;
const influxdb_client_1 = require("@influxdata/influxdb-client");
class Influx2xClient {
    constructor(config) {
        this.config = config;
        const url = `http://${config.host}:${config.port}`;
        this.client = new influxdb_client_1.InfluxDB({ url, token: config.token });
    }
    async testConnection() {
        try {
            const queryApi = this.client.getQueryApi(this.config.org);
            const query = `from(bucket: "${this.config.bucket}") |> range(start: -1m) |> limit(n: 1)`;
            await new Promise((resolve, reject) => {
                queryApi.queryRows(query, {
                    next: () => resolve(true),
                    error: (error) => reject(error),
                    complete: () => resolve(true)
                });
            });
            return true;
        }
        catch (error) {
            return false;
        }
    }
    async *queryData(startTime, endTime) {
        const queryApi = this.client.getQueryApi(this.config.org);
        const start = startTime || '-10y';
        const end = endTime || 'now()';
        const query = `
      from(bucket: "${this.config.bucket}")
        |> range(start: ${start}, stop: ${end})
    `;
        let rows = [];
        const batches = [];
        let queryComplete = false;
        let queryError = null;
        // Start the query
        const queryPromise = new Promise((resolve, reject) => {
            queryApi.queryRows(query, {
                next: (row, tableMeta) => {
                    const record = {};
                    tableMeta.columns.forEach((col, index) => {
                        record[col.label] = row[index];
                    });
                    rows.push(record);
                    // Save batch when reaching threshold
                    if (rows.length >= 1000) {
                        batches.push([...rows]);
                        rows = [];
                    }
                },
                error: (error) => {
                    queryError = error;
                    reject(error);
                },
                complete: () => {
                    if (rows.length > 0) {
                        batches.push([...rows]);
                    }
                    queryComplete = true;
                    resolve();
                }
            });
        });
        // Wait for query to complete
        try {
            await queryPromise;
        }
        catch (error) {
            if (queryError)
                throw queryError;
            throw error;
        }
        // Yield all batches
        for (const batch of batches) {
            yield batch;
        }
    }
    async getMetadata() {
        const queryApi = this.client.getQueryApi(this.config.org);
        // Get measurements
        const measurementsQuery = `
      import "influxdata/influxdb/schema"
      schema.measurements(bucket: "${this.config.bucket}")
    `;
        const measurements = [];
        await new Promise((resolve, reject) => {
            queryApi.queryRows(measurementsQuery, {
                next: (row) => {
                    if (row[1])
                        measurements.push(row[1]);
                },
                error: (error) => reject(error),
                complete: () => resolve()
            });
        });
        // Get time range
        const timeRangeQuery = `
      from(bucket: "${this.config.bucket}")
        |> range(start: -10y)
        |> group()
        |> min(column: "_time")
    `;
        let earliest = '';
        let latest = '';
        await new Promise((resolve, reject) => {
            queryApi.queryRows(timeRangeQuery, {
                next: (row, tableMeta) => {
                    const timeIndex = tableMeta.columns.findIndex(col => col.label === '_time');
                    if (timeIndex >= 0)
                        earliest = row[timeIndex];
                },
                error: (error) => reject(error),
                complete: () => resolve()
            });
        });
        const latestQuery = `
      from(bucket: "${this.config.bucket}")
        |> range(start: -10y)
        |> group()
        |> max(column: "_time")
    `;
        await new Promise((resolve, reject) => {
            queryApi.queryRows(latestQuery, {
                next: (row, tableMeta) => {
                    const timeIndex = tableMeta.columns.findIndex(col => col.label === '_time');
                    if (timeIndex >= 0)
                        latest = row[timeIndex];
                },
                error: (error) => reject(error),
                complete: () => resolve()
            });
        });
        return {
            measurements,
            fieldKeys: [],
            tagKeys: [],
            timeRange: { earliest, latest }
        };
    }
    async getRowCount() {
        const queryApi = this.client.getQueryApi(this.config.org);
        const query = `
      from(bucket: "${this.config.bucket}")
        |> range(start: -10y)
        |> count()
    `;
        let count = 0;
        await new Promise((resolve, reject) => {
            queryApi.queryRows(query, {
                next: (row) => {
                    if (row[5])
                        count += parseInt(row[5], 10);
                },
                error: (error) => reject(error),
                complete: () => resolve()
            });
        });
        return count;
    }
}
exports.Influx2xClient = Influx2xClient;
//# sourceMappingURL=influx2x-client.js.map