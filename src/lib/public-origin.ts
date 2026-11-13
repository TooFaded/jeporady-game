import "server-only";
import { validatePublicOrigin } from "./invitations";
export function configuredOrigin(): string | null {
  const value = process.env.APP_PUBLIC_ORIGIN;
  if (!value) {
    if (process.env.NODE_ENV === "production")
      throw new Error("APP_ORIGIN_REQUIRED");
    return null;
  }
  return validatePublicOrigin(value, process.env.NODE_ENV === "production");
}
