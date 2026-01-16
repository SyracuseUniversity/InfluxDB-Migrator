import { GrafanaConfig } from '../config/types';
import winston from 'winston';
export interface Dashboard {
    id: number;
    uid: string;
    title: string;
    uri: string;
    url: string;
    slug: string;
    type: string;
    tags: string[];
    isStarred: boolean;
}
export interface DashboardDetail {
    dashboard: {
        id: number;
        uid: string;
        title: string;
        tags: string[];
        timezone: string;
        panels: Panel[];
    };
    meta: {
        type: string;
        canSave: boolean;
        canEdit: boolean;
        canAdmin: boolean;
        canStar: boolean;
        slug: string;
        url: string;
        expires: string;
        created: string;
        updated: string;
        updatedBy: string;
        createdBy: string;
        version: number;
        hasAcl: boolean;
        isFolder: boolean;
        folderId: number;
        folderUid: string;
        folderTitle: string;
        folderUrl: string;
        provisioned: boolean;
        provisionedExternalId: string;
    };
}
export interface Panel {
    id: number;
    type: string;
    title: string;
    datasource?: {
        type: string;
        uid: string;
    };
    targets?: QueryTarget[];
}
export interface QueryTarget {
    refId: string;
    datasource?: {
        type: string;
        uid: string;
    };
    query?: string;
    rawQuery?: boolean;
    [key: string]: any;
}
export interface Datasource {
    id: number;
    uid: string;
    name: string;
    type: string;
    url: string;
    isDefault: boolean;
}
export declare class GrafanaClient {
    private client;
    private config;
    private logger;
    constructor(config: GrafanaConfig, logger: winston.Logger);
    testConnection(): Promise<boolean>;
    listDatasources(): Promise<Datasource[]>;
    findInflux2xDatasources(): Promise<Datasource[]>;
    listDashboards(): Promise<Dashboard[]>;
    getDashboard(uid: string): Promise<DashboardDetail>;
    findDashboardsUsingDatasource(datasourceUid: string): Promise<DashboardDetail[]>;
    createDashboard(dashboard: any, folderId?: number, overwrite?: boolean): Promise<DashboardDetail>;
}
//# sourceMappingURL=grafana-client.d.ts.map