"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrafanaClient = void 0;
const axios_1 = __importDefault(require("axios"));
class GrafanaClient {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.client = axios_1.default.create({
            baseURL: config.url,
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            }
        });
    }
    async testConnection() {
        try {
            this.logger.info('Testing Grafana connection', { component: 'grafana' });
            const response = await this.client.get('/api/health');
            const isHealthy = response.status === 200;
            this.logger.info('Grafana connection test', {
                component: 'grafana',
                status: isHealthy ? 'connected' : 'failed'
            });
            return isHealthy;
        }
        catch (error) {
            this.logger.error('Grafana connection failed', {
                component: 'grafana',
                error: error instanceof Error ? error.message : String(error)
            });
            return false;
        }
    }
    async listDatasources() {
        try {
            this.logger.info('Listing Grafana datasources', { component: 'grafana' });
            const response = await this.client.get('/api/datasources');
            this.logger.info('Datasources retrieved', {
                component: 'grafana',
                count: response.data.length
            });
            return response.data;
        }
        catch (error) {
            this.logger.error('Failed to list datasources', {
                component: 'grafana',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async findInflux2xDatasources() {
        const allDatasources = await this.listDatasources();
        const influx2xDatasources = allDatasources.filter(ds => ds.type === 'influxdb' || ds.uid === this.config.influx2xDatasource);
        this.logger.info('Found InfluxDB 2.x datasources', {
            component: 'grafana',
            count: influx2xDatasources.length
        });
        return influx2xDatasources;
    }
    async listDashboards() {
        try {
            this.logger.info('Listing Grafana dashboards', { component: 'grafana' });
            const response = await this.client.get('/api/search', {
                params: { type: 'dash-db' }
            });
            this.logger.info('Dashboards retrieved', {
                component: 'grafana',
                count: response.data.length
            });
            return response.data;
        }
        catch (error) {
            this.logger.error('Failed to list dashboards', {
                component: 'grafana',
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async getDashboard(uid) {
        try {
            this.logger.info('Fetching dashboard', {
                component: 'grafana',
                uid
            });
            const response = await this.client.get(`/api/dashboards/uid/${uid}`);
            this.logger.info('Dashboard retrieved', {
                component: 'grafana',
                uid,
                title: response.data.dashboard.title,
                panels: response.data.dashboard.panels?.length || 0
            });
            return response.data;
        }
        catch (error) {
            this.logger.error('Failed to fetch dashboard', {
                component: 'grafana',
                uid,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    async findDashboardsUsingDatasource(datasourceUid) {
        this.logger.info('Finding dashboards using datasource', {
            component: 'grafana',
            datasourceUid
        });
        const allDashboards = await this.listDashboards();
        const dashboardsUsingDatasource = [];
        for (const dashboard of allDashboards) {
            try {
                const detail = await this.getDashboard(dashboard.uid);
                // Check if any panel uses the datasource
                const usesDatasource = detail.dashboard.panels?.some(panel => {
                    if (panel.datasource?.uid === datasourceUid)
                        return true;
                    if (panel.targets) {
                        return panel.targets.some(target => target.datasource?.uid === datasourceUid);
                    }
                    return false;
                });
                if (usesDatasource) {
                    dashboardsUsingDatasource.push(detail);
                }
            }
            catch (error) {
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
    async createDashboard(dashboard, folderId, overwrite = false) {
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
            const response = await this.client.post('/api/dashboards/db', payload);
            this.logger.info('Dashboard created', {
                component: 'grafana',
                title: dashboard.title,
                uid: response.data.dashboard.uid
            });
            return response.data;
        }
        catch (error) {
            this.logger.error('Failed to create dashboard', {
                component: 'grafana',
                title: dashboard.title,
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
}
exports.GrafanaClient = GrafanaClient;
//# sourceMappingURL=grafana-client.js.map