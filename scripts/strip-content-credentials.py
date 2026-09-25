"""
Remove C2PA "Content Credentials" from images, without touching the picture.

An image file is a container of separate parcels. The picture is one parcel;
the credential is another sitting beside it. This drops that parcel and fixes
the container's length field -- nothing is decoded, nothing is re-encoded.

Every file is verified: the picture parcels are read back out of the rewritten
file and their digest compared with the original's. A file is only written when
those match, so a bug here cannot quietly degrade an image.

  python strip_credentials.py <root>          # report only
  python strip_credentials.py <root> --apply  # rewrite in place
"""
import hashlib
import os
import struct
import sys

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def parse_webp(d):
    """-> (list of (tag, whole_chunk_bytes, payload)) or None if not a WebP."""
    if d[:4] != b"RIFF" or d[8:12] != b"WEBP":
        return None
    out, i = [], 12
    while i + 8 <= len(d):
        tag = d[i:i + 4]
        sz = struct.unpack("<I", d[i + 4:i + 8])[0]
        end = i + 8 + sz + (sz & 1)
        if end > len(d):
            return None                      # truncated; leave the file alone
        out.append((tag, d[i:end], d[i + 8:i + 8 + sz]))
        i = end
    return out


def build_webp(chunks):
    body = b"".join(whole for _tag, whole, _p in chunks)
    return b"RIFF" + struct.pack("<I", 4 + len(body)) + b"WEBP" + body


def parse_png(d):
    if d[:8] != PNG_SIG:
        return None
    out, i = [], 8
    while i + 8 <= len(d):
        ln = struct.unpack(">I", d[i:i + 4])[0]
        typ = d[i + 4:i + 8]
        end = i + 12 + ln
        if end > len(d):
            return None
        out.append((typ, d[i:end], d[i + 8:i + 8 + ln]))
        i = end
        if typ == b"IEND":
            break
    return out


def build_png(chunks):
    return PNG_SIG + b"".join(whole for _t, whole, _p in chunks)


FORMATS = {
    ".webp": (parse_webp, build_webp, {b"C2PA"}),
    ".png": (parse_png, build_png, {b"caBX"}),
}


def digest(chunks, drop):
    """Digest of everything that is NOT the credential."""
    h = hashlib.sha256()
    for tag, _whole, payload in chunks:
        if tag not in drop:
            h.update(tag)
            h.update(payload)
    return h.hexdigest()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    root = sys.argv[1]
    apply = "--apply" in sys.argv
    changed = saved = skipped = 0

    for dirpath, _dirs, files in os.walk(root):
        for name in sorted(files):
            ext = os.path.splitext(name)[1].lower()
            if ext not in FORMATS:
                continue
            parse, build, drop = FORMATS[ext]
            path = os.path.join(dirpath, name)
            data = open(path, "rb").read()

            chunks = parse(data)
            if chunks is None:
                continue
            if not any(tag in drop for tag, _w, _p in chunks):
                continue

            keep = [c for c in chunks if c[0] not in drop]
            new = build(keep)

            # read the picture back out of the rewritten bytes and compare
            reparsed = parse(new)
            if reparsed is None or digest(reparsed, drop) != digest(chunks, drop):
                print("  SKIP (verification failed) %s" % path)
                skipped += 1
                continue
            if any(tag in drop for tag, _w, _p in reparsed):
                print("  SKIP (credential survived) %s" % path)
                skipped += 1
                continue

            delta = len(data) - len(new)
            saved += delta
            changed += 1
            print("  %-70s -%6d bytes" % (os.path.relpath(path, root), delta))

            if apply:
                with open(path, "wb") as fh:
                    fh.write(new)

    print()
    print("%d files, %.0f KB removed%s"
          % (changed, saved / 1024.0, "" if apply else "   (dry run — nothing written)"))
    if skipped:
        print("%d skipped" % skipped)
    return 0


if __name__ == "__main__":
    sys.exit(main())
