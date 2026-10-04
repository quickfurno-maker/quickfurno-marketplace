import { adminClient } from "@/lib/supabase";
import type {
  ObjectStorage,
  ObjectStorageListOptions,
  ObjectStoragePutOptions,
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
