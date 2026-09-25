import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decodePolyline, fitZoom, StaticMaps } from "../apps/server/src/maps/static-map.ts";

test("Google's documented polyline decodes to its three points", () => {
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test("a city trip gets a street-level zoom, a long trip a wider one", () => {
  const city = decodePolyline("dqynCpuv{Gs@|@YWmIeInLeOj@y@e@UiJwHy@m@qBcBhAmHzBqOqB");
  assert.ok(fitZoom(city, 360, 200) >= 13);
  assert.ok(fitZoom(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), 360, 200) <= 7);
});

test("the map picture is drawn without tiles when they fail, then served from cache", async () => {
  const dir = await mkdtemp(join(tmpdir(), "corgi-map-"));
  let calls = 0;
  const maps = new StaticMaps(
    { dataDir: dir } as never,
    (async () => {
      calls++;
      return new Response("nope", { status: 503 });
    }) as unknown as typeof fetch,
  );
  const line = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
  const png = await maps.render(line);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  const before = calls;
  await maps.render(line);
  assert.equal(calls, before);
  await rm(dir, { recursive: true, force: true });
});
