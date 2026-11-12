import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";
// Permit only this machine's actual LAN addresses for dev assets/HMR. This does
// not relax the API's same-origin checks or any production cookie protections.
const lanAddresses = Object.values(networkInterfaces()).flatMap((entries) =>
  (entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address),
);
const config: NextConfig = { allowedDevOrigins: lanAddresses };
export default config;
