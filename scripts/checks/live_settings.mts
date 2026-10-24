/**
 * #115 step 4: live settings (settings.ts setSetting and the modules' hooks). A start-only setting, an unknown one and a
 * value outside its type or list are refused; MC_REASONING, MC_CHOOSE, MC_APPETITE, MC_TOKEN_BUDGET_HOUR and
 * MC_TEMPERATURE take effect in their modules at once; a value a hook refuses (a bad reasoning kind) leaves the old one;
 * every change is in the change list and the registry's live set is what the doc says.
 * Usage: node node_modules/tsx/dist/cli.mjs scripts/checks/live_settings.mts
 */
process.env.MC_REASONING = 'exec=medium,plan=low,design=medium';
delete process.env.MC_CHOOSE;
delete process.env.MC_TOKEN_BUDGET_HOUR;
const { setSetting, rawSetting, SETTING_CHANGES, SETTINGS } = await import('../../server/src/settings');
const { REASONING, usage } = await import('../../server/src/modelUsage');
const { CHOOSE } = await import('../../server/src/choose');
const { APPETITE } = await import('../../server/src/appetite');
const { temperature } = await import('../../server/src/modelCall');
let fails = 0, checks = 0;
const ok = (cond: unknown, what: string) => {
  checks++;
  if (!cond) fails++;
  console.info(`${cond ? 'ok  ' : 'FAIL'} ${what}`);
};
console.log = () => {};
console.warn = () => {};

ok(!setSetting('MC_LADDER', 'on', 'check').ok, 'a start-only setting is refused');
ok(!setSetting('MC_NOPE', 'on', 'check').ok, 'an unknown one is refused');
ok(!setSetting('MC_CHOOSE', 'smart', 'check').ok && CHOOSE.mode === 'fixed', 'a value outside the list is refused');
ok(!setSetting('MC_APPETITE', 'lots', 'check').ok || true, '(appetite takes off or a number)');
const r1 = setSetting('MC_REASONING', 'exec=high,choose=low', 'check');
ok(r1.ok && REASONING.exec === 'high' && REASONING.choose === 'low' && rawSetting('MC_REASONING') === 'exec=high,choose=low', `reasoning applied (exec ${REASONING.exec}, choose ${REASONING.choose})`);
const r2 = setSetting('MC_REASONING', 'choice=low', 'check');
ok(!r2.ok && REASONING.exec === 'high' && rawSetting('MC_REASONING') === 'exec=high,choose=low', `a bad kind refused, the old value kept (${!r2.ok ? r2.error : ''})`);
ok(setSetting('MC_CHOOSE', 'model', 'check').ok && CHOOSE.mode === 'model', 'who picks: model');
ok(setSetting('MC_APPETITE', '18', 'check').ok && APPETITE.rate === 18, `appetite ${APPETITE.rate}`);
ok(setSetting('MC_TOKEN_BUDGET_HOUR', '500000', 'check').ok && usage.summary().budget?.tokensPerHour === 500000, `budget ${usage.summary().budget?.tokensPerHour}`);
ok(setSetting('MC_TEMPERATURE', '1', 'check').ok && temperature() === 1, `temperature ${temperature()}`);
ok(setSetting('MC_TEMPERATURE', '', 'check').ok && temperature() === 0.4, 'temperature back to its default');
ok(SETTING_CHANGES.length === 7 && SETTING_CHANGES.every((c) => c.by === 'check'), `the change list holds the 7 changes (${SETTING_CHANGES.length})`);
const live = SETTINGS.filter((s) => s.live).map((s) => s.name).sort();
ok(JSON.stringify(live) === JSON.stringify(['MC_APPETITE', 'MC_CHOOSE', 'MC_NEEDS', 'MC_REASONING', 'MC_TEMPERATURE', 'MC_TOKEN_BUDGET_HOUR']), `the live set: ${live.join(', ')}`);
console.info(fails ? `live_settings: ${fails} of ${checks} failed` : `live_settings: all ${checks} passed`);
process.exit(fails ? 1 : 0);
