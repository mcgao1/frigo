/**
 * Tests for the voyage module (one-way planet relocation), run against mocked A
 * ports. Run with `node --test src/game/voyage/voyage.test.js` from app/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createVoyageModule, VoyageErrorCode, VOYAGE_COST, DEFAULT_PLANETS } from "./voyage.js";
import { createMockDeps, createMockWalletWithTransactions, createMockStorage, createMockClock } from "./mocks.js";

const READY = () => true;

test("init starts on the first planet with no arrivals", async () => {
  const v = createVoyageModule(createMockDeps(), { requirementsMet: READY });
  const s = await v.init();
  assert.equal(s.planetIndex, 0);
  assert.equal(s.planet.id, DEFAULT_PLANETS[0].id);
  assert.equal(s.nextPlanet.id, DEFAULT_PLANETS[1].id);
  assert.equal(s.cost, VOYAGE_COST);
  assert.deepEqual(s.arrivals, []);
});

test("listPlanets marks reached and current", async () => {
  const v = createVoyageModule(createMockDeps(), { requirementsMet: READY });
  await v.init();
  const ps = v.listPlanets();
  assert.equal(ps[0].current, true);
  assert.equal(ps[0].reached, true);
  assert.equal(ps[1].reached, false);
});

test("depart is blocked until prerequisites are met (NOT_READY), and changes nothing", async () => {
  const deps = createMockDeps({ balance: 300 });
  let ready = false;
  const v = createVoyageModule(deps, { requirementsMet: () => ready });
  await v.init();

  await assert.rejects(() => v.depart(), (e) => {
    assert.equal(e.code, VoyageErrorCode.NOT_READY);
    return true;
  });
  assert.equal(v.getState().planetIndex, 0);
  assert.equal(deps.wallet.getBalance(), 300);

  ready = true; // prerequisites now satisfied
  const r = await v.depart();
  assert.equal(r.ok, true);
  assert.equal(v.getState().planetIndex, 1);
});

test("a ready depart pays the fare, moves one planet, and logs the arrival", async () => {
  const deps = createMockDeps({ balance: 300 });
  const v = createVoyageModule(deps, { requirementsMet: READY });
  await v.init();

  const r = await v.depart();
  assert.equal(r.planet.id, DEFAULT_PLANETS[1].id);
  assert.equal(r.planetIndex, 1);
  assert.equal(r.balance, 300 - VOYAGE_COST);
  assert.equal(deps.wallet.getBalance(), 300 - VOYAGE_COST);
  assert.equal(deps.ledger[0].reason, `voyage:depart:${DEFAULT_PLANETS[1].id}`);

  const s = v.getState();
  assert.equal(s.planet.id, DEFAULT_PLANETS[1].id);
  assert.equal(s.arrivals.length, 1);
  assert.equal(s.arrivals[0].planetId, DEFAULT_PLANETS[1].id);
});

test("insufficient funds blocks depart and changes nothing", async () => {
  const deps = createMockDeps({ balance: VOYAGE_COST - 1 });
  const v = createVoyageModule(deps, { requirementsMet: READY });
  await v.init();

  await assert.rejects(() => v.depart(), (e) => {
    assert.equal(e.code, VoyageErrorCode.INSUFFICIENT_FUNDS);
    return true;
  });
  assert.equal(v.getState().planetIndex, 0);
  assert.equal(deps.wallet.getBalance(), VOYAGE_COST - 1);
});

test("a failed transaction leaves the fridge where it was", async () => {
  const money = createMockWalletWithTransactions(300);
  const v = createVoyageModule({
    wallet: money.wallet,
    transaction: { execute: () => ({ ok: false, balance: 300 }) },
    gameStorage: createMockStorage(),
    clock: createMockClock(),
  }, { requirementsMet: READY });
  await v.init();

  await assert.rejects(() => v.depart(), (e) => {
    assert.equal(e.code, VoyageErrorCode.TRANSACTION_FAILED);
    return true;
  });
  assert.equal(v.getState().planetIndex, 0);
});

test("departing past the last planet throws NO_NEXT_PLANET", async () => {
  const deps = createMockDeps({ balance: 300 });
  const v = createVoyageModule(deps, { requirementsMet: READY });
  await v.init();

  for (let i = 0; i < DEFAULT_PLANETS.length - 1; i++) await v.depart();
  assert.equal(v.getState().planetIndex, DEFAULT_PLANETS.length - 1);
  assert.equal(v.nextPlanet(), null);

  await assert.rejects(() => v.depart(), (e) => {
    assert.equal(e.code, VoyageErrorCode.NO_NEXT_PLANET);
    return true;
  });
});

test("planet and arrivals persist and reload across instances", async () => {
  const storage = createMockStorage();
  const money = createMockWalletWithTransactions(300);
  const base = () => ({
    wallet: money.wallet,
    transaction: money.transaction,
    gameStorage: storage,
    clock: createMockClock("2026-11-11"),
  });

  const a = createVoyageModule(base(), { requirementsMet: READY });
  await a.init();
  await a.depart();

  const b = createVoyageModule(base(), { requirementsMet: READY });
  const s = await b.init();
  assert.equal(s.planetIndex, 1);
  assert.equal(s.arrivals.length, 1);
  assert.equal(s.arrivals[0].at, "2026-11-11");
});
