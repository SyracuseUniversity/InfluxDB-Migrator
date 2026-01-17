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

      // Handle _field and _value from InfluxDB 2.x
      // In 2.x, data comes as: _field="P", _value=123.45
      // In 3.x, we want: P=123.45 as a field
      const fieldName = record._field;
      const fieldValue = record._value;

      if (fieldName && fieldValue !== undefined && fieldValue !== null) {
        // Add the field using the _field name and _value
        if (typeof fieldValue === 'number') {
          if (Number.isInteger(fieldValue)) {
            point.intField(fieldName, fieldValue);
          } else {
            point.floatField(fieldName, fieldValue);
          }
        } else if (typeof fieldValue === 'boolean') {
          point.booleanField(fieldName, fieldValue);
        } else if (typeof fieldValue === 'string') {
          point.stringField(fieldName, fieldValue);
        }
      }

      // Add tags (non-underscore fields that aren't system fields)
      Object.keys(record).forEach(key => {
        if (key.startsWith('_') || key === 'result' || key === 'table') {
          return; // Skip system fields
        }

        const value = record[key];
        // All non-system fields from 2.x are tags in 3.x
        if (typeof value === 'string') {
          point.tag(key, value);
        } else if (typeof value === 'number') {
          // Convert numeric tags to strings
          point.tag(key, value.toString());
        } else if (typeof value === 'boolean') {
          point.tag(key, value.toString());
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
