import winston from 'winston';
export interface TransformResult {
    original: string;
    transformed: string;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
    requiresManualReview: boolean;
}
export declare class QueryTransformer {
    private logger;
    constructor(logger: winston.Logger);
    transform(fluxQuery: string): TransformResult;
    private parseFluxQuery;
    private buildSQLQuery;
    private convertTimeExpression;
    private convertFilter;
    batchTransform(queries: string[]): TransformResult[];
}
//# sourceMappingURL=query-transformer.d.ts.map