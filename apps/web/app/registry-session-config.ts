import type { RegistrySessionBridgeConfig } from "./registry-session";

/**
 * Host composition seam for the web registry session exchange.
 *
 * The local preview intentionally leaves this unset. A deployed host must
 * provide a request-scoped resolver backed by its own OAuth/session boundary;
 * workspace identity headers are never a substitute for that resolver.
 */
export const registrySessionBridge: RegistrySessionBridgeConfig | null = null;
