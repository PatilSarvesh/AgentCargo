import type { RegistryRelease } from "@agentcargo/registry-contract";
import type {
  RegistryNamespaceRepository,
  RegistryReleaseReservationRepository,
  RegistryReleaseRepository,
} from "@agentcargo/registry-db";
import type { DigestArtifactStorage } from "@agentcargo/registry-storage";

/**
 * Adapter supplied by a developer or CI job with real PostgreSQL and
 * S3-compatible services. Keeping this boundary injectable avoids shipping
 * provider credentials or a database driver in the normal workspace tests.
 */
export interface LiveRegistryIntegrationEnvironment {
  repository: RegistryReleaseRepository;
  namespaceRepository: RegistryNamespaceRepository;
  reservationRepository: RegistryReleaseReservationRepository;
  storage: DigestArtifactStorage;
  activateRelease(release: RegistryRelease): Promise<void>;
  download(url: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

export type LiveRegistryIntegrationEnvironmentFactory = () => Promise<LiveRegistryIntegrationEnvironment>;
