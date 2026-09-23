// ============================================================================
// QuickFurno — scripts/ui/validate-vendor-media-exif.mjs
//
// The vendor photo upload makes a privacy promise: a photo a vendor took
// inside a client's home reaches public storage with no GPS in it. This proves
// the promise instead of restating it.
//
// It builds a JPEG that definitely carries GPS EXIF, runs it through the EXACT
// pipeline app/api/vendor/media/route.ts uses, and asserts nothing survives.
// It also asserts the fixture really had EXIF to begin with — a stripping test
// whose input was already clean passes for the wrong reason and protects
// nothing.
//
// It additionally reads the route source and fails if withMetadata()/withExif()
// ever appears there, because a single such call would silently re-attach
// everything this test checks for.
//
// Run: npm run test:ui:vendor-media-exif
// ============================================================================
import sharp from "sharp";
import { readFileSync } from "node:fs";

const ROUTE = "app/api/vendor/media/route.ts";
const KHARADI = { lat: 18.5515, lon: 73.947 };

const checks = [];
const check = (name, pass, detail = "") => checks.push({ name, pass: Boolean(pass), detail });

// --- 1. the route must never re-attach metadata ----------------------------
const routeSrc = readFileSync(ROUTE, "utf8");
const code = routeSrc.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
check("route never calls withMetadata()", !/\.withMetadata\s*\(/.test(code));
check("route never calls withExif()", !/\.withExif\s*\(/.test(code));
check("route rotates before encoding, so stripping EXIF cannot flip photos",
  /\.rotate\s*\(\s*\)/.test(code));
check("route caps input pixels", /limitInputPixels/.test(code));
check("route sniffs magic bytes rather than trusting Content-Type",
  /0xff.*0xd8|RIFF/.test(code));

// --- 2. build a fixture that definitely carries GPS ------------------------
const base = await sharp({
  create: { width: 1200, height: 900, channels: 3, background: { r: 180, g: 120, b: 70 } },
}).jpeg().toBuffer();

const withGps = await sharp(base)
  .withExif({
    IFD0: { Make: "TestPhone", Model: "QF-Fixture", Software: "exif-guard" },
    IFD3: {
      GPSLatitudeRef: "N",
      GPSLatitude: `${Math.floor(KHARADI.lat)}/1 ${Math.floor((KHARADI.lat % 1) * 60)}/1 0/1`,
      GPSLongitudeRef: "E",
      GPSLongitude: `${Math.floor(KHARADI.lon)}/1 ${Math.floor((KHARADI.lon % 1) * 60)}/1 0/1`,
    },
  })
  .toBuffer();

const before = await sharp(withGps).metadata();
check("FIXTURE really carries EXIF (guards against a false pass)",
  Boolean(before.exif && before.exif.length), `${before.exif?.length ?? 0} bytes`);

// EXIF identifies GPS by numeric tag id 0x8825 (the GPS IFD pointer), not by
// the letters "GPS" — searching the bytes for that string finds nothing even
// when coordinates are certainly present, which is how the first version of
// this check failed against a fixture that was working correctly. The byte
// order depends on the TIFF header, so accept either.
const hasGpsIfd = (buf) => {
  if (!buf || buf.length < 4) return false;
  for (let i = 0; i < buf.length - 1; i++) {
    if ((buf[i] === 0x25 && buf[i + 1] === 0x88) || (buf[i] === 0x88 && buf[i + 1] === 0x25)) return true;
  }
  return false;
};
check("FIXTURE really carries a GPS IFD (tag 0x8825)", hasGpsIfd(before.exif));

// --- 3. the route's pipeline, character for character ----------------------
const { data: out, info } = await sharp(withGps, { failOn: "error", limitInputPixels: 50_000_000 })
  .rotate()
  .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
  .webp({ quality: 82 })
  .toBuffer({ resolveWithObject: true });

const after = await sharp(out).metadata();
const rawAfter = out.toString("latin1");

// The decisive one: no EXIF block at all means no GPS, by definition.
check("output carries no EXIF block", !(after.exif && after.exif.length));
check("output carries no GPS IFD", !hasGpsIfd(after.exif));
check("output contains no camera make", !rawAfter.includes("TestPhone"));
check("output contains no camera model", !rawAfter.includes("QF-Fixture"));
check("output contains no software tag", !rawAfter.includes("exif-guard"));
check("output is webp", info.format === "webp");
check("the picture itself survived", info.width === 1200 && info.height === 900,
  `${info.width}x${info.height}`);

// --- report ---------------------------------------------------------------
let failed = 0;
for (const c of checks) {
  if (!c.pass) failed++;
  console.log(`   ${c.pass ? "ok  " : "FAIL"}  ${c.name}${c.detail ? "  (" + c.detail + ")" : ""}`);
}
console.log("=".repeat(78));
console.log(`vendor media EXIF guard — passed ${checks.length - failed}, failed ${failed}`);
console.log("=".repeat(78));
process.exit(failed ? 1 : 0);
