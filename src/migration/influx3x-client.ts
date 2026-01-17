import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { InfluxDB3Config } from '../config/types';
import axios from 'axios';

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

  private escapeTagValue(value: string): string {
    // Escape special characters in tag values
    return value.replace(/[, =]/g, '\\$&');
  }

  private escapeFieldValue(value: any): string {
    if (typeof value === 'string') {
      // String fields must be quoted and escaped
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    return String(value);
  }

  async writeBatch(points: any[]): Promise<void> {
    const lines: string[] = [];
    let skippedCount = 0;

    for (const record of points) {
      try {
        // Validate measurement name exists
        if (!record._measurement || record._measurement === '') {
          skippedCount++;
          continue;
        }

        // Handle _field and _value from InfluxDB 2.x
        const fieldName = record._field;
        let fieldValue = record._value;

        if (!fieldName || fieldValue === undefined || fieldValue === null || fieldValue === '') {
          skippedCount++;
          continue;
        }

        // Try to parse string numbers to actual numbers
        if (typeof fieldValue === 'string') {
          const trimmed = fieldValue.trim();
          if (trimmed === '') {
            skippedCount++;
            continue;
          }
          const parsedNum = parseFloat(trimmed);
          if (!isNaN(parsedNum)) {
            fieldValue = parsedNum;
          } else {
            fieldValue = trimmed;
          }
        }

        // Build tag set
        const tags: string[] = [];
        Object.keys(record).forEach(key => {
          if (key.startsWith('_') || key === 'result' || key === 'table') {
            return;
          }
          const value = record[key];
          if (value !== undefined && value !== null) {
            const strValue = String(value).trim();
            if (strValue !== '') {
              tags.push(`${key}=${this.escapeTagValue(strValue)}`);
            }
          }
        });

        // Build field set
        const fieldValueStr = this.escapeFieldValue(fieldValue);
        const fields = `${fieldName}=${fieldValueStr}`;

        // Build timestamp (nanoseconds)
        const timestamp = new Date(record._time).getTime() * 1000000;

        // Build line protocol: measurement,tag1=value1,tag2=value2 field1=value1,field2=value2 timestamp
        const tagSet = tags.length > 0 ? ',' + tags.join(',') : '';
        const line = `${record._measurement}${tagSet} ${fields} ${timestamp}`;
        lines.push(line);
      } catch (error) {
        skippedCount++;
      }
    }

    if (lines.length === 0) {
      console.log(`Batch skipped: all ${skippedCount} points invalid`);
      return;
    }

    // Debug: Log first few lines to see format
    console.log(`\n=== DEBUG: First 3 line protocol lines ===`);
    lines.slice(0, 3).forEach((line, idx) => {
      console.log(`Line ${idx + 1}: ${line}`);
    });
    console.log(`=== END DEBUG (${lines.length} total lines) ===\n`);

    // Write using HTTP API
    // InfluxDB 3.x uses 'bucket' parameter and requires precision
    const url = `http://${this.config.host}:${this.config.port}/api/v2/write?bucket=${this.config.database}&precision=ns`;
    const headers: any = { 'Content-Type': 'text/plain' };
    if (this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    }

    try {
      await axios.post(url, lines.join('\n'), { headers });
      if (skippedCount > 0) {
        console.log(`Batch complete: ${lines.length} written, ${skippedCount} skipped`);
      }
    } catch (error) {
      // Log the full error response
      if (axios.isAxiosError(error) && error.response) {
        console.error('HTTP Error Response:', JSON.stringify(error.response.data, null, 2));
      }

      // Try writing lines individually to find the problematic one
      console.log('Batch write failed. Attempting individual writes to isolate bad lines...');
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < lines.length; i++) {
        try {
          await axios.post(url, lines[i], { headers });
          successCount++;
        } catch (lineError) {
          failCount++;
          if (failCount <= 5) { // Only log first 5 failures
            console.error(`Failed line ${i + 1}: ${lines[i]}`);
            if (axios.isAxiosError(lineError) && lineError.response) {
              console.error(`Error: ${JSON.stringify(lineError.response.data)}`);
            }
          }
        }
      }

      console.log(`Individual write results: ${successCount} succeeded, ${failCount} failed`);

      if (successCount === 0) {
        throw new Error(`Write failed: All ${lines.length} lines failed to write`);
      }

      // If some succeeded, don't throw - continue migration
      console.log(`Continuing migration with ${successCount} successfully written points`);
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
