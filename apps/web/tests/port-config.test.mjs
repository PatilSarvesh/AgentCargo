import assert from "node:assert/strict";
import test from "node:test";
import { addConfiguredPort, parseConfiguredPort } from "../build/port-config.mjs";

test("uses the default port when no override is configured", () => {
  assert.equal(parseConfiguredPort(undefined), undefined);
  assert.deepEqual(addConfiguredPort([], undefined), []);
});

test("adds a configured port without overriding explicit CLI flags", () => {
  assert.deepEqual(addConfiguredPort(["--host", "localhost"], "3101"), ["--host", "localhost", "--port", "3101"]);
  assert.deepEqual(addConfiguredPort(["--port", "3200"], "3101"), ["--port", "3200"]);
  assert.deepEqual(addConfiguredPort(["--port=3200"], "3101"), ["--port=3200"]);
});

test("rejects invalid port overrides", () => {
  assert.throws(() => parseConfiguredPort("3000abc"), /AGENTCARGO_WEB_PORT/);
  assert.throws(() => parseConfiguredPort("0"), /AGENTCARGO_WEB_PORT/);
  assert.throws(() => parseConfiguredPort("65536"), /AGENTCARGO_WEB_PORT/);
});
