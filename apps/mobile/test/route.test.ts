import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodePolyline,
  distanceLine,
  encodePolyline,
  fitPath,
  mapsUrlOf,
  polylineOf,
  routeOf,
  timingLine,
} from "../src/features/routes/route.ts";

test("decodes Google's documented example polyline", () => {
  assert.deepEqual(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    [38.5, -120.2],
    [40.7, -120.95],
    [43.252, -126.453],
  ]);
});

test("encode and decode round-trip; malformed input stops early", () => {
  const points: [number, number][] = [
    [-23.5613, -46.6565],
    [-23.5701, -46.6612],
    [-23.6267, -46.6554],
  ];
  assert.deepEqual(decodePolyline(encodePolyline(points)), points);
  assert.deepEqual(decodePolyline(""), []);
  assert.deepEqual(decodePolyline("_p~iF"), []);
  assert.equal(decodePolyline("_p~iF~ps|U\u0001\u0001").length, 1);
});

test("fitPath keeps the shape inside the padded box, centered", () => {
  // A north-south line: tall, so it centers horizontally.
  const path = fitPath(
    [
      [-23.5, -46.6],
      [-23.6, -46.6],
    ],
    300,
    160,
    20,
  );
  assert.ok(path);
  assert.deepEqual(path.start, { x: 150, y: 20 });
  assert.deepEqual(path.end, { x: 150, y: 140 });
  assert.equal(path.d, "M150 20 L150 140");
  // East-west: wide, fills the width, centered vertically.
  const wide = fitPath(
    [
      [0, 0],
      [0, 1],
    ],
    300,
    160,
    20,
  );
  assert.deepEqual(wide?.start, { x: 20, y: 80 });
  assert.deepEqual(wide?.end, { x: 280, y: 80 });
});

test("fitPath drops invisible points, keeps the end, and refuses degenerate input", () => {
  const points: [number, number][] = [[0, 0]];
  for (let i = 1; i <= 1000; i++) points.push([0, i / 1000]);
  const path = fitPath(points, 300, 160);
  assert.ok(path);
  assert.ok(path.d.split("L").length < 600);
  assert.deepEqual(path.end, { x: 280, y: 80 });
  assert.equal(fitPath([[1, 1]], 300, 160), undefined);
  assert.equal(
    fitPath(
      [
        [1, 1],
        [1, 1],
      ],
      300,
      160,
    ),
    undefined,
  );
  assert.equal(
    fitPath(
      [
        [0, 0],
        [1, 1],
      ],
      30,
      30,
    ),
    undefined,
  );
});

test("route lines and the Maps link", () => {
  const route = routeOf({
    from: "Av. Paulista, 1000",
    to: "Aeroporto de Congonhas",
    duration: "26 min",
    distance: "10,7 km",
    via: "via Av. Bandeirantes",
    leaveBy: "09:15",
    arriveBy: "09:45",
  });
  assert.ok(route);
  assert.equal(route.mode, "driving");
  assert.equal(distanceLine(route), "10,7 km · via Av. Bandeirantes");
  assert.equal(timingLine(route), "Saia até 09:15 para chegar 09:45");
  assert.equal(timingLine({ ...route, arriveBy: undefined }), "Saia até 09:15");
  assert.equal(timingLine({ ...route, leaveBy: undefined }), "Chegada prevista às 09:45");
  assert.equal(
    mapsUrlOf('{"shown":true,"mapsUrl":"https://www.google.com/maps/dir/?api=1&x=1"}', route),
    "https://www.google.com/maps/dir/?api=1&x=1",
  );
  assert.match(mapsUrlOf(undefined, route), /origin=Av\.%20Paulista%2C%201000&destination=/);
  assert.match(mapsUrlOf({ mapsUrl: "javascript:alert(1)" }, route), /^https:\/\/www\.google/);
  assert.equal(routeOf({ from: "A" }), undefined);
});

test("the server's polyline is used when the tool call had none", () => {
  assert.equal(polylineOf({ shown: true, polyline: "_p~iF~ps|U_ulLnnqC" }), "_p~iF~ps|U_ulLnnqC");
  assert.equal(polylineOf('{"shown":true}'), undefined);
});
