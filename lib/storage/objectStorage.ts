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
