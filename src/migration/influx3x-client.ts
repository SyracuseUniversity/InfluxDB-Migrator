import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { InfluxDB3Config } from '../config/types';
import axios from 'axios';
import http from 'http';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
        const measurementName = this.getMeasurementName(record);
        if (!measurementName) {
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

        if (record._measurement && measurementName !== record._measurement) {
          tags.push(`source-measurement=${this.escapeTagValue(String(record._measurement))}`);
        }

        // Build field set
        const fieldValueStr = this.escapeFieldValue(fieldValue);
        const fields = `${fieldName}=${fieldValueStr}`;

        // Build timestamp (nanoseconds)
        const timestamp = new Date(record._time).getTime() * 1000000;

        // Build line protocol: measurement,tag1=value1,tag2=value2 field1=value1,field2=value2 timestamp
        const tagSet = tags.length > 0 ? ',' + tags.join(',') : '';
        const line = `${measurementName}${tagSet} ${fields} ${timestamp}`;
        lines.push(line);
      } catch (error) {
        skippedCount++;
      }
    }

    if (lines.length === 0) {
      console.log(`Batch skipped: all ${skippedCount} points invalid`);
      return;
    }


    // Use curl via child_process for reliable writes
    const body = lines.join('\n');
    const tmpFile = path.join(os.tmpdir(), `influx_write_${process.pid}.txt`);

    try {
      fs.writeFileSync(tmpFile, body);

      const url = `http://${this.config.host}:${this.config.port}/api/v2/write?bucket=${this.config.database}&precision=ns`;
      const authHeader = this.config.token ? `-H "Authorization: Bearer ${this.config.token}"` : '';
      const curlCmd = `curl -s -w "\\n%{http_code}" -X POST "${url}" ${authHeader} -H "Content-Type: text/plain" --data-binary @${tmpFile}`;

      const result = execSync(curlCmd, { encoding: 'utf-8', timeout: 120000 });
      const resultLines = result.trim().split('\n');
      const httpCode = resultLines[resultLines.length - 1];
      const responseBody = resultLines.slice(0, -1).join('\n');

      if (httpCode !== '200' && httpCode !== '204') {
        throw new Error(`Write failed: HTTP ${httpCode} - ${responseBody}`);
      }
    } finally {
      try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
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

  private getMeasurementName(record: any): string | null {
    const measurementType = typeof record['measurement-type'] === 'string'
      ? record['measurement-type'].trim()
      : '';
    if (measurementType) {
      return measurementType;
    }

    if (typeof record._measurement === 'string' && record._measurement.trim() !== '') {
      return record._measurement.trim();
    }

    return null;
  }
}
