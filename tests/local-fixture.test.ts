import assert from "node:assert/strict";
import test from "node:test";
import { isLocalFixtureRequest, localFixtureUser } from "../lib/runtime/local-fixture.ts";

const original = {
  development: process.env.ALPHALENS_LOCAL_DEVELOPMENT,
  fixture: process.env.ALPHALENS_FIXTURE_MODE,
  email: process.env.ALPHALENS_LOCAL_AUTH_EMAIL,
  name: process.env.ALPHALENS_LOCAL_AUTH_NAME,
};

test.after(() => {
  process.env.ALPHALENS_LOCAL_DEVELOPMENT = original.development;
  process.env.ALPHALENS_FIXTURE_MODE = original.fixture;
  process.env.ALPHALENS_LOCAL_AUTH_EMAIL = original.email;
  process.env.ALPHALENS_LOCAL_AUTH_NAME = original.name;
});

test("local fixture identity is limited to loopback requests and .invalid test accounts", () => {
  process.env.ALPHALENS_LOCAL_DEVELOPMENT = "true";
  process.env.ALPHALENS_FIXTURE_MODE = "true";
  process.env.ALPHALENS_LOCAL_AUTH_EMAIL = "developer@local.alphalens.invalid";
  process.env.ALPHALENS_LOCAL_AUTH_NAME = "Fixture Developer";

  const local = new Request("http://localhost:8788/api/v1/research");
  assert.equal(isLocalFixtureRequest(local), true);
  assert.equal(localFixtureUser(local)?.email, "developer@local.alphalens.invalid");
  assert.equal(localFixtureUser(new Request("https://alphalens.example/api/v1/research")), null);

  process.env.ALPHALENS_LOCAL_AUTH_EMAIL = "real@example.com";
  assert.equal(localFixtureUser(local), null);
});
