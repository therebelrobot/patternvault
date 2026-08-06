// GitHub REST client for pattern storage.
// Only uses endpoints that send permissive CORS headers, so this runs
// entirely in the browser with no backend proxy.

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(status, message, body) {
    super(`GitHub ${status}: ${message}`);
    this.status = status;
    this.body = body;
  }
}

async function ghFetch(token, path, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new GitHubError(res.status, json?.message ?? res.statusText, json);
  }
  return json;
}

// --- text <-> base64, UTF-8 safe -------------------------------------------

export function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// --- git blob sha ----------------------------------------------------------

// Reproduces `git hash-object` so local content can be compared to a tree
// entry's sha without downloading the blob.
//
// crypto.subtle only exists in secure contexts, and a Pi on the LAN served
// over plain http:// is not one. The pure-JS path keeps sync working there;
// both paths are verified against `git hash-object`.
export async function gitBlobSha(text) {
  const body = new TextEncoder().encode(text);
  const header = new TextEncoder().encode(`blob ${body.length}\0`);
  const buf = new Uint8Array(header.length + body.length);
  buf.set(header, 0);
  buf.set(body, header.length);

  if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-1', buf);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return sha1Hex(buf);
}

export const hasSubtleCrypto = () => typeof crypto !== 'undefined' && !!crypto.subtle?.digest;

// RFC 3174, operating on whole bytes only (git blobs are never bit-aligned).
export function sha1Hex(bytes) {
  const total = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = bytes.length * 8;
  view.setUint32(total - 8, Math.floor(bits / 0x100000000), false);
  view.setUint32(total - 4, bits >>> 0, false);

  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);

  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4, false);
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16];
      w[j] = ((n << 1) | (n >>> 31)) >>> 0;
    }
    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;
    for (let j = 0; j < 80; j++) {
      let f, k;
      if (j < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (j < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const t = (((a << 5) | (a >>> 27)) + (f >>> 0) + e + k + w[j]) >>> 0;
      e = d;
      d = c;
      c = ((b << 30) | (b >>> 2)) >>> 0;
      b = a;
      a = t;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

// --- repo operations -------------------------------------------------------

export const gh = {
  async getUser(token) {
    return ghFetch(token, '/user');
  },

  async getRepo(token, owner, repo) {
    return ghFetch(token, `/repos/${owner}/${repo}`);
  },

  async getRef(token, owner, repo, branch) {
    try {
      return await ghFetch(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`);
    } catch (err) {
      if (err.status === 409) return null; // empty repository
      if (err.status === 404) return null; // branch does not exist yet
      throw err;
    }
  },

  async getCommit(token, owner, repo, sha) {
    return ghFetch(token, `/repos/${owner}/${repo}/git/commits/${sha}`);
  },

  async getTree(token, owner, repo, sha) {
    return ghFetch(token, `/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`);
  },

  async getBlobText(token, owner, repo, sha) {
    const blob = await ghFetch(token, `/repos/${owner}/${repo}/git/blobs/${sha}`);
    if (blob.encoding !== 'base64') throw new Error(`unexpected blob encoding: ${blob.encoding}`);
    return decodeBase64(blob.content);
  },

  async createBlob(token, owner, repo, text) {
    const res = await ghFetch(token, `/repos/${owner}/${repo}/git/blobs`, {
      method: 'POST',
      body: { content: encodeBase64(text), encoding: 'base64' },
    });
    return res.sha;
  },

  async createTree(token, owner, repo, baseTree, entries) {
    return ghFetch(token, `/repos/${owner}/${repo}/git/trees`, {
      method: 'POST',
      body: { base_tree: baseTree, tree: entries },
    });
  },

  async createCommit(token, owner, repo, { message, tree, parents }) {
    return ghFetch(token, `/repos/${owner}/${repo}/git/commits`, {
      method: 'POST',
      body: { message, tree, parents },
    });
  },

  // force stays false so a racing push from another device is rejected
  // instead of silently overwritten.
  async updateRef(token, owner, repo, branch, sha) {
    return ghFetch(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH',
      body: { sha, force: false },
    });
  },

  // Used only to bootstrap an empty repo, where the git data API has no
  // parent commit to build on.
  async putContents(token, owner, repo, branch, path, text, message) {
    return ghFetch(token, `/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      body: { message, content: encodeBase64(text), branch },
    });
  },
};

// Runs jobs with bounded concurrency; GitHub secondary rate limits trip on
// large unbounded bursts.
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
