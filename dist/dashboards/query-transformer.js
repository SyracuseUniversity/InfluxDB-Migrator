"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QueryTransformer = void 0;
class QueryTransformer {
    constructor(logger) {
        this.logger = logger;
    }
    transform(fluxQuery) {
        const result = {
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
            }
            else if (result.warnings.length <= 2 && parsed.isSimple) {
                result.confidence = 'medium';
                result.requiresManualReview = true;
            }
            else {
                result.confidence = 'low';
                result.requiresManualReview = true;
            }
            this.logger.info('Query transformation completed', {
                component: 'query-transformer',
                confidence: result.confidence,
                warnings: result.warnings.length,
                requiresReview: result.requiresManualReview
            });
        }
        catch (error) {
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
    parseFluxQuery(query) {
        const parsed = {
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
                const measMatch = measurementFilter.match(/_measurement\s*==\s*"([^"]+)"/);
                if (measMatch) {
                    parsed.measurement = measMatch[1];
                }
            }
            // Extract field filters
            const fieldFilters = parsed.filters.filter(f => f.includes('_field'));
            fieldFilters.forEach(f => {
                const fieldMatch = f.match(/_field\s*==\s*"([^"]+)"/);
                if (fieldMatch) {
                    parsed.fields.push(fieldMatch[1]);
                }
            });
            // Check for aggregations
            if (query.includes('aggregateWindow') || query.includes('mean(') ||
                query.includes('sum(') || query.includes('count(') ||
                query.includes('max(') || query.includes('min(')) {
                parsed.isSimple = false;
                // Try to extract aggregation type
                const aggMatches = query.match(/\b(mean|sum|count|max|min|median|stddev)\b/g);
                if (aggMatches) {
                    parsed.aggregations = [...new Set(aggMatches)];
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
        }
        catch (error) {
            this.logger.error('Failed to parse Flux query', {
                component: 'query-transformer',
                error: error instanceof Error ? error.message : String(error)
            });
            return null;
        }
    }
    buildSQLQuery(parsed, result) {
        const parts = [];
        // SELECT clause
        if (parsed.aggregations.length > 0) {
            const aggClauses = parsed.aggregations.map(agg => {
                if (parsed.fields.length > 0) {
                    return parsed.fields.map(field => `${agg.toUpperCase()}("${field}") AS ${field}_${agg}`).join(', ');
                }
                return `${agg.toUpperCase()}(*) AS ${agg}_value`;
            });
            parts.push(`SELECT ${aggClauses.join(', ')}`);
        }
        else if (parsed.fields.length > 0) {
            parts.push(`SELECT ${parsed.fields.map(f => `"${f}"`).join(', ')}`);
        }
        else {
            parts.push('SELECT *');
        }
        // FROM clause
        if (parsed.measurement) {
            parts.push(`FROM "${parsed.measurement}"`);
        }
        else {
            parts.push(`FROM ${parsed.bucket ? `"${parsed.bucket}"` : '<MEASUREMENT_NAME>'}`);
            result.warnings.push('Could not determine measurement name - using bucket or placeholder');
        }
        // WHERE clause
        const whereClauses = [];
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
            }
            else {
                result.warnings.push(`Could not convert filter: ${filter}`);
            }
        });
        if (whereClauses.length > 0) {
            parts.push(`WHERE ${whereClauses.join(' AND ')}`);
        }
        // GROUP BY clause
        if (parsed.groupBy.length > 0) {
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
    convertTimeExpression(expr) {
        // Convert Flux time expressions to SQL
        if (expr === 'now()') {
            return 'NOW()';
        }
        // Handle relative time like -1h, -7d, -30m
        const relativeMatch = expr.match(/^-(\d+)([smhd])$/);
        if (relativeMatch) {
            const value = relativeMatch[1];
            const unit = relativeMatch[2];
            const unitMap = {
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
    convertFilter(filter) {
        // Convert Flux filter expressions to SQL WHERE conditions
        // This is a simplified conversion - complex expressions may need manual review
        // Convert _value references to field names
        let converted = filter.replace(/r\._value/g, 'value');
        converted = converted.replace(/r\.(\w+)/g, '"$1"');
        // Convert operators
        converted = converted.replace(/==/g, '=');
        converted = converted.replace(/!=/g, '<>');
        converted = converted.replace(/and/gi, 'AND');
        converted = converted.replace(/or/gi, 'OR');
        return converted;
    }
    batchTransform(queries) {
        this.logger.info('Batch transforming queries', {
            component: 'query-transformer',
            count: queries.length
        });
        return queries.map(q => this.transform(q));
    }
}
exports.QueryTransformer = QueryTransformer;
//# sourceMappingURL=query-transformer.js.map