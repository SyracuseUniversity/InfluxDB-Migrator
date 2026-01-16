"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CheckpointManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class CheckpointManager {
    constructor(checkpointDir, logger) {
        this.checkpointDir = checkpointDir;
        this.logger = logger;
    }
    ensureCheckpointDir() {
        if (!fs.existsSync(this.checkpointDir)) {
            fs.mkdirSync(this.checkpointDir, { recursive: true });
            this.logger.info('Created checkpoint directory', {
                component: 'checkpoint',
                path: this.checkpointDir
            });
        }
    }
    getCheckpointPath(migrationId) {
        return path.join(this.checkpointDir, `${migrationId}.json`);
    }
    generateMigrationId(sourceHost, sourceBucket, destHost, destDatabase) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${sourceHost}_${sourceBucket}_to_${destHost}_${destDatabase}_${timestamp}`;
    }
    async save(data) {
        try {
            this.ensureCheckpointDir();
            const checkpointPath = this.getCheckpointPath(data.migrationId);
            data.lastUpdateTime = new Date().toISOString();
            await fs.promises.writeFile(checkpointPath, JSON.stringify(data, null, 2), 'utf-8');
            this.logger.info('Checkpoint saved', {
                component: 'checkpoint',
                migrationId: data.migrationId,
                migratedRecords: data.migratedRecords,
                path: checkpointPath
            });
        }
        catch (error) {
            this.logger.error('Failed to save checkpoint', {
                component: 'checkpoint',
                error: error instanceof Error ? error.message : String(error),
                migrationId: data.migrationId
            });
            throw error;
        }
    }
    async load(migrationId) {
        try {
            const checkpointPath = this.getCheckpointPath(migrationId);
            if (!fs.existsSync(checkpointPath)) {
                this.logger.info('No checkpoint found', {
                    component: 'checkpoint',
                    migrationId,
                    path: checkpointPath
                });
                return null;
            }
            const content = await fs.promises.readFile(checkpointPath, 'utf-8');
            const data = JSON.parse(content);
            this.logger.info('Checkpoint loaded', {
                component: 'checkpoint',
                migrationId,
                migratedRecords: data.migratedRecords,
                lastTimestamp: data.lastTimestamp
            });
            return data;
        }
        catch (error) {
            this.logger.error('Failed to load checkpoint', {
                component: 'checkpoint',
                error: error instanceof Error ? error.message : String(error),
                migrationId
            });
            return null;
        }
    }
    async list() {
        try {
            this.ensureCheckpointDir();
            const files = await fs.promises.readdir(this.checkpointDir);
            const checkpoints = [];
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(this.checkpointDir, file);
                    const content = await fs.promises.readFile(filePath, 'utf-8');
                    try {
                        const data = JSON.parse(content);
                        checkpoints.push(data);
                    }
                    catch (parseError) {
                        this.logger.warn('Failed to parse checkpoint file', {
                            component: 'checkpoint',
                            file,
                            error: parseError instanceof Error ? parseError.message : String(parseError)
                        });
                    }
                }
            }
            this.logger.info('Listed checkpoints', {
                component: 'checkpoint',
                count: checkpoints.length
            });
            return checkpoints.sort((a, b) => new Date(b.lastUpdateTime).getTime() - new Date(a.lastUpdateTime).getTime());
        }
        catch (error) {
            this.logger.error('Failed to list checkpoints', {
                component: 'checkpoint',
                error: error instanceof Error ? error.message : String(error)
            });
            return [];
        }
    }
    async delete(migrationId) {
        try {
            const checkpointPath = this.getCheckpointPath(migrationId);
            if (!fs.existsSync(checkpointPath)) {
                this.logger.warn('Checkpoint not found for deletion', {
                    component: 'checkpoint',
                    migrationId
                });
                return false;
            }
            await fs.promises.unlink(checkpointPath);
            this.logger.info('Checkpoint deleted', {
                component: 'checkpoint',
                migrationId,
                path: checkpointPath
            });
            return true;
        }
        catch (error) {
            this.logger.error('Failed to delete checkpoint', {
                component: 'checkpoint',
                error: error instanceof Error ? error.message : String(error),
                migrationId
            });
            return false;
        }
    }
}
exports.CheckpointManager = CheckpointManager;
//# sourceMappingURL=checkpoint.js.map