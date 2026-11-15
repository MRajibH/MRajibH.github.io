import { ImageResponse } from "next/og";
import { site } from "./site";

export const ogSize = { width: 1200, height: 630 };

/** 1200x630 preview card used when a page is shared on social media. */
export function ogImage({ eyebrow, title }: { eyebrow: string; title: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(135deg, #0B1626 0%, #111F35 60%, #1B2B52 100%)",
          color: "#E6EDF7",
        }}
      >
        <div style={{ display: "flex", fontSize: 30, color: "#5CC0FF" }}>{eyebrow}</div>
        <div
          style={{
            display: "flex",
            fontSize: title.length > 60 ? 60 : 72,
            fontWeight: 700,
            lineHeight: 1.1,
            letterSpacing: -1.5,
          }}
        >
          {title}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 30 }}>
          <div style={{ display: "flex" }}>
            <span style={{ color: "#5CC0FF" }}>rajib</span>
            <span>.uk</span>
          </div>
          <div style={{ display: "flex", color: "#A3B3CA" }}>{site.author}</div>
        </div>
      </div>
    ),
    ogSize,
  );
}
