import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isFreshSignedUrl,
  isIosBrowser,
  resolveApiUrl,
  signedUrlExpiry,
  withDownload,
} from "../src/shared/signed-url.ts";

const API = "https://corgi.example.ts.net";
const SIGNED = "/api/files/abc/content?owner=local-user&expires=1900000000000&signature=deadbeef";

test("server links are loaded from the API the app talks to, however the server names itself", () => {
  // The server signed with its own public URL; the phone reached it another way.
  assert.equal(resolveApiUrl(`http://localhost:8787${SIGNED}`, API), `${API}${SIGNED}`);
  assert.equal(resolveApiUrl(`${API}${SIGNED}`, API), `${API}${SIGNED}`);
  assert.equal(resolveApiUrl("/api/files/abc/content", `${API}/`), `${API}/api/files/abc/content`);
  // Links elsewhere, or not signed by the server, are not touched.
  assert.equal(resolveApiUrl("https://example.com/api/x", API), "https://example.com/api/x");
  assert.equal(resolveApiUrl(`https://example.com${SIGNED}`, API), `${API}${SIGNED}`);
  assert.equal(
    resolveApiUrl("http://localhost:8787/api/files/abc/content", API),
    "http://localhost:8787/api/files/abc/content",
  );
  assert.equal(
    resolveApiUrl("https://example.com/report.pdf", API),
    "https://example.com/report.pdf",
  );
  assert.equal(resolveApiUrl("data:image/png;base64,AAAA", API), "data:image/png;base64,AAAA");
  assert.equal(resolveApiUrl("http://[bad", API), "http://[bad");
});

test("a signed link says when it stops working", () => {
  assert.equal(signedUrlExpiry(SIGNED), 1900000000000);
  assert.equal(signedUrlExpiry("/api/files/abc/content"), undefined);
  assert.equal(signedUrlExpiry("/api/files/abc/content?expires=1900000000000"), undefined);
  assert.equal(signedUrlExpiry(""), undefined);
  const now = 1900000000000 - 5 * 60_000;
  assert.equal(isFreshSignedUrl(SIGNED, now), true);
  assert.equal(isFreshSignedUrl(SIGNED, now, 6 * 60_000), false);
  assert.equal(isFreshSignedUrl(SIGNED, 1900000000000 + 1), false);
  // Unsigned links are never fresh: nothing but the session could open them.
  assert.equal(isFreshSignedUrl("/api/files/abc/content", now), false);
});

test("the download flag is added after whatever query the link has", () => {
  assert.equal(withDownload(SIGNED), `${SIGNED}&download=1`);
  assert.equal(withDownload("/api/files/abc/content"), "/api/files/abc/content?download=1");
});

test("iOS browsers are told apart, including an iPad that calls itself a Mac", () => {
  assert.equal(isIosBrowser("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari"), true);
  assert.equal(isIosBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 5), true);
  assert.equal(isIosBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 0), false);
  assert.equal(isIosBrowser("Mozilla/5.0 (Windows NT 10.0) Chrome"), false);
  assert.equal(isIosBrowser("Mozilla/5.0 (Linux; Android 14) Chrome", 5), false);
});
