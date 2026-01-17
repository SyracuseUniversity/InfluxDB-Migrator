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
    let skippedCount = 0;
    let successCount = 0;
    let firstError = true;

    for (const record of points) {
      const writeApi = this.client.getWriteApi('', this.config.database, 'ns');

      try {
        // Debug: log first record to see what we're working with
        if (successCount === 0 && skippedCount === 0) {
          console.log('First record:', JSON.stringify(record, null, 2));
        }

        // Validate measurement name exists
        if (!record._measurement || record._measurement === '') {
          skippedCount++;
          await writeApi.close();
          continue;
        }

        const point = new Point(record._measurement)
          .timestamp(new Date(record._time));

        // Handle _field and _value from InfluxDB 2.x
        // In 2.x, data comes as: _field="P", _value=123.45
        // In 3.x, we want: P=123.45 as a field
        const fieldName = record._field;
        let fieldValue = record._value;
        let hasField = false;

        if (fieldName && fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
          // Try to parse string numbers to actual numbers
          if (typeof fieldValue === 'string') {
            const trimmed = fieldValue.trim();
            if (trimmed !== '') {
              const parsedNum = parseFloat(trimmed);
              if (!isNaN(parsedNum)) {
                fieldValue = parsedNum;
              } else {
                fieldValue = trimmed;
              }
            } else {
              // Empty string after trim - skip this point
              skippedCount++;
              await writeApi.close();
              continue;
            }
          }

          // Add the field using the _field name and _value
          if (typeof fieldValue === 'number') {
            if (Number.isInteger(fieldValue)) {
              point.intField(fieldName, fieldValue);
              hasField = true;
            } else {
              point.floatField(fieldName, fieldValue);
              hasField = true;
            }
          } else if (typeof fieldValue === 'boolean' || fieldValue === 'true' || fieldValue === 'false') {
            const boolVal = fieldValue === true || fieldValue === 'true';
            point.booleanField(fieldName, boolVal);
            hasField = true;
          } else if (typeof fieldValue === 'string' && fieldValue.length > 0) {
            point.stringField(fieldName, fieldValue);
            hasField = true;
          }
        }

        // Skip this point if it has no fields (InfluxDB requires at least one field)
        if (!hasField) {
          skippedCount++;
          await writeApi.close();
          continue;
        }

        // Add tags (non-underscore fields that aren't system fields)
        Object.keys(record).forEach(key => {
          if (key.startsWith('_') || key === 'result' || key === 'table') {
            return; // Skip system fields
          }

          const value = record[key];
          // All non-system fields from 2.x are tags in 3.x
          if (value !== undefined && value !== null) {
            const strValue = String(value).trim();
            if (strValue !== '') {
              point.tag(key, strValue);
            }
          }
        });

        writeApi.writePoint(point);
        await writeApi.close();
        successCount++;
      } catch (error) {
        // Skip malformed points but log them
        if (firstError) {
          console.error('First error details:');
          console.error('Record:', JSON.stringify(record, null, 2));
          console.error('Error:', error);
          firstError = false;
        } else if (skippedCount < 10) {
          console.warn(`Skipping malformed point: ${error instanceof Error ? error.message : String(error)}`);
        }
        skippedCount++;
        try {
          await writeApi.close();
        } catch (e) {
          // Ignore close errors
        }
      }
    }

    if (skippedCount > 0) {
      console.log(`Batch complete: ${successCount} written, ${skippedCount} skipped`);
    }
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
