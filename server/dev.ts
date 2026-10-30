import './signaling';
import { createServer } from 'vite';

async function main(): Promise<void> {
  const server = await createServer({
    server: { host: '0.0.0.0', port: 5173 },
  });
  await server.listen();

  console.log('\n======================================================');
  console.log('  PINNPOINTT IS RUNNING');
  console.log('  • App URL:          http://localhost:5173');
  console.log('  • Signaling Server: ws://localhost:8787');
  console.log('======================================================\n');
}

main().catch((err) => {
  console.error('Failed to start dev server:', err);
  process.exit(1);
});
