import { AppConfig } from './types';
export declare class ConfigLoader {
    static loadFromEnv(): Partial<AppConfig>;
    static buildFromFlags(flags: any): Partial<AppConfig>;
    static merge(...configs: Partial<AppConfig>[]): AppConfig;
    static validate(config: AppConfig): string[];
}
//# sourceMappingURL=loader.d.ts.map