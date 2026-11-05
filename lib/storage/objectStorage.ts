export interface ObjectStorageListOptions {
  readonly limit: number;
}

export interface ObjectStoragePutOptions {
  readonly contentType: string;
  readonly cacheControl?: string;
  readonly upsert?: boolean;
}

/**
 * Provider-neutral object-storage capability.
 *
 * Business/application code owns object keys and authorization. The adapter owns
 * provider SDK calls and provider-specific public-URL parsing.
 */
export interface ObjectStorage {
  list(prefix: string, options: ObjectStorageListOptions): Promise<readonly string[]>;
  put(key: string, body: Uint8Array, options: ObjectStoragePutOptions): Promise<void>;
  publicUrl(key: string): string;
  keyFromPublicUrl(url: string): string | null;
  remove(keys: readonly string[]): Promise<void>;
}

/**
 * Private, owner-consented vendor verification evidence port. Unlike public
 * portfolio media it intentionally has NO publicUrl/keyFromPublicUrl method.
 * Only the provider adapter may inspect real bucket ACLs, upload, download or
 * remove raw bytes; application routes must never call a provider SDK.
 */
export interface PrivateEvidenceObjectStorage {
  assertPrivate(): Promise<void>;
  put(key: string, body: Uint8Array, options: ObjectStoragePutOptions): Promise<void>;
  read(key: string, maxBytes: number): Promise<Uint8Array | null>;
  remove(keys: readonly string[]): Promise<void>;
}
