import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { InfluxDB3Config } from '../config/types';
import axios from 'axios';
import http from 'http';

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
    // Escape special characters in tag values for line protocol
    // Escape commas, equals, and spaces with backslash
    return value.replace(/[,= ]/g, '\\$&');
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
      // Show hex codes for debugging
      const hexChars = line.split('').map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
      console.log(`Hex: ${hexChars.substring(0, 200)}...`);
    });
    console.log(`=== END DEBUG (${lines.length} total lines) ===\n`);

    // Write using native HTTP API (not axios) for exact control
    const body = lines.join('\n');
    const path = `/api/v2/write?bucket=${this.config.database}&precision=ns`;

    const result = await new Promise<{ success: boolean; error?: string }>((resolve) => {
      const req = http.request({
        hostname: this.config.host,
        port: this.config.port,
        path: path,
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          ...(this.config.token ? { 'Authorization': `Bearer ${this.config.token}` } : {})
        }
      }, (res) => {
        let responseData = '';
        res.on('data', chunk => { responseData += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 204) {
            resolve({ success: true });
          } else {
            resolve({ success: false, error: `${res.statusCode}: ${responseData}` });
          }
        });
      });

      req.on('error', (e) => {
        resolve({ success: false, error: e.message });
      });

      req.write(body);
      req.end();
    });

    if (result.success) {
      if (skippedCount > 0) {
        console.log(`Batch complete: ${lines.length} written, ${skippedCount} skipped`);
      }
    } else {
      console.error('HTTP Error:', result.error);

      // Try writing lines individually to find the problematic one
      console.log('Batch write failed. Attempting individual writes to isolate bad lines...');
      let successCount = 0;
      let failCount = 0;

      for (let i = 0; i < lines.length; i++) {
        const lineBody = lines[i];
        const lineResult = await new Promise<boolean>((resolve) => {
          const req = http.request({
            hostname: this.config.host,
            port: this.config.port,
            path: path,
            method: 'POST',
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Length': Buffer.byteLength(lineBody),
              ...(this.config.token ? { 'Authorization': `Bearer ${this.config.token}` } : {})
            }
          }, (res) => {
            let responseData = '';
            res.on('data', chunk => { responseData += chunk; });
            res.on('end', () => {
              if (res.statusCode === 200 || res.statusCode === 204) {
                resolve(true);
              } else {
                if (failCount < 5) {
                  console.error(`Failed line ${i + 1}: ${lines[i]}`);
                  console.error(`Error: ${responseData}`);
                }
                resolve(false);
              }
            });
          });

          req.on('error', () => resolve(false));
          req.write(lineBody);
          req.end();
        });

        if (lineResult) {
          successCount++;
        } else {
          failCount++;
        }
      }

      console.log(`Individual write results: ${successCount} succeeded, ${failCount} failed`);

      if (successCount === 0) {
        throw new Error(`Write failed: All ${lines.length} lines failed to write`);
      }

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
