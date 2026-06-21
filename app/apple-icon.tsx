import { ImageResponse } from "next/og";

export const runtime = "edge";

// Generates /apple-icon.png and wires the <link rel="apple-touch-icon"> automatically.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #12694f, #063a2c)",
        }}
      >
        <div
          style={{
            position: "relative",
            width: 120,
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Q ring */}
          <div
            style={{
              width: 104,
              height: 104,
              borderRadius: "50%",
              border: "13px solid #f4f1ea",
            }}
          />
          {/* gold spark tail */}
          <div
            style={{
              position: "absolute",
              right: 6,
              bottom: 6,
              width: 50,
              height: 13,
              borderRadius: 7,
              background: "#e6c65a",
              transform: "rotate(45deg)",
            }}
          />
        </div>
      </div>
    ),
    { ...size },
  );
}
