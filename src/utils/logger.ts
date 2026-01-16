import winston from 'winston';
import * as path from 'path';
import * as fs from 'fs';

export function createLogger(logLevel: string = 'info', logFile?: string): winston.Logger {
  const formats = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ];

  const transports: winston.transport[] = [];

  // Console transport with colorized output
  transports.push(
    new winston.transports.Console({
      level: logLevel,
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, component, ...metadata }) => {
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
        })
      )
    })
  );

  // File transport if log file is specified
  if (logFile) {
    // Ensure log directory exists
    const logDir = path.dirname(logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    transports.push(
      new winston.transports.File({
        filename: logFile,
        level: logLevel,
        format: winston.format.combine(...formats)
      })
    );
  }

  const logger = winston.createLogger({
    level: logLevel,
    format: winston.format.combine(...formats),
    transports,
    exitOnError: false
  });

  return logger;
}

export const LOG_LEVELS = {
  error: 'error',
  warn: 'warn',
  info: 'info',
  debug: 'debug'
};
