export const REGISTRY_API_VERSION = "v1" as const;
export const REGISTRY_API_PREFIX = "/v1" as const;
export const AGENTCARGO_ARTIFACT_FORMAT = "agentcargo-ustar-v1" as const;
export const AGENTCARGO_ARTIFACT_MEDIA_TYPE = "application/vnd.agentcargo.ustar-v1" as const;

export type RegistryApiVersion = typeof REGISTRY_API_VERSION;
export type RegistryArtifactFormat = typeof AGENTCARGO_ARTIFACT_FORMAT;
export type RegistryArtifactMediaType = typeof AGENTCARGO_ARTIFACT_MEDIA_TYPE;
