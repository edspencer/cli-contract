// A local npm registry, just enough of one for `update` (SPEC §5 step 3): it serves one package's versions from
// tarballs on disk and sends everything else to the real registry with a redirect, so the package's dependencies
// install as they always do.
//
//   GET /-/package/<name>/dist-tags   the dist-tags
//   GET /<name>                       the packument (npm install, npm cache add)
//   GET /<name>/<version>             one version's manifest (`engines`)
//   GET /-/tarball/<version>.tgz      the tarball
//
// A scoped name arrives as `@scope%2fname` (`update` writes that) or `@scope/name` (npm does); both work. It runs in
// the runner's process, which is safe because the runner's commands are spawned asynchronously: a runner that blocked
// on a synchronous spawn couldn't answer its own server, and the tool would read the timeout as "no registry".

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface PackageVersion {
  tarball: string;
  /**
   * The package's own package.json. A made-up manifest is a valid one: npm installs the files, writes no bin shim,
   * resolves no dependencies, and exits 0, and the tool then fails for a reason that isn't its own.
   */
  manifest: Record<string, unknown>;
}

export interface FakeRegistry {
  url: string;
  name: string;
  distTags: Record<string, string>;
  versions: Record<string, PackageVersion>;
  /** What was asked, for a failure's evidence. */
  requests: string[];
  close(): Promise<void>;
}

const decodeName = (s: string) => decodeURIComponent(s).replace(/%2f/gi, '/');

/** `/<name>` or `/<name>/<version>`, for both spellings of a scoped name. */
function packageRequest(pathname: string): { name: string; version?: string } | undefined {
  const segs = pathname.slice(1).split('/').filter(Boolean);
  if (segs.length === 0) return undefined;
  if (segs[0].startsWith('@') && !/%2f/i.test(segs[0])) {
    return segs.length === 2 || segs.length === 3 ? { name: `${segs[0]}/${segs[1]}`, ...(segs[2] !== undefined ? { version: segs[2] } : {}) } : undefined;
  }
  return segs.length <= 2 ? { name: segs[0], ...(segs[1] !== undefined ? { version: segs[1] } : {}) } : undefined;
}

export async function startFakeRegistry(o: { name: string; upstream?: string }): Promise<FakeRegistry> {
  const upstream = (o.upstream ?? 'https://registry.npmjs.org').replace(/\/+$/, '');
  const digests = new Map<string, { shasum: string; integrity: string }>();
  const dist = (version: string, tarball: string) => {
    let d = digests.get(tarball);
    if (d === undefined) {
      const bytes = fs.readFileSync(tarball);
      d = {
        shasum: crypto.createHash('sha1').update(bytes).digest('hex'),
        integrity: `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`,
      };
      digests.set(tarball, d);
    }
    return { tarball: `${reg.url}/-/tarball/${encodeURIComponent(version)}.tgz`, ...d };
  };
  const manifestFor = (version: string) => {
    const v = reg.versions[version];
    return v === undefined ? undefined : { ...v.manifest, name: o.name, version, dist: dist(version, v.tarball) };
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    reg.requests.push(`${req.method} ${url.pathname}`);
    const send = (body: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const notFound = () => res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');

    const tar = /^\/-\/tarball\/(.+)\.tgz$/.exec(url.pathname);
    if (tar !== null) {
      const v = reg.versions[decodeURIComponent(tar[1])];
      if (v === undefined) return notFound();
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      fs.createReadStream(v.tarball).pipe(res);
      return;
    }
    const tags = /^\/-\/package\/(.+)\/dist-tags$/.exec(url.pathname);
    if (tags !== null && decodeName(tags[1]) === o.name) return send(reg.distTags);
    const pkg = tags === null ? packageRequest(url.pathname) : undefined;
    if (pkg !== undefined && decodeName(pkg.name) === o.name) {
      if (pkg.version !== undefined) {
        const m = manifestFor(decodeURIComponent(pkg.version));
        return m === undefined ? notFound() : send(m);
      }
      return send({ name: o.name, 'dist-tags': reg.distTags, versions: Object.fromEntries(Object.keys(reg.versions).map((v) => [v, manifestFor(v)])) });
    }
    // Not our package: the real registry. Its tarball URLs point upstream, so dependencies never come back here.
    res.writeHead(302, { location: `${upstream}${req.url ?? '/'}` }).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const reg: FakeRegistry = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    name: o.name,
    distTags: {},
    versions: {},
    requests: [],
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
  return reg;
}
