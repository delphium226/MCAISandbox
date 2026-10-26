/**
 * The cathedral's tier-2 palette checked offline (#162): scripts/checks/gothic_gen.mts with `detail` (its header says
 * what is checked). A unit of its own so check:offline runs both the plain and the detailed cathedral.
 * Usage: node_modules/.bin/tsx scripts/checks/gothic_detail.mts [OUT_DIR]
 */
process.env.GOTHIC_DETAIL = '1';
await import('./gothic_gen.mts');
