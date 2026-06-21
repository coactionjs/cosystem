import type { Plugin } from "./app.js";

export interface LoggerPluginLogger {
  info(message: string, details?: unknown): void;
  error(message: string, details?: unknown): void;
}

export interface LoggerPluginOptions {
  readonly logger?: LoggerPluginLogger;
}

export function createLoggerPlugin(options: LoggerPluginOptions = {}): Plugin {
  const logger = options.logger ?? console;

  return {
    name: "cosystem:logger",
    onActionEnd(event) {
      if (event.error !== undefined) {
        logger.error(`Action failed: ${event.module}.${event.method}`, event);
        return;
      }

      logger.info(`Action completed: ${event.module}.${event.method}`, event);
    },
    onError(error, context) {
      logger.error(`Runtime error during ${context.phase}`, error);
    },
    onModuleCreated(event) {
      logger.info(`Module created: ${event.name}`, event);
    },
  };
}
