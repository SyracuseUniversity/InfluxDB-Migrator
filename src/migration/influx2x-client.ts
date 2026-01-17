import { InfluxDB, FluxTableMetaData } from '@influxdata/influxdb-client';
import { InfluxDB2Config } from '../config/types';

export class Influx2xClient {
  private client: InfluxDB;
  private config: InfluxDB2Config;

  constructor(config: InfluxDB2Config) {
    this.config = config;
    const url = `http://${config.host}:${config.port}`;
    this.client = new InfluxDB({ url, token: config.token });
  }

  async testConnection(): Promise<boolean> {
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
    } catch (error) {
      return false;
    }
  }

  async *queryData(startTime?: string, endTime?: string): AsyncGenerator<any[]> {
    const queryApi = this.client.getQueryApi(this.config.org);
    const start = startTime || '-10y';
    const end = endTime || 'now()';

    const query = `
      from(bucket: "${this.config.bucket}")
        |> range(start: ${start}, stop: ${end})
    `;

    let rows: any[] = [];
    const batches: any[][] = [];
    let queryComplete = false;
    let queryError: Error | null = null;

    // Start the query
    const queryPromise = new Promise<void>((resolve, reject) => {
      queryApi.queryRows(query, {
        next: (row: string[], tableMeta: FluxTableMetaData) => {
          const record: any = {};
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
        error: (error: Error) => {
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
    } catch (error) {
      if (queryError) throw queryError;
      throw error;
    }

    // Yield all batches
    for (const batch of batches) {
      yield batch;
    }
  }

  async getMetadata(): Promise<{
    measurements: string[];
    fieldKeys: string[];
    tagKeys: string[];
    timeRange: { earliest: string; latest: string };
  }> {
    const queryApi = this.client.getQueryApi(this.config.org);

    // Get measurements
    const measurementsQuery = `
      import "influxdata/influxdb/schema"
      schema.measurements(bucket: "${this.config.bucket}")
    `;

    const measurements: string[] = [];
    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(measurementsQuery, {
        next: (row: string[]) => {
          if (row[1]) measurements.push(row[1]);
        },
        error: (error: Error) => reject(error),
        complete: () => resolve()
      });
    });

    // Get time range - use keep() to only work with _time column to avoid schema collisions
    const timeRangeQuery = `
      from(bucket: "${this.config.bucket}")
        |> range(start: -10y)
        |> keep(columns: ["_time"])
        |> group()
        |> min(column: "_time")
    `;

    let earliest = '';
    let latest = '';

    try {
      await new Promise<void>((resolve, reject) => {
        queryApi.queryRows(timeRangeQuery, {
          next: (row: string[], tableMeta: FluxTableMetaData) => {
            const timeIndex = tableMeta.columns.findIndex(col => col.label === '_time');
            if (timeIndex >= 0 && row[timeIndex]) earliest = row[timeIndex];
          },
          error: (error: Error) => reject(error),
          complete: () => resolve()
        });
      });
    } catch (error) {
      // If time range query fails, leave empty - migration can still proceed
      console.warn('Could not determine earliest timestamp:', error);
    }

    const latestQuery = `
      from(bucket: "${this.config.bucket}")
        |> range(start: -10y)
        |> keep(columns: ["_time"])
        |> group()
        |> max(column: "_time")
    `;

    try {
      await new Promise<void>((resolve, reject) => {
        queryApi.queryRows(latestQuery, {
          next: (row: string[], tableMeta: FluxTableMetaData) => {
            const timeIndex = tableMeta.columns.findIndex(col => col.label === '_time');
            if (timeIndex >= 0 && row[timeIndex]) latest = row[timeIndex];
          },
          error: (error: Error) => reject(error),
          complete: () => resolve()
        });
      });
    } catch (error) {
      // If time range query fails, leave empty - migration can still proceed
      console.warn('Could not determine latest timestamp:', error);
    }

    return {
      measurements,
      fieldKeys: [],
      tagKeys: [],
      timeRange: { earliest, latest }
    };
  }

  async getRowCount(): Promise<number> {
    const queryApi = this.client.getQueryApi(this.config.org);
    const query = `
      from(bucket: "${this.config.bucket}")
        |> range(start: -10y)
        |> count()
    `;

    let count = 0;
    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(query, {
        next: (row: string[]) => {
          if (row[5]) count += parseInt(row[5], 10);
        },
        error: (error: Error) => reject(error),
        complete: () => resolve()
      });
    });

    return count;
  }
}
