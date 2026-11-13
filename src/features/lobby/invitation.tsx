"use client";
import { createElement } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RoomCode } from "./room-code";
/** One URL is passed to the copy control, displayed link and QR encoder. */
export function Invitation({ code, url }: { code: string; url: string }) {
  return createElement(
    "div",
    { className: "room-invitation" },
    createElement(RoomCode, { code, invite: url }),
    url &&
      createElement(
        "div",
        { className: "qr-wrap" },
        createElement(QRCodeSVG, {
          value: url,
          size: 192,
          marginSize: 4,
          level: "M",
          title: "Scan to join this QuizArena room",
        }),
      ),
    url && createElement("a", { className: "invite-url", href: url }, url),
  );
}
