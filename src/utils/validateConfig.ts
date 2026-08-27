// Startup configuration sanity checks. A misconfigured .env fails quietly today
// — a bad cluster JSON silently renders an empty grid, an unreachable PING_HOST
// just shows ping 0, and a threshold typo (enter <= clear) makes an alert flap.
// This is a runtime counterpart to scripts/diagnose.sh: it inspects the process
// env once at boot and returns human-readable warnings the caller logs. It is
// pure (env in, strings out) so it can be unit-tested.

type Env = Record<string, string | undefined>;

// Same charset getPing() enforces before shelling out to `ping`.
const HOST_PATTERN = /^[a-zA-Z0-9.:-]+$/;
const WEBHOOK_FORMATS = ['json', 'slack', 'discord'];

// The paired enter/clear alert thresholds. Each should be numeric and, for a
// "high is bad" metric, enter must sit above clear or the hysteresis inverts.
const THRESHOLD_PAIRS: [enter: string, clear: string, label: string][] = [
  ['ALERT_CPU_ENTER', 'ALERT_CPU_CLEAR', 'CPU'],
  ['ALERT_MEM_ENTER', 'ALERT_MEM_CLEAR', 'memory'],
  ['ALERT_DISK_ENTER', 'ALERT_DISK_CLEAR', 'disk'],
  ['ALERT_TEMP_ENTER', 'ALERT_TEMP_CLEAR', 'temperature'],
  ['ALERT_SWAP_ENTER', 'ALERT_SWAP_CLEAR', 'swap']
];

function isNumeric(raw: string): boolean {
  return raw.trim() !== '' && Number.isFinite(Number(raw));
}

function isSet(raw: string | undefined): raw is string {
  return raw !== undefined && raw.trim() !== '';
}

export function validateConfig(env: Env = process.env): string[] {
  const warnings: string[] = [];

  // Cluster server list — the JSON must parse and every entry must be well-formed.
  const cluster = env.NEXT_PUBLIC_CLUSTER_SERVERS;
  if (isSet(cluster)) {
    try {
      const parsed = JSON.parse(cluster);
      if (!Array.isArray(parsed)) {
        warnings.push('NEXT_PUBLIC_CLUSTER_SERVERS is not a JSON array; the cluster view will be empty.');
      } else {
        const valid = parsed.filter(
          (v: unknown) =>
            v &&
            typeof v === 'object' &&
            typeof (v as Record<string, unknown>).name === 'string' &&
            typeof (v as Record<string, unknown>).ip === 'string' &&
            ((v as Record<string, unknown>).type === 'intel' || (v as Record<string, unknown>).type === 'rpi')
        );
        if (valid.length < parsed.length) {
          warnings.push(
            `NEXT_PUBLIC_CLUSTER_SERVERS has ${parsed.length - valid.length} malformed entr${
              parsed.length - valid.length === 1 ? 'y' : 'ies'
            } (need { name, ip, type: "intel"|"rpi" }); they will be ignored.`
          );
        }
      }
    } catch {
      warnings.push('NEXT_PUBLIC_CLUSTER_SERVERS is not valid JSON; the cluster view will be empty.');
    }
  }

  // PING_HOST — an invalid host makes getPing() throw and ping read 0.
  if (isSet(env.PING_HOST) && !HOST_PATTERN.test(env.PING_HOST)) {
    warnings.push(`PING_HOST "${env.PING_HOST}" contains unexpected characters; ping will read 0.`);
  }

  // Alert thresholds — numeric, and enter above clear so hysteresis is sane.
  for (const [enterKey, clearKey, label] of THRESHOLD_PAIRS) {
    const enter = env[enterKey];
    const clear = env[clearKey];
    if (isSet(enter) && !isNumeric(enter)) warnings.push(`${enterKey} "${enter}" is not a number; using the default.`);
    if (isSet(clear) && !isNumeric(clear)) warnings.push(`${clearKey} "${clear}" is not a number; using the default.`);
    if (isSet(enter) && isSet(clear) && isNumeric(enter) && isNumeric(clear) && Number(enter) <= Number(clear)) {
      warnings.push(
        `${label} alert enter (${enter}) is not above clear (${clear}); the alert will flap or never clear.`
      );
    }
  }

  // Webhook config.
  if (isSet(env.ALERT_WEBHOOK_URL)) {
    try {
      new URL(env.ALERT_WEBHOOK_URL);
    } catch {
      warnings.push('ALERT_WEBHOOK_URL is not a valid URL; alert notifications will not be delivered.');
    }
  }
  if (isSet(env.ALERT_WEBHOOK_FORMAT) && !WEBHOOK_FORMATS.includes(env.ALERT_WEBHOOK_FORMAT.toLowerCase())) {
    warnings.push(
      `ALERT_WEBHOOK_FORMAT "${env.ALERT_WEBHOOK_FORMAT}" is unknown; expected one of ${WEBHOOK_FORMATS.join(', ')}. Falling back to json.`
    );
  }

  // SSH_PORTS — comma-separated positive integers.
  if (isSet(env.SSH_PORTS)) {
    const bad = env.SSH_PORTS.split(',')
      .map(p => p.trim())
      .filter(p => p !== '' && !(Number.isInteger(Number(p)) && Number(p) > 0 && Number(p) <= 65535));
    if (bad.length > 0) {
      warnings.push(`SSH_PORTS has invalid port(s): ${bad.join(', ')}; they will be ignored.`);
    }
  }

  // IDLE_TICK_MS — numeric; falls back to 15000 otherwise.
  if (isSet(env.IDLE_TICK_MS) && !isNumeric(env.IDLE_TICK_MS)) {
    warnings.push(`IDLE_TICK_MS "${env.IDLE_TICK_MS}" is not a number; using the 15000ms default.`);
  }

  // A token that is too short offers little protection.
  if (isSet(env.API_AUTH_TOKEN) && env.API_AUTH_TOKEN.length < 16) {
    warnings.push('API_AUTH_TOKEN is shorter than 16 characters; consider a longer secret (e.g. openssl rand -hex 32).');
  }

  return warnings;
}
