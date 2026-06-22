import { ImageResponse } from "next/og";

export const runtime = "edge";

// Generates the social share image and wires og:image / twitter:image automatically.
export const alt = "QuickFurno — verified home-service vendors in Pune & Mumbai";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const pills = ["Verified Vendors", "Transparent Rates", "Pune & Mumbai"];

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
          background: "linear-gradient(135deg, #4F46E5 0%, #1E1B3A 70%)",
          color: "#F7F7FB",
          fontFamily: "sans-serif",
        }}
      >
        {/* brand lockup */}
        <div style={{ display: "flex", alignItems: "center", gap: 30 }}>
          <div
            style={{
              position: "relative",
              width: 116,
              height: 116,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 30,
              background: "linear-gradient(135deg, #12694f, #063a2c)",
              boxShadow: "0 20px 50px rgba(0,0,0,0.4)",
            }}
          >
            <div style={{ width: 70, height: 70, borderRadius: "50%", border: "9px solid #FF8A7A" }} />
            <div
              style={{
                position: "absolute",
                right: 22,
                bottom: 22,
                width: 34,
                height: 9,
                borderRadius: 5,
                background: "#FF8A7A",
                transform: "rotate(45deg)",
              }}
            />
          </div>
          <div style={{ display: "flex", fontSize: 70, fontWeight: 800, letterSpacing: -2 }}>
            <span style={{ color: "#ffffff" }}>Quick</span>
            <span style={{ color: "#FF8A7A" }}>Furno</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 40,
            maxWidth: 940,
            fontSize: 44,
            lineHeight: 1.25,
            color: "#d7e7e0",
          }}
        >
          Compare verified interior designers, carpenters &amp; modular experts — with ratings and transparent rates.
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 46 }}>
          {pills.map((pill) => (
            <div
              key={pill}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "14px 26px",
                borderRadius: 999,
                fontSize: 28,
                fontWeight: 700,
                color: "#F7F7FB",
                background: "rgba(255,255,255,0.08)",
                border: "1px solid rgba(230,198,90,0.45)",
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
