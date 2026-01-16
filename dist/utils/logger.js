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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_LEVELS = void 0;
exports.createLogger = createLogger;
const winston_1 = __importDefault(require("winston"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function createLogger(logLevel = 'info', logFile) {
    const formats = [
        winston_1.default.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston_1.default.format.errors({ stack: true }),
        winston_1.default.format.splat(),
        winston_1.default.format.json()
    ];
    const transports = [];
    // Console transport with colorized output
    transports.push(new winston_1.default.transports.Console({
        level: logLevel,
        format: winston_1.default.format.combine(winston_1.default.format.colorize(), winston_1.default.format.printf(({ level, message, timestamp, component, ...metadata }) => {
            let msg = `${timestamp} [${level}]`;
            if (component) {
                msg += ` [${component}]`;
            }
            msg += `: ${message}`;
            // Add metadata if present
            const metadataKeys = Object.keys(metadata);
            if (metadataKeys.length > 0) {
                msg += ` ${JSON.stringify(metadata)}`;
            }
            return msg;
        }))
    }));
    // File transport if log file is specified
    if (logFile) {
        // Ensure log directory exists
        const logDir = path.dirname(logFile);
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        transports.push(new winston_1.default.transports.File({
            filename: logFile,
            level: logLevel,
            format: winston_1.default.format.combine(...formats)
        }));
    }
    const logger = winston_1.default.createLogger({
        level: logLevel,
        format: winston_1.default.format.combine(...formats),
        transports,
        exitOnError: false
    });
    return logger;
}
exports.LOG_LEVELS = {
    error: 'error',
    warn: 'warn',
    info: 'info',
    debug: 'debug'
};
//# sourceMappingURL=logger.js.map