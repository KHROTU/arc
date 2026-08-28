export interface HostLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}
let _info: (message: string) => void = (m) => console.log(m);
let _warn: (message: string) => void = (m) => console.warn(m);
let _error: (message: string) => void = (m) => console.error(m);
export function setHostLogger(logger: HostLogger): void {
  if (logger.info) _info = logger.info;
  if (logger.warn) _warn = logger.warn;
  if (logger.error) _error = logger.error;
}
export function hostLog(message: string): void {
  _info(message);
}
export function hostWarn(message: string): void {
  _warn(message);
}
export function hostError(message: string): void {
  _error(message);
}