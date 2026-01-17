import axios, { AxiosInstance } from 'axios';
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

export interface CreateDashboardResponse {
  id: number;
  uid: string;
  url: string;
  status: string;
  version: number;
  slug: string;
}

export class GrafanaClient {
  private client: AxiosInstance;
  private config: GrafanaConfig;
  private logger: winston.Logger;

  constructor(config: GrafanaConfig, logger: winston.Logger) {
    this.config = config;
    this.logger = logger;

    this.client = axios.create({
      baseURL: config.url,
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      this.logger.info('Testing Grafana connection', { component: 'grafana' });
      const response = await this.client.get('/api/health');
      const isHealthy = response.status === 200;

      this.logger.info('Grafana connection test', {
        component: 'grafana',
        status: isHealthy ? 'connected' : 'failed'
      });

      return isHealthy;
    } catch (error) {
      this.logger.error('Grafana connection failed', {
        component: 'grafana',
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  async listDatasources(): Promise<Datasource[]> {
    try {
      this.logger.info('Listing Grafana datasources', { component: 'grafana' });
      const response = await this.client.get<Datasource[]>('/api/datasources');

      this.logger.info('Datasources retrieved', {
        component: 'grafana',
        count: response.data.length
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to list datasources', {
        component: 'grafana',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async findInflux2xDatasources(): Promise<Datasource[]> {
    const allDatasources = await this.listDatasources();
    const influx2xDatasources = allDatasources.filter(ds =>
      ds.type === 'influxdb' || ds.uid === this.config.influx2xDatasource
    );

    this.logger.info('Found InfluxDB 2.x datasources', {
      component: 'grafana',
      count: influx2xDatasources.length
    });

    return influx2xDatasources;
  }

  async listDashboards(): Promise<Dashboard[]> {
    try {
      this.logger.info('Listing Grafana dashboards', { component: 'grafana' });
      const response = await this.client.get<Dashboard[]>('/api/search', {
        params: { type: 'dash-db' }
      });

      this.logger.info('Dashboards retrieved', {
        component: 'grafana',
        count: response.data.length
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to list dashboards', {
        component: 'grafana',
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async getDashboard(uid: string): Promise<DashboardDetail> {
    try {
      this.logger.info('Fetching dashboard', {
        component: 'grafana',
        uid
      });

      const response = await this.client.get<DashboardDetail>(`/api/dashboards/uid/${uid}`);

      this.logger.info('Dashboard retrieved', {
        component: 'grafana',
        uid,
        title: response.data.dashboard.title,
        panels: response.data.dashboard.panels?.length || 0
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch dashboard', {
        component: 'grafana',
        uid,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  async findDashboardsUsingDatasource(datasourceUid: string): Promise<DashboardDetail[]> {
    this.logger.info('Finding dashboards using datasource', {
      component: 'grafana',
      datasourceUid
    });

    const allDashboards = await this.listDashboards();
    const dashboardsUsingDatasource: DashboardDetail[] = [];

    for (const dashboard of allDashboards) {
      try {
        const detail = await this.getDashboard(dashboard.uid);

        // Check if any panel uses the datasource
        const usesDatasource = detail.dashboard.panels?.some(panel => {
          if (panel.datasource?.uid === datasourceUid) return true;

          if (panel.targets) {
            return panel.targets.some(target =>
              target.datasource?.uid === datasourceUid
            );
          }

          return false;
        });

        if (usesDatasource) {
          dashboardsUsingDatasource.push(detail);
        }
      } catch (error) {
        this.logger.warn('Failed to check dashboard', {
          component: 'grafana',
          uid: dashboard.uid,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    this.logger.info('Dashboards using datasource found', {
      component: 'grafana',
      datasourceUid,
      count: dashboardsUsingDatasource.length
    });

    return dashboardsUsingDatasource;
  }

  async createDashboard(dashboard: any, folderId?: number, overwrite: boolean = false): Promise<DashboardDetail> {
    try {
      this.logger.info('Creating dashboard', {
        component: 'grafana',
        title: dashboard.title
      });

      const payload = {
        dashboard,
        folderId: folderId || 0,
        overwrite
      };

      const response = await this.client.post<CreateDashboardResponse>('/api/dashboards/db', payload);

      this.logger.info('Dashboard created', {
        component: 'grafana',
        title: dashboard.title,
        uid: response.data.uid
      });

      // Fetch the full dashboard details using the UID
      const fullDashboard = await this.getDashboard(response.data.uid);
      return fullDashboard;
    } catch (error) {
      this.logger.error('Failed to create dashboard', {
        component: 'grafana',
        title: dashboard.title,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
