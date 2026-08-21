export const DEFAULT_WEB_PORT = 3000;

export function parseConfiguredPort(rawValue) {
  if (rawValue === undefined || rawValue === "") return undefined;
  if (!/^\d+$/.test(rawValue)) {
    throw new Error("AGENTCARGO_WEB_PORT must be an integer between 1 and 65535.");
  }
  const port = Number(rawValue);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("AGENTCARGO_WEB_PORT must be an integer between 1 and 65535.");
  }
  return port;
}

export function addConfiguredPort(args, rawValue) {
  if (args.some((argument) => argument === "--port" || argument === "-p" || argument.startsWith("--port="))) {
    return [...args];
  }
  const port = parseConfiguredPort(rawValue);
  return port === undefined ? [...args] : [...args, "--port", String(port)];
}
