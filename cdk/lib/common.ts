
export function getEnvOrDefault(envVar: string, defaultValue: string): string {
  return process.env[envVar] || defaultValue;
}

export function getRequiredEnv(envVar: string): string {
  const value = process.env[envVar];
  if (!value) {
    throw new Error(`${envVar} environment variable is required`);
  }
  return value;
}

export function getMinecraftEnvironemtnVairables(): {[k: string]: any } {
  const envVars: {[k: string]: any } = {};
  const minecraftEnvPrefix = 'MINECRAFT_';
  const regex = new RegExp(`^${minecraftEnvPrefix}`);
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(minecraftEnvPrefix)) {
      envVars[key.replace.(regex, '')] = value;
    } 
  }
  return envVars
}
