// A human chat line for E.0's routing check: joins as a plain player (not an agent), teleported near X Z by RCON first
// if given, says TEXT, waits, quits. Usage: node scripts/checks/human_line.cjs NAME PORT "TEXT" [WAIT_S]
const mineflayer = require('mineflayer');
const [name = 'Gus', port = '25566', text = 'Mayor, how is the village coming along?', wait = '20'] = process.argv.slice(2);
const bot = mineflayer.createBot({ host: '127.0.0.1', port: Number(port), username: name, version: '26.1', auth: 'offline' });
bot.on('chat', (from, msg) => console.log(`<${from}> ${msg}`));
bot.once('spawn', () => {
  console.log(`${name} at ${bot.entity.position}`);
  setTimeout(() => {
    bot.chat(text);
    console.log(`said: ${text}`);
    setTimeout(() => bot.quit(), Number(wait) * 1000);
  }, 3000);
});
bot.on('kicked', (r) => console.log('kicked', JSON.stringify(r)));
bot.on('error', (e) => console.log('error', e.message));
bot.on('end', () => process.exit(0));
