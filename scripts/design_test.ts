// Ask an Ollama model for a building design with the real prompt and tool, then validate it.
// Usage: npx tsx scripts/design_test.ts [MODEL=gemma4:31b] ["brief"]
import { DESIGN_SYSTEM, DESIGN_TOOL, validateDesign } from '../server/src/designs';

const [model = 'gemma4:31b', brief = 'a cosy stone cottage with a log frame, about 7x7'] = process.argv.slice(2);
let user = `Design a building named "cottage". Brief: ${brief}`;
for (let attempt = 0; attempt < 2; attempt++) {
  const t0 = Date.now();
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      model, stream: false, think: false, options: { num_ctx: 8192, temperature: 0.4 },
      messages: [{ role: 'system', content: DESIGN_SYSTEM }, { role: 'user', content: user }],
      tools: [{ type: 'function', function: { name: DESIGN_TOOL.name, description: DESIGN_TOOL.description, parameters: DESIGN_TOOL.input_schema } }],
    }),
  });
  const data = (await res.json()) as { message: { content?: string; tool_calls?: Array<{ function: { arguments: Record<string, unknown> } }> } };
  const args = data.message.tool_calls?.[0]?.function.arguments;
  console.log(`attempt ${attempt + 1}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!args) {
    console.log('no tool call; text:', data.message.content?.slice(0, 300));
    user += '\n\nCall submit_design with the design.';
    continue;
  }
  const { design, errors, fixes } = validateDesign(args, "test"); if (fixes?.length) console.log("fixes:", fixes);
  if (design) {
    console.log(`VALID "${design.name}" ${design.width}x${design.depth}x${design.height}, ${design.blocks} blocks: ${design.description}`);
    console.log(JSON.stringify(design.palette));
    design.layers.forEach((l, i) => console.log(`layer ${i}\n  ${l.join('\n  ')}`));
    break;
  }
  console.log('errors:', errors);
  console.log(JSON.stringify(args.palette));
  (args.layers as string[][]).forEach((l, i) => console.log(`layer ${i}\n  ${l.join('\n  ')}`));
  user += `\n\nYour previous design had problems; fix them and submit again:\n- ${errors.join('\n- ')}`;
}
