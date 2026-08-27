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
// Defaults mirror the built-ins in alerts.ts so a one-sided override is checked
// against the value the other side actually uses at runtime, not skipped.
// `direction` mirrors alerts.ts: 'above' means enter must sit above clear;
// 'below' (battery, disk-fill: "low is bad") means enter must sit below clear.
interface ThresholdPair {
  enterKey: string;
  clearKey: string;
  label: string;
  enterDefault: number;
  clearDefault: number;
  direction: 'above' | 'below';
}

const THRESHOLD_PAIRS: ThresholdPair[] = [
  {
    enterKey: 'ALERT_CPU_ENTER',
    clearKey: 'ALERT_CPU_CLEAR',
    label: 'CPU',
    enterDefault: 90,
    clearDefault: 80,
    direction: 'above'
  },
  {
    enterKey: 'ALERT_MEM_ENTER',
    clearKey: 'ALERT_MEM_CLEAR',
    label: 'memory',
    enterDefault: 90,
    clearDefault: 80,
    direction: 'above'
  },
  {
    enterKey: 'ALERT_DISK_ENTER',
    clearKey: 'ALERT_DISK_CLEAR',
    label: 'disk',
    enterDefault: 85,
    clearDefault: 80,
    direction: 'above'
  },
  {
    enterKey: 'ALERT_TEMP_ENTER',
    clearKey: 'ALERT_TEMP_CLEAR',
    label: 'temperature',
    enterDefault: 74,
    clearDefault: 70,
    direction: 'above'
  },
  {
    enterKey: 'ALERT_SWAP_ENTER',
    clearKey: 'ALERT_SWAP_CLEAR',
    label: 'swap',
    enterDefault: 80,
    clearDefault: 60,
    direction: 'above'
  },
  {
    enterKey: 'ALERT_LOAD_ENTER',
    clearKey: 'ALERT_LOAD_CLEAR',
    label: 'load per core',
    enterDefault: 2,
    clearDefault: 1.5,
    direction: 'above'
  },
  {
    enterKey: 'ALERT_GPU_TEMP_ENTER',
    clearKey: 'ALERT_GPU_TEMP_CLEAR',
    label: 'GPU temperature',
    enterDefault: 85,
    clearDefault: 78,
    direction: 'above'
  },
  {
    enterKey: 'ALERT_BATTERY_ENTER',
    clearKey: 'ALERT_BATTERY_CLEAR',
    label: 'battery',
    enterDefault: 15,
    clearDefault: 25,
    direction: 'below'
  },
  {
    enterKey: 'ALERT_DISKFILL_ENTER_HOURS',
    clearKey: 'ALERT_DISKFILL_CLEAR_HOURS',
    label: 'disk-fill',
    enterDefault: 24,
    clearDefault: 48,
    direction: 'below'
  }
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
  // The check uses effective values (override or built-in default), so a
  // one-sided override that inverts against the other side's default is caught.
  for (const { enterKey, clearKey, label, enterDefault, clearDefault, direction } of THRESHOLD_PAIRS) {
    const enter = env[enterKey];
    const clear = env[clearKey];
    if (isSet(enter) && !isNumeric(enter))
      warnings.push(`${enterKey} "${enter}" is not a number; using the default.`);
    if (isSet(clear) && !isNumeric(clear))
      warnings.push(`${clearKey} "${clear}" is not a number; using the default.`);

    const effectiveEnter = isSet(enter) && isNumeric(enter) ? Number(enter) : enterDefault;
    const effectiveClear = isSet(clear) && isNumeric(clear) ? Number(clear) : clearDefault;
    // Only warn when an override actually caused the inversion (all-default is
    // fine by construction). 'above' needs enter > clear; 'below' needs enter < clear.
    const inverted =
      direction === 'above' ? effectiveEnter <= effectiveClear : effectiveEnter >= effectiveClear;
    if ((isSet(enter) || isSet(clear)) && inverted) {
      const relation = direction === 'above' ? 'above' : 'below';
      warnings.push(
        `${label} alert enter (${effectiveEnter}) is not ${relation} clear (${effectiveClear}); the alert will flap or never clear.`
      );
    }
  }

  // Webhook config. The dispatcher accepts a comma-separated list, so validate
  // each target the same way it splits them.
  if (isSet(env.ALERT_WEBHOOK_URL)) {
    const urls = env.ALERT_WEBHOOK_URL.split(',')
      .map(url => url.trim())
      .filter(Boolean);
    const invalid = urls.filter(url => {
      try {
        new URL(url);
        return false;
      } catch {
        return true;
      }
    });
    if (invalid.length > 0) {
      warnings.push(
        `ALERT_WEBHOOK_URL has invalid target(s): ${invalid.join(', ')}; those notifications will not be delivered.`
      );
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

  // IDLE_TICK_MS — must be a positive interval. A non-numeric value falls back
  // to 15000, but a zero/negative one passes Number() and makes setTimeout fire
  // immediately, running the collectors in a tight loop while idle.
  if (isSet(env.IDLE_TICK_MS) && (!isNumeric(env.IDLE_TICK_MS) || Number(env.IDLE_TICK_MS) <= 0)) {
    warnings.push(`IDLE_TICK_MS "${env.IDLE_TICK_MS}" is not a positive number; using the 15000ms default.`);
  }

  // A token that is too short offers little protection.
  if (isSet(env.API_AUTH_TOKEN) && env.API_AUTH_TOKEN.length < 16) {
    warnings.push(
      'API_AUTH_TOKEN is shorter than 16 characters; consider a longer secret (e.g. openssl rand -hex 32).'
    );
  }

  return warnings;
}
