/**
 * The pool of human first names for village members (the user's, 10-18 s36): 50 names, each a valid Minecraft username
 * (3-16 letters), none clashing with Mayor, Gus, Worker1-24 or the user's own account. All are on the whitelist of every
 * world (main, test 1, test 2). Not yet used by the code: PLAN.md Phase N "To consider" (a unique first name per worker).
 */
export const NAME_POOL: readonly string[] = [
  'Ada', 'Ben', 'Clara', 'Dev', 'Elena', 'Finn', 'Grace', 'Hugo', 'Iris', 'Jonah',
  'Kai', 'Lena', 'Milo', 'Nora', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Sam', 'Tess',
  'Uma', 'Victor', 'Wren', 'Xavier', 'Yara', 'Zane', 'Amara', 'Bruno', 'Cleo', 'Dante',
  'Eva', 'Felix', 'Gemma', 'Hamid', 'Ines', 'Jasper', 'Keiko', 'Leo', 'Maya', 'Nico',
  'Olivia', 'Pablo', 'Rhea', 'Silas', 'Tomas', 'Ursula', 'Vera', 'Wes', 'Yusuf', 'Zoe',
];
