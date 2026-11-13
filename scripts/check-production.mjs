// Validate presence/shape only. Never print credential values.
const required = [
  "APP_PUBLIC_ORIGIN",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_JWT_SECRET",
  "RATE_LIMIT_SALT",
];
const missing = required.filter((key) => !process.env[key]);
if (missing.length)
  throw new Error(`Missing deployment variables: ${missing.join(", ")}`);
for (const key of ["APP_PUBLIC_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL"]) {
  const url = new URL(process.env[key]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
  )
    throw new Error(
      `${key} must be a public HTTPS origin without credentials, paths, queries, or fragments.`,
    );
}
for (const key of ["SUPABASE_JWT_SECRET", "RATE_LIMIT_SALT"])
  if (process.env[key].length < 32)
    throw new Error(`${key} must contain at least 32 characters.`);
if (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ===
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
  throw new Error("Public and server Supabase credentials must be different.");
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (publicKey.startsWith("sb_secret_"))
  throw new Error("The public Supabase variable contains a secret key.");
if (publicKey.split(".").length === 3) {
  try {
    if (
      JSON.parse(Buffer.from(publicKey.split(".")[1], "base64url").toString())
        .role === "service_role"
    )
      throw new Error(
        "The public Supabase variable contains a service-role JWT.",
      );
  } catch (e) {
    if (e instanceof SyntaxError)
      throw new Error("Invalid public Supabase JWT.");
    throw e;
  }
}
console.log(
  "Deployment environment shape checks passed. Verify credentials, private Realtime, and all four migrations against the target project.",
);
