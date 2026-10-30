import fs from 'fs';
import path from 'path';

// This app's version from package.json (read at runtime so a custom build or
// `npm version` bump is picked up without a rebuild of this module).
export function readAppVersion(cwd: string = process.cwd()): string | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ path.join(cwd, 'package.json'), 'utf-8')
    ) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim() !== '' ? parsed.version : null;
  } catch {
    return null;
  }
}
