import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { InfluxDB3Config } from '../config/types';

export class Influx3xClient {
  private client: InfluxDB;
  private config: InfluxDB3Config;

  constructor(config: InfluxDB3Config) {
    this.config = config;
    const url = `http://${config.host}:${config.port}`;
    this.client = new InfluxDB({ url, token: config.token });
  }

  async testConnection(): Promise<boolean> {
    try {
      const writeApi = this.client.getWriteApi('', this.config.database);
      // Test with a simple ping
      await writeApi.close();
      return true;
    } catch (error) {
      return false;
    }
  }

  async writeBatch(points: any[]): Promise<void> {
    const writeApi = this.client.getWriteApi('', this.config.database, 'ns');

    for (const record of points) {
      const point = new Point(record._measurement)
        .timestamp(new Date(record._time));

      // Add fields
      Object.keys(record).forEach(key => {
        if (key.startsWith('_') || key === 'result' || key === 'table') {
          return; // Skip system fields
        }

        const value = record[key];
        if (typeof value === 'number') {
          if (Number.isInteger(value)) {
            point.intField(key, value);
          } else {
            point.floatField(key, value);
          }
        } else if (typeof value === 'boolean') {
          point.booleanField(key, value);
        } else if (typeof value === 'string') {
          // Check if it's a tag or field
          if (key.startsWith('tag_')) {
            point.tag(key.replace('tag_', ''), value);
          } else {
            point.stringField(key, value);
          }
        }
      });

      writeApi.writePoint(point);
    }

    await writeApi.close();
  }

  async getRowCount(): Promise<number> {
    // For InfluxDB 3.x, we would use SQL query
    // This is a placeholder - actual implementation depends on 3.x API
    const queryApi = this.client.getQueryApi('');
    const query = `SELECT COUNT(*) FROM "${this.config.database}"`;

    let count = 0;
    await new Promise<void>((resolve, reject) => {
      queryApi.queryRows(query, {
        next: (row: string[]) => {
          if (row[0]) count = parseInt(row[0], 10);
        },
        error: (error: Error) => reject(error),
        complete: () => resolve()
      });
    });

    return count;
  }

  async getTimeRange(): Promise<{ earliest: string; latest: string }> {
    // Placeholder for 3.x time range query
    // Actual implementation depends on InfluxDB 3.x SQL dialect
    return {
      earliest: '',
      latest: ''
    };
  }
}
