import { fuelSnapshot } from "../yachy-app/src/offline/fuelSnapshot.ts";
import assert from "node:assert/strict";
export async function runFuelChecks(t, { sql, run, user, vessel, device }) {
  const call = (op) =>
    JSON.parse(
      run(
        `SELECT sync_web_offline_fuel('${vessel}','${device}','${JSON.stringify(op).replaceAll("'", "''")}'::jsonb);`,
      ),
    );
  const tank = crypto.randomUUID(),
    tank2 = crypto.randomUUID();
  const at = new Date(Date.now() - 60000).toISOString();
  sql(
    `SET request.jwt.claim.sub='${user}'; INSERT INTO fuel_tanks(id,vessel_id,name,capacity_litres,created_at) VALUES('${tank}','${vessel}','Port',1000,now()-interval '2 days'),('${tank2}','${vessel}','Starboard',1000,now()-interval '2 days');`,
  );
  const operation = (feature, fields, entries = []) => {
    const id = crypto.randomUUID();
    return {
      id: crypto.randomUUID(),
      recordId: id,
      feature,
      kind: "create",
      baseRevision: null,
      value: {
        id,
        vessel_id: vessel,
        source_id: null,
        fields,
        entries,
        server: {},
        amendment_reason: "",
      },
    };
  };
  const receipt = operation(
    "fuelLogs",
    {
      location_of_refueling: "Synthetic harbour",
      log_date: at.slice(0, 10),
      log_time: at.slice(11, 19),
      amount_of_fuel: 10,
      price_per_gallon: 2,
      total_price: 20,
      volume_unit: "LITRES",
      price_volume_unit: "LITRES",
      currency_code: "USD",
      comment: "Offline fixture",
      effective_at: at,
      utc_offset_minutes: 0,
    },
    [{ fuel_tank_id: tank, amount_litres: 10 }],
  );
  const edit = (op, res, fields) => ({
    ...op,
    id: crypto.randomUUID(),
    kind: "update",
    baseRevision: res.revision,
    value: {
      ...res.value,
      fields: { ...res.value.fields, ...fields },
      amendment_reason: "Corrected test record",
    },
  });
  let saved;
  await t.test(
    "fuel: receipt replays once, preserves standalone accounting and stable device ID",
    () => {
      saved = call(receipt);
      assert.equal(saved.status, "applied");
      assert.equal(saved.value.id, receipt.recordId);
      assert.notEqual(saved.value.source_id, receipt.recordId);
      assert.deepEqual(call(receipt), saved);
      assert.equal(sql("SELECT count(*) FROM fuel_logs"), "1");
      assert.equal(sql("SELECT count(*) FROM fuel_inventory_operations"), "0");
      const rows = JSON.parse(
        run(
          `SELECT read_web_offline_fuel('${vessel}','${device}','fuelLogs');`,
        ),
      );
      assert.deepEqual(rows, [
        { value: saved.value, revision: saved.revision },
      ]);
      assert.throws(() => run("SELECT * FROM offline_private.fuel_aliases"));
    },
  );
  await t.test(
    "fuel: amendments reject stale revisions and crew role loss",
    () => {
      const amendment = edit(receipt, saved, { comment: "Correction" });
      const updated = call(amendment);
      assert.equal(updated.status, "applied");
      assert.deepEqual(call(amendment), updated);
      assert.equal(
        call(edit(receipt, saved, { comment: "Old edit" })).status,
        "conflict",
      );
      sql(`UPDATE users SET role='CREW' WHERE id='${user}'`);
      assert.equal(
        call(edit(receipt, updated, { comment: "Unauthorized" })).status,
        "forbidden",
      );
      sql(`UPDATE users SET role='CAPTAIN_MOV' WHERE id='${user}'`);
    },
  );
  await t.test(
    "fuel: complete context uses original inventory RPC, no null as-of",
    () => {
      const c = JSON.parse(
        run(`SELECT read_web_offline_fuel_context('${vessel}','${device}');`),
      );
      assert.equal(c.tanks.length, 2);
      assert.equal(c.snapshot.status.activated, false);
    },
  );
  let sounding;
  await t.test(
    "fuel: activation then sounding and consumption use original ledger balance constraints",
    () => {
      run(
        `SELECT activate_vessel_fuel_inventory('${vessel}','${at}',0::smallint,'[{"fuel_tank_id":"${tank}","amount_litres":100},{"fuel_tank_id":"${tank2}","amount_litres":0}]'::jsonb,'fixture','${crypto.randomUUID()}');`,
      );
      const entry = operation("fuelEntries", {
        operation_type: "SOUNDING",
        effective_at: new Date().toISOString(),
        utc_offset_minutes: 0,
        fuel_tank_id: tank,
        amount_litres: 110,
        location: "At sea",
        reason: "",
        notes: "",
      });
      sounding = call(entry);
      assert.equal(sounding.status, "applied");
      assert.deepEqual(call(entry), sounding);
      assert.equal(sounding.value.fields.amount_litres, 110);
      const excessive = operation("fuelEntries", {
        ...entry.value.fields,
        operation_type: "CONSUMPTION",
        amount_litres: 999,
      });
      assert.equal(call(excessive).status, "conflict");
      const valid = {
        ...excessive,
        id: crypto.randomUUID(),
        value: {
          ...excessive.value,
          fields: { ...excessive.value.fields, amount_litres: 10 },
        },
      };
      assert.equal(call(valid).status, "applied");
      const amended = call(edit(entry, sounding, { amount_litres: 120 }));
      assert.equal(amended.status, "applied");
      assert.equal(amended.value.id, sounding.value.id);
      assert.notEqual(amended.value.source_id, sounding.value.source_id);
    },
  );
  await t.test(
    "fuel: transfers apply once; over-capacity transfers and foreign tank references stay uncommitted",
    () => {
      const transfer = operation("fuelTransfers", {
        source_tank_id: tank,
        destination_tank_id: tank2,
        amount_litres: 5,
        transfer_date: at.slice(0, 10),
        transfer_time: new Date().toISOString().slice(11, 19),
        effective_at: new Date().toISOString(),
        utc_offset_minutes: 0,
        location: "At sea",
        notes: "",
      });
      const result = call(transfer);
      assert.equal(result.status, "applied");
      assert.deepEqual(call(transfer), result);
      assert.equal(sql("SELECT count(*) FROM fuel_transfers"), "1");
      assert.equal(
        call(edit(transfer, result, { amount_litres: 6 })).status,
        "applied",
      );
      const bad = operation("fuelTransfers", {
        ...transfer.value.fields,
        amount_litres: 2000,
      });
      assert.equal(call(bad).status, "conflict");
      assert.equal(sql("SELECT count(*) FROM fuel_transfers"), "1");
      const foreign = operation("fuelEntries", {
        ...sounding.value.fields,
        fuel_tank_id: crypto.randomUUID(),
      });
      assert.equal(call(foreign).status, "conflict");
    },
  );
  await t.test(
    "fuel: local tank replay matches the authoritative ledger after amendments",
    () => {
      const c = JSON.parse(
        run(`SELECT read_web_offline_fuel_context('${vessel}','${device}')`),
      );
      const local = fuelSnapshot(c, c.snapshot.as_of);
      assert.equal(local.total_balance_litres, c.snapshot.total_balance_litres);
      for (const tank of c.snapshot.tanks) {
        const l = local.tanks.find((t) => t.id === tank.id);
        assert.equal(l.balance_litres, tank.balance_litres);
        assert.equal(l.initialized, tank.initialized);
      }
    },
  );
  await t.test(
    "fuel: missing operation kind and unknown allocation keys cannot write",
    () => {
      assert.throws(() =>
        call({ ...receipt, id: crypto.randomUUID(), kind: null }),
      );
      assert.throws(() =>
        call({
          ...receipt,
          id: crypto.randomUUID(),
          value: {
            ...receipt.value,
            entries: [
              { fuel_tank_id: tank, amount_litres: 10, unexpected: true },
            ],
          },
        }),
      );
    },
  );
}
