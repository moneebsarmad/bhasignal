const requiredEnvVars = [
  "NODE_ENV"
] as const;

type EnvKey = (typeof requiredEnvVars)[number];

export function validateEnv(
  env: Partial<Record<string, string | undefined>> = process.env
): void {
  const missing = requiredEnvVars.filter((key: EnvKey) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

