import {
  HybridSignalingAdapter,
  ServerlessSignalingAdapter,
  WebSocketSignalingAdapter,
} from '../src/lib/webrtc/signalingAdapter';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
}

async function run() {
  console.log('Testing Signaling Adapters & Hybrid Fallback...');

  // 1. Test Serverless Adapter initialization & deterministic room ID
  console.log('Test 1: ServerlessSignalingAdapter');
  let serverlessOpened = false;
  let serverlessCreated = false;

  const serverless = new ServerlessSignalingAdapter({
    onOpen: () => {
      serverlessOpened = true;
    },
    onMessage: (msg) => {
      if (msg.type === 'room-created') {
        serverlessCreated = true;
      }
    },
  });

  assert(serverless.mode === 'serverless', 'Mode must be serverless');
  await serverless.connect('TEST99', true);

  await new Promise((r) => setTimeout(r, 100));
  assert(serverlessOpened, 'Serverless adapter should open on connect');
  assert(serverlessCreated, 'Serverless adapter creator should receive room-created');

  serverless.close();
  console.log('✓ ServerlessSignalingAdapter verified');

  // 2. Test Hybrid Adapter with unreachable WebSocket URL (triggers fallback to serverless)
  console.log('Test 2: HybridSignalingAdapter automatic fallback when server unresponsive');
  let fallbackReason = '';
  let fallbackMode = '';
  let hybridOpened = false;
  let hybridRoomCreated = false;

  // Point to a non-existent port with 300ms fallback timeout for testing
  const hybrid = new HybridSignalingAdapter(
    'ws://127.0.0.1:59999',
    {
      onOpen: () => {
        hybridOpened = true;
      },
      onMessage: (msg) => {
        if (msg.type === 'room-created') {
          hybridRoomCreated = true;
        }
      },
      onFallback: (reason, mode) => {
        fallbackReason = reason;
        fallbackMode = mode;
      },
    },
    300, // 300ms fallback for fast test
  );

  await hybrid.connect('HYBR1D', true);
  // Wait for fallback
  await new Promise((r) => setTimeout(r, 450));

  assert(hybrid.mode === 'serverless', `Hybrid mode should switch to serverless, got: ${hybrid.mode}`);
  assert(fallbackMode === 'serverless', `Fallback mode should be serverless, got: ${fallbackMode}`);
  assert(fallbackReason.length > 0, 'Fallback reason should be recorded');
  assert(hybridOpened, 'Hybrid should open via serverless fallback');
  assert(hybridRoomCreated, 'Hybrid creator should receive room-created via serverless');

  hybrid.close();
  console.log('✓ HybridSignalingAdapter 300ms fallback to serverless verified');

  console.log('\nALL SIGNALING ADAPTER TESTS PASSED!');
  process.exit(0);
}

run().catch((err) => {
  console.error('Signaling test failed:', err);
  process.exit(1);
});
