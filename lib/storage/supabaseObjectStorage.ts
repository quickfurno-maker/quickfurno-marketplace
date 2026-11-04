import { adminClient } from "@/lib/supabase";
import type {
  ObjectStorage,
  ObjectStorageListOptions,
  ObjectStoragePutOptions,
  PrivateEvidenceObjectStorage,
} from "@/lib/storage/objectStorage";

interface SupabaseObjectStorageOptions {
  readonly bucket: string;
}

function cleanKey(value: string): string | null {
  const decoded = (() => {
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  })();
  if (
    decoded === null ||
    decoded.length < 1 ||
    decoded.startsWith("/") ||
    decoded.includes("..") ||
    decoded.includes("\\")
  ) {
    return null;
  }
  return decoded;
}

export function createSupabaseObjectStorage(
  options: SupabaseObjectStorageOptions,
): ObjectStorage {
  const bucket = options.bucket.trim();
  if (!bucket || bucket.includes("/") || bucket.includes("\\")) {
    throw new Error("OBJECT_STORAGE_BUCKET_INVALID");
  }

  const storage = () => adminClient().storage.from(bucket);

  return Object.freeze({
    async list(
      prefix: string,
      listOptions: ObjectStorageListOptions,
    ): Promise<readonly string[]> {
      const { data, error } = await storage().list(prefix, {
        limit: listOptions.limit,
      });
      if (error) throw new Error("OBJECT_STORAGE_LIST_FAILED");
      return Object.freeze((data ?? []).map((entry) => entry.name));
    },

    async put(
      key: string,
      body: Uint8Array,
      putOptions: ObjectStoragePutOptions,
    ): Promise<void> {
      const { error } = await storage().upload(key, body, {
        contentType: putOptions.contentType,
        ...(putOptions.cacheControl === undefined
          ? {}
          : { cacheControl: putOptions.cacheControl }),
        upsert: putOptions.upsert ?? false,
      });
      if (error) throw new Error("OBJECT_STORAGE_PUT_FAILED");
    },

    publicUrl(key: string): string {
      return storage().getPublicUrl(key).data.publicUrl;
    },

    keyFromPublicUrl(url: string): string | null {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      const marker = `/storage/v1/object/public/${bucket}/`;
      const index = parsed.pathname.indexOf(marker);
      if (index === -1) return null;
      return cleanKey(parsed.pathname.slice(index + marker.length));
    },

    async remove(keys: readonly string[]): Promise<void> {
      if (keys.length < 1) return;
      const { error } = await storage().remove([...keys]);
      if (error) throw new Error("OBJECT_STORAGE_REMOVE_FAILED");
    },
  });
}

/**
 * Only approved private document intake may use this capability. The fixed
 * bucket is not interchangeable with public vendor-media; all provider SDK
 * access is confined to this reviewed adapter.
 */
export function createPrivateVendorEvidenceStorage(): PrivateEvidenceObjectStorage {
  const bucket = "qf-vendor-verification-private";
  const base = createSupabaseObjectStorage({ bucket });
  const keyPattern =
    /^vendors\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|png|jpg)$/i;
  const validKey = (value: string) =>
    typeof value === "string" && value.length <= 220 && keyPattern.test(value);

  async function assertPrivate(): Promise<void> {
    const { data, error } = await adminClient().storage.getBucket(bucket);
    if (error || !data || data.public !== false)
      throw new Error("PRIVATE_EVIDENCE_BUCKET_UNSAFE");
  }

  return Object.freeze({
    assertPrivate,

    async put(
      key: string, body: Uint8Array, options: ObjectStoragePutOptions,
    ): Promise<void> {
      if (!validKey(key) || !(body instanceof Uint8Array) ||
          body.byteLength < 8 || body.byteLength > 5 * 1024 * 1024 ||
          !["application/pdf", "image/png", "image/jpeg"].includes(options.contentType) ||
          options.upsert !== false || options.cacheControl !== "0")
        throw new Error("PRIVATE_EVIDENCE_STORAGE_INPUT_INVALID");
      await assertPrivate();
      await base.put(key, body, options);
    },

    async read(key: string, maxBytes: number): Promise<Uint8Array | null> {
      if (!validKey(key) || !Number.isSafeInteger(maxBytes) ||
          maxBytes < 8 || maxBytes > 5 * 1024 * 1024)
        return null;
      await assertPrivate();
      const { data, error } = await adminClient().storage.from("qf-vendor-verification-private").download(key);
      if (error || !data) throw new Error("PRIVATE_EVIDENCE_READ_UNAVAILABLE");
      if (data.size < 8 || data.size > maxBytes) return null;
      const bytes = new Uint8Array(await data.arrayBuffer());
      return bytes.byteLength === data.size ? bytes : null;
    },

    async remove(keys: readonly string[]): Promise<void> {
      if (!Array.isArray(keys) || keys.length !== 1 || !validKey(keys[0]))
        throw new Error("PRIVATE_EVIDENCE_REMOVAL_DENIED");
      await assertPrivate();
      await base.remove(keys);
    },
  });
}
