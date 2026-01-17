import winston from 'winston';

export interface TransformResult {
  original: string;
  transformed: string;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  requiresManualReview: boolean;
}

export class QueryTransformer {
  private logger: winston.Logger;

  constructor(logger: winston.Logger) {
    this.logger = logger;
  }

  transform(fluxQuery: string): TransformResult {
    const result: TransformResult = {
      original: fluxQuery,
      transformed: '',
      confidence: 'low',
      warnings: [],
      requiresManualReview: true
    };

    try {
      this.logger.info('Transforming Flux query', {
        component: 'query-transformer',
        queryLength: fluxQuery.length
      });

      // Clean up the query
      const cleanQuery = fluxQuery.trim();

      // Parse basic Flux query structure
      const parsed = this.parseFluxQuery(cleanQuery);

      if (!parsed) {
        result.warnings.push('Unable to parse Flux query structure');
        result.transformed = '-- MANUAL REVIEW REQUIRED\n-- Original Flux query:\n-- ' +
          cleanQuery.split('\n').join('\n-- ');
        return result;
      }

      // Attempt transformation based on parsed structure
      const sqlQuery = this.buildSQLQuery(parsed, result);

      result.transformed = sqlQuery;

      // Determine confidence level
      if (result.warnings.length === 0 && parsed.isSimple) {
        result.confidence = 'high';
        result.requiresManualReview = false;
      } else if (result.warnings.length <= 2 && parsed.isSimple) {
        result.confidence = 'medium';
        result.requiresManualReview = true;
      } else {
        result.confidence = 'low';
        result.requiresManualReview = true;
      }

      this.logger.info('Query transformation completed', {
        component: 'query-transformer',
        confidence: result.confidence,
        warnings: result.warnings.length,
        requiresReview: result.requiresManualReview
      });

    } catch (error) {
      result.warnings.push(`Transformation error: ${error instanceof Error ? error.message : String(error)}`);
      result.transformed = '-- ERROR DURING TRANSFORMATION\n-- Original Flux query:\n-- ' +
        fluxQuery.split('\n').join('\n-- ');

      this.logger.error('Query transformation failed', {
        component: 'query-transformer',
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return result;
  }

  private parseFluxQuery(query: string): ParsedFluxQuery | null {
    const parsed: ParsedFluxQuery = {
      bucket: '',
      measurement: '',
      timeRange: { start: '', stop: '' },
      filters: [],
      fields: [],
      aggregations: [],
      groupBy: [],
      isSimple: true,
      rawParts: {}
    };

    try {
      // Extract bucket
      const bucketMatch = query.match(/from\s*\(\s*bucket\s*:\s*"([^"]+)"\s*\)/);
      if (bucketMatch) {
        parsed.bucket = bucketMatch[1];
      }

      // Extract time range
      const rangeMatch = query.match(/range\s*\(\s*start\s*:\s*([^,\)]+)(?:,\s*stop\s*:\s*([^)]+))?\s*\)/);
      if (rangeMatch) {
        parsed.timeRange.start = rangeMatch[1].trim();
        parsed.timeRange.stop = rangeMatch[2]?.trim() || 'now()';
      }

      // Extract filters
      const filterMatches = query.matchAll(/filter\s*\(\s*fn\s*:\s*\([^)]*\)\s*=>\s*([^)]+)\)/g);
      for (const match of filterMatches) {
        parsed.filters.push(match[1].trim());
      }

      // Extract measurement filter
      const measurementFilter = parsed.filters.find(f => f.includes('_measurement'));
      if (measurementFilter) {
        // Handle simple case: r._measurement == "measurement-name"
        const measMatch = measurementFilter.match(/_measurement\s*==\s*"([^"]+)"/);
        if (measMatch) {
          parsed.measurement = measMatch[1];
        } else {
          // Handle OR case: r._measurement == "prod-line0" or r._measurement == "prod-line1"
          const orMatches = measurementFilter.matchAll(/_measurement\s*==\s*"([^"]+)"/g);
          const measurements = Array.from(orMatches, m => m[1]);
          if (measurements.length > 0) {
            // Store multiple measurements for later handling
            parsed.rawParts.measurements = measurements;
          }
        }
      }

      // Also check bracket notation: r["_measurement"]
      const bracketMeasFilter = parsed.filters.find(f => f.includes('["_measurement"]'));
      if (bracketMeasFilter && !parsed.measurement) {
        const bracketMatch = bracketMeasFilter.match(/\["_measurement"\]\s*==\s*"([^"]+)"/);
        if (bracketMatch) {
          parsed.measurement = bracketMatch[1];
        }
      }

      // Extract measurement-type tag value (if present)
      const measurementTypeFilter = parsed.filters.find(f => f.includes('measurement-type'));
      if (measurementTypeFilter) {
        const typeMatch = measurementTypeFilter.match(/measurement-type"\]\s*==\s*"([^"]+)"/) ||
          measurementTypeFilter.match(/measurement-type\s*==\s*"([^"]+)"/);
        if (typeMatch) {
          parsed.rawParts.measurementTypeValue = typeMatch[1];
        }
      }

      // Extract field filters
      const fieldFilters = parsed.filters.filter(f => f.includes('_field'));
      fieldFilters.forEach(f => {
        const fieldMatch = f.match(/_field\s*==\s*"([^"]+)"/);
        if (fieldMatch) {
          parsed.fields.push(fieldMatch[1]);
          return;
        }

        // Handle bracket notation: r["_field"] == "field-name"
        const bracketFieldMatch = f.match(/\["_field"\]\s*==\s*"([^"]+)"/);
        if (bracketFieldMatch) {
          parsed.fields.push(bracketFieldMatch[1]);
        }
      });

      // Check for aggregations
      if (query.includes('aggregateWindow') || query.includes('mean(') ||
          query.includes('sum(') || query.includes('count(') ||
          query.includes('max(') || query.includes('min(')) {

        // Extract aggregateWindow parameters
        const aggWindowMatch = query.match(/aggregateWindow\s*\(\s*every\s*:\s*([^,]+),\s*fn\s*:\s*(\w+)/);
        if (aggWindowMatch) {
          const interval = aggWindowMatch[1].trim();
          const fn = aggWindowMatch[2].trim();
          parsed.aggregations = [fn];
          parsed.rawParts.windowInterval = interval;
        } else {
          // Try to extract aggregation type from standalone functions
          const aggMatches = query.match(/\b(mean|sum|count|max|min|median|stddev)\b/g);
          if (aggMatches) {
            parsed.aggregations = [...new Set(aggMatches)];
          }
        }
      }

      // Check for group by
      if (query.includes('group(')) {
        const groupMatch = query.match(/group\s*\(\s*columns\s*:\s*\[([^\]]+)\]/);
        if (groupMatch) {
          parsed.groupBy = groupMatch[1]
            .split(',')
            .map(c => c.trim().replace(/"/g, ''));
        }
      }

      // Check for complex operations that make transformation harder
      if (query.includes('join(') || query.includes('pivot(') ||
          query.includes('map(') || query.includes('reduce(')) {
        parsed.isSimple = false;
      }

      return parsed;

    } catch (error) {
      this.logger.error('Failed to parse Flux query', {
        component: 'query-transformer',
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  private buildSQLQuery(parsed: ParsedFluxQuery, result: TransformResult): string {
    const parts: string[] = [];
    const hasAggregation = parsed.aggregations.length > 0;

    // SELECT clause
    if (hasAggregation) {
      if (parsed.fields.length > 0) {
        // Aggregate specific fields
        const aggClauses = parsed.fields.map(field => {
          const agg = parsed.aggregations[0]; // Use first aggregation
          return `${agg.toUpperCase()}("${field}") AS "${field}"`;
        });
        parts.push(`SELECT ${aggClauses.join(', ')}`);
      } else {
        const agg = parsed.aggregations[0];
        parts.push(`SELECT ${agg.toUpperCase()}(value) AS value`);
      }
    } else if (parsed.fields.length > 0) {
      parts.push(`SELECT ${parsed.fields.map(f => `"${f}"`).join(', ')}`);
    } else {
      parts.push('SELECT *');
    }

    // FROM clause - try to determine measurement name
    let measurementName = parsed.measurement;

    // If no measurement, try to guess from filters
    if (!measurementName && parsed.rawParts.measurements && parsed.rawParts.measurements.length > 0) {
      // Multiple measurements in OR condition
      measurementName = `(${parsed.rawParts.measurements.map((m: string) => `"${m}"`).join(' OR ')})`;
      result.warnings.push('Multiple measurements detected - may need manual adjustment');
    }

    if (!measurementName && parsed.rawParts.measurementTypeValue) {
      measurementName = `"${parsed.rawParts.measurementTypeValue}"`;
      result.warnings.push(`Using measurement-type value "${parsed.rawParts.measurementTypeValue}" as table name`);
    }

    if (measurementName) {
      parts.push(`FROM ${measurementName}`);
    } else {
      parts.push(`FROM "<YOUR_MEASUREMENT_NAME>"`);
      result.warnings.push('Could not determine measurement name - replace <YOUR_MEASUREMENT_NAME> with actual table');
    }

    // WHERE clause
    const whereClauses: string[] = [];

    // Time range
    if (parsed.timeRange.start) {
      const startTime = this.convertTimeExpression(parsed.timeRange.start);
      whereClauses.push(`time >= ${startTime}`);
    }

    if (parsed.timeRange.stop && parsed.timeRange.stop !== 'now()') {
      const stopTime = this.convertTimeExpression(parsed.timeRange.stop);
      whereClauses.push(`time <= ${stopTime}`);
    }

    // Additional filters (convert _field, _value, etc.)
    parsed.filters.forEach(filter => {
      if (filter.includes('_measurement') || filter.includes('_field')) {
        // Already handled
        return;
      }

      // Try to convert other filters
      const converted = this.convertFilter(filter);
      if (converted) {
        whereClauses.push(converted);
      } else {
        result.warnings.push(`Could not convert filter: ${filter}`);
      }
    });

    if (whereClauses.length > 0) {
      parts.push(`WHERE ${whereClauses.join(' AND ')}`);
    }

    // GROUP BY clause - handle time-based aggregation
    if (hasAggregation) {
      const intervalExpr = this.convertIntervalExpression(parsed.rawParts.windowInterval);
      if (intervalExpr) {
        parts.push(`GROUP BY date_bin(${intervalExpr}, time)`);
        if (intervalExpr.includes('$__interval')) {
          result.warnings.push('Using Grafana $__interval in date_bin; verify interval format is supported by InfluxDB 3.x');
        }
      } else {
        parts.push(`GROUP BY date_bin(INTERVAL '1 minute', time)`);
        result.warnings.push('No window interval detected; defaulting to 1 minute for date_bin');
      }

      // Add additional group by fields if present
      if (parsed.groupBy.length > 0) {
        const groupFields = parsed.groupBy
          .filter(g => !g.startsWith('_')) // Filter out internal fields
          .map(g => `"${g}"`)
          .join(', ');

        if (groupFields) {
          parts[parts.length - 1] += `, ${groupFields}`;
        }
      }
    } else if (parsed.groupBy.length > 0) {
      const groupFields = parsed.groupBy
        .filter(g => !g.startsWith('_')) // Filter out internal fields
        .map(g => `"${g}"`)
        .join(', ');

      if (groupFields) {
        parts.push(`GROUP BY ${groupFields}`);
      }
    }

    // Add comment about original query
    const sqlQuery = parts.join('\n');
    const comment = '-- Transformed from Flux query\n' +
      (result.warnings.length > 0 ? '-- WARNINGS: ' + result.warnings.join('; ') + '\n' : '') +
      sqlQuery;

    return comment;
  }

  private convertTimeExpression(expr: string): string {
    // Convert Flux time expressions to SQL
    if (expr === 'now()') {
      return 'NOW()';
    }

    // Handle Grafana variables
    if (expr === 'v.timeRangeStart') {
      return '$__timeFrom';
    }
    if (expr === 'v.timeRangeStop') {
      return '$__timeTo';
    }

    // Handle relative time like -1h, -7d, -30m
    const relativeMatch = expr.match(/^-(\d+)([smhd])$/);
    if (relativeMatch) {
      const value = relativeMatch[1];
      const unit = relativeMatch[2];

      const unitMap: { [key: string]: string } = {
        's': 'SECONDS',
        'm': 'MINUTES',
        'h': 'HOURS',
        'd': 'DAYS'
      };

      return `NOW() - INTERVAL '${value}' ${unitMap[unit]}`;
    }

    // Handle absolute timestamps
    if (expr.match(/^\d{4}-\d{2}-\d{2}/)) {
      return `'${expr}'`;
    }

    // Default: return as-is and let the database handle it
    return expr;
  }

  private convertIntervalExpression(expr?: string): string | null {
    if (!expr) return null;

    const trimmed = expr.trim();
    if (trimmed === 'v.windowPeriod' || trimmed === '$__interval') {
      return 'INTERVAL $__interval_ms MILLISECOND';
    }
    if (trimmed === '$__interval_ms') {
      return 'INTERVAL $__interval_ms MILLISECOND';
    }

    const intervalMatch = trimmed.match(/^(\d+)([smhdw])$/);
    if (intervalMatch) {
      const value = intervalMatch[1];
      const unit = intervalMatch[2];
      const unitMap: { [key: string]: string } = {
        s: 'seconds',
        m: 'minutes',
        h: 'hours',
        d: 'days',
        w: 'weeks'
      };
      return `INTERVAL ${value} ${unitMap[unit]}`;
    }

    return null;
  }

  private convertFilter(filter: string): string | null {
    // Convert Flux filter expressions to SQL WHERE conditions
    // This is a simplified conversion - complex expressions may need manual review

    // Handle bracket notation filters like r["measurement-type"] == "inverter"
    let converted = filter.replace(/r\["([^"]+)"\]\s*==\s*"([^"]+)"/g, '"$1" = \'$2\'');
    converted = converted.replace(/r\["([^"]+)"\]\s*!=\s*"([^"]+)"/g, '"$1" <> \'$2\'');

    // Convert _value references to field names
    converted = converted.replace(/r\._value/g, 'value');
    converted = converted.replace(/r\.(\w+)/g, '"$1"');

    // Convert operators
    converted = converted.replace(/==/g, '=');
    converted = converted.replace(/!=/g, '<>');
    converted = converted.replace(/and/gi, 'AND');
    converted = converted.replace(/or/gi, 'OR');

    return converted;
  }

  batchTransform(queries: string[]): TransformResult[] {
    this.logger.info('Batch transforming queries', {
      component: 'query-transformer',
      count: queries.length
    });

    return queries.map(q => this.transform(q));
  }
}

interface ParsedFluxQuery {
  bucket: string;
  measurement: string;
  timeRange: {
    start: string;
    stop: string;
  };
  filters: string[];
  fields: string[];
  aggregations: string[];
  groupBy: string[];
  isSimple: boolean;
  rawParts: { [key: string]: any };
}
