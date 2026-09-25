import { ImageResponse } from "next/og";

export const runtime = "edge";

// The card people see when a quickfurno.in link is shared — on WhatsApp above
// all, which is where most of these links travel. It is the first impression
// of the brand, so it uses the current mark, not the green-and-gold one the
// site stopped using.
//
// The old version read "with ratings and transparent rates". No vendor carries
// a rating yet, so that was advertising something the marketplace does not
// have, on the one image QuickFurno cannot take back once a link is sent. The
// line now says what the product actually does.
export const alt = "QuickFurno — approved home-service professionals in Pune";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ORANGE = "#E0611E";
const INK = "#14100C";

const pills = ["Approved profiles", "Up to 3 matches", "Free to enquire"];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "0 92px",
          background: INK,
          backgroundImage:
            "radial-gradient(60% 60% at 8% 0%, rgba(224, 97, 30, 0.34) 0%, rgba(20, 16, 12, 0) 70%)",
          color: "#F7F1E8",
          fontFamily: "sans-serif",
        }}
      >
        {/* The wordmark, drawn rather than fetched: this runs on the edge and
            must not depend on a file request to render. */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ display: "flex", fontSize: 76, fontWeight: 800, letterSpacing: -2.5 }}>
            <span style={{ color: "#FFFFFF" }}>Quick</span>
            <span style={{ color: ORANGE }}>Furno</span>
          </div>
          <div style={{ display: "flex", marginTop: 8, fontSize: 26, fontWeight: 600, color: ORANGE }}>®</div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 36,
            maxWidth: 960,
            fontSize: 44,
            lineHeight: 1.25,
            color: "#E8E0D4",
          }}
        >
          Tell us what your home needs. QuickFurno connects you with approved interior designers,
          carpenters and modular specialists in Pune.
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 44 }}>
          {pills.map((pill) => (
            <div
              key={pill}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "14px 26px",
                borderRadius: 999,
                fontSize: 27,
                fontWeight: 700,
                color: "#F7F1E8",
                background: "rgba(255, 255, 255, 0.07)",
                border: "1px solid rgba(224, 97, 30, 0.45)",
              }}
            >
              {pill}
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size },
  );
}
