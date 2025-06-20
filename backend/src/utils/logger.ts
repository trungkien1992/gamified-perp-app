export const logger = {
  info: (...args: any[]) => console.info('[INFO]', ...args),
  error: (...args: any[]) => console.error('[ERROR]', ...args),
  debug: (...args: any[]) => console.debug('[DEBUG]', ...args),
  warn: (...args: any[]) => console.warn('[WARN]', ...args),
}; 