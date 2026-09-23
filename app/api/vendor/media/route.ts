// ============================================================================
// QuickFurno — vendor portfolio photo upload.
//
// WHY THE IMAGE GOES THROUGH THIS ROUTE INSTEAD OF STRAIGHT TO STORAGE
//
// The obvious design is a signed upload URL: the browser PUTs the file to
// Supabase directly and the server never touches the bytes. That design is
// wrong here.
//
// A vendor's portfolio photo is a picture they took on their phone, standing
// inside a client's home. Phone cameras write EXIF, and EXIF carries GPS. A
// direct upload would place the precise coordinates of a homeowner's flat in a
// PUBLIC bucket, attached to a named business, for anyone who downloads the
// image and runs exiftool. The homeowner never consented to that and would
// never know.
//
// So every byte is re-encoded here first. sharp drops all metadata unless
// withMetadata() is called, which it deliberately is not, so the file written
// to storage is a fresh image with no EXIF, no GPS, no capture timestamp and
// no device serial. `.rotate()` is called BEFORE that so the EXIF orientation
// flag is baked into the pixels rather than lost with the rest of the
// metadata — otherwise stripping EXIF would silently turn portrait photos
// sideways.
//
// The bucket has no client write policy at all. This route, holding the
// service role, is the only writer.
//
// WHAT THIS ROUTE DELIBERATELY DOES NOT DO
//
// It does not attach the photo to the vendor's profile. Profile edits in this
// product go through vendorProfileChangeService and an admin approves them,
// and a photograph is exactly the kind of change that needs a human look —
// wrong room, someone else's work, a client's face. So this route only turns a
// file into a safe hosted URL and hands it back. The existing approval
// pipeline decides whether it ever goes public, exactly as it does for a
// pasted link.
// ============================================================================
import { NextResponse } from "next/server";
import sharp from "sharp";
import { adminClient, serverClient } from "@/lib/supabase";

export const runtime = "nodejs";        // sharp is native; it cannot run on edge
export const dynamic = "force-dynamic";

const BUCKET = "vendor-media";
const MAX_BYTES = 8 * 1024 * 1024;      // 8 MiB in
const MAX_EDGE = 1600;                  // longest side after resize
// A ceiling on STORED objects per vendor, not on published photos. The profile
// itself caps what goes public; this only stops the bucket being used as free
// unlimited hosting by re-uploading without ever submitting.
const MAX_OBJECTS_PER_VENDOR = 40;

/**
 * The declared Content-Type is attacker-controlled, so the first bytes decide.
 * This does not make the file safe on its own — sharp re-encoding it does —
 * but it rejects the obvious cases before spending CPU on them.
 */
function sniff(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

/** The vendor id owned by the signed-in user. Never taken from the request. */
async function callerVendorId(): Promise<string | null> {
  const sb = await serverClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb
    .from("vendors")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

const bad = (code: string, message: string, status = 400) =>
  NextResponse.json({ ok: false, code, error: message }, { status });

export async function POST(request: Request) {
  const vendorId = await callerVendorId();
  if (!vendorId) return bad("UNAUTHORIZED", "Sign in as a vendor to add photos.", 401);

  const db = adminClient();
  const { data: stored } = await db.storage.from(BUCKET).list(vendorId, { limit: MAX_OBJECTS_PER_VENDOR + 1 });
  if ((stored?.length ?? 0) >= MAX_OBJECTS_PER_VENDOR) {
    return bad("LIMIT_REACHED", "You have reached the upload limit. Remove some photos and try again.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("BAD_REQUEST", "That upload could not be read. Please try again.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return bad("NO_FILE", "Choose a photo to upload.");
  if (file.size === 0) return bad("EMPTY_FILE", "That file is empty.");
  if (file.size > MAX_BYTES) {
    return bad("TOO_LARGE", `Photos must be under ${Math.floor(MAX_BYTES / 1024 / 1024)}MB. Yours is ${(file.size / 1024 / 1024).toFixed(1)}MB.`);
  }

  const input = Buffer.from(await file.arrayBuffer());
  if (!sniff(input)) return bad("NOT_AN_IMAGE", "That file is not a JPEG, PNG or WebP image.");

  // THE STRIP. No withMetadata(): the output carries no EXIF, so no GPS.
  // rotate() first, so orientation survives as pixels.
  let output: Buffer;
  let width = 0;
  let height = 0;
  try {
    const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    output = data;
    width = info.width;
    height = info.height;
  } catch {
    return bad("UNREADABLE_IMAGE", "That image could not be processed. Try a different photo.");
  }

  const key = `${vendorId}/${crypto.randomUUID()}.webp`;
  const { error: uploadError } = await db.storage
    .from(BUCKET)
    .upload(key, output, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
  if (uploadError) {
    return bad("UPLOAD_FAILED", "The photo could not be saved. Please try again.", 502);
  }

  const { data: pub } = db.storage.from(BUCKET).getPublicUrl(key);

  // Just a safe hosted URL. Nothing is published until the vendor submits the
  // profile form and an admin approves it, same as a pasted link.
  return NextResponse.json({ ok: true, url: pub.publicUrl, width, height, bytes: output.length });
}

/** Discard an upload the vendor decided against, so it is not left orphaned. */
export async function DELETE(request: Request) {
  const vendorId = await callerVendorId();
  if (!vendorId) return bad("UNAUTHORIZED", "Sign in as a vendor to remove photos.", 401);

  let body: { url?: string };
  try {
    body = await request.json();
  } catch {
    return bad("BAD_REQUEST", "Could not read that request.");
  }
  const url = (body.url ?? "").trim();
  if (!url) return bad("NO_URL", "Which photo should be removed?");

  // The key is derived from the url and MUST start with this vendor's own id.
  // That single check is what stops a crafted url reaching another vendor's
  // folder — ownership is proved by the path, not by anything the caller says.
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  const key = at === -1 ? "" : url.slice(at + marker.length).split("?")[0];
  if (!key || !key.startsWith(`${vendorId}/`) || key.includes("..")) {
    return bad("NOT_YOURS", "That photo does not belong to your account.", 404);
  }

  const { error } = await adminClient().storage.from(BUCKET).remove([key]);
  if (error) return bad("DELETE_FAILED", "That photo could not be removed. Please try again.", 502);

  return NextResponse.json({ ok: true });
}
