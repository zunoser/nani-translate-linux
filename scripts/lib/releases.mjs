import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export const MANIFEST_URL = 'https://nani-desktop.kiok.jp/artifacts/latest-mac.yml';

export function validateRelease(release) {
  if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(release?.version ?? '')) throw new Error('Invalid release version');
  const { url, sha512 } = release.dmg ?? {};
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.pathname.endsWith('.dmg')) throw new Error('DMG URL must use HTTPS and end in .dmg');
  if (typeof sha512 !== 'string' || Buffer.from(sha512, 'base64').length !== 64 || Buffer.from(sha512, 'base64').toString('base64') !== sha512) throw new Error('Invalid DMG SHA-512');
  return { version: release.version, dmg: { url: parsed.href, sha512 } };
}

export function releaseFromManifest(text, manifestUrl = MANIFEST_URL) {
  const manifest = parse(text);
  const dmgs = (Array.isArray(manifest?.files) ? manifest.files : []).filter(file => typeof file?.url === 'string' && file.url.toLowerCase().endsWith('.dmg'));
  if (dmgs.length !== 1) throw new Error(`expected exactly one DMG in manifest, found ${dmgs.length}`);
  return validateRelease({ version: manifest.version, dmg: { url: new URL(dmgs[0].url, manifestUrl).href, sha512: dmgs[0].sha512 } });
}

export function releaseId(release) {
  return createHash('sha256').update(JSON.stringify(validateRelease(release))).digest('hex');
}

export async function latestRelease(url = process.env.NANI_MANIFEST_URL || MANIFEST_URL) {
  if (new URL(url).protocol !== 'https:') throw new Error('Manifest URL must use HTTPS');
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (response.ok) break;
      if (response.status < 500 && response.status !== 429) throw new Error(`HTTP ${response.status}`);
      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (attempt === 2) throw new Error(`Manifest unavailable: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  return releaseFromManifest(await response.text(), url);
}

export function readRelease(file) {
  return validateRelease(JSON.parse(readFileSync(file, 'utf8')));
}
