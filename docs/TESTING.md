# 🧪 Comprehensive Testing Guide

## Testing Strategy Overview

### Testing Pyramid
```
         /\          E2E Tests (10%)
        /  \         - Critical user flows
       /    \        - Mobile app testing
      /      \       
     /--------\      Integration Tests (30%)
    / Contract \     - API integration
   /   Tests    \    - WebSocket testing
  /              \   - Smart contract interaction
 /----------------\  
/   Unit Tests     \ Unit Tests (60%)
--------------------  - Business logic
                     - Utility functions
                     - Component testing
```

## 1. Backend Testing

### 1.1 Unit Tests
```typescript
// backend/src/services/__tests__/XPService.test.ts
import { XPService } from '../XPService';
import { createMockPool } from '../../test-utils/mockDb';
import { createMockRedis } from '../../test-utils/mockRedis';

describe('XPService', () => {
  let xpService: XPService;
  let mockPool: any;
  let mockRedis: any;
  
  beforeEach(() => {
    mockPool = createMockPool();
    mockRedis = createMockRedis();
    xpService = new XPService(mockPool, mockRedis);
  });
  
  describe('awardXP', () => {
    it('should award XP for first trade', async () => {
      const userId = 1;
      const actionType = 'first_trade';
      
      mockPool.query.mockResolvedValueOnce({ rows: [] }); // Check first trade
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Insert XP log
      mockPool.query.mockResolvedValueOnce({ 
        rows: [{ xp_total: 100, level: 1 }] 
      }); // Update stats
      
      const result = await xpService.awardXP(userId, actionType);
      
      expect(result).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO xp_logs'),
        expect.arrayContaining([userId, actionType, 100])
      );
    });
    
    it('should respect cooldowns', async () => {
      const userId = 1;
      const actionType = 'daily_login';
      
      // Set cooldown in Redis
      mockRedis.exists.mockResolvedValueOnce(1);
      
      const result = await xpService.awardXP(userId, actionType);
      
      expect(result).toBe(false);
      expect(mockPool.query).not.toHaveBeenCalled();
    });
    
    it('should calculate level correctly', () => {
      const testCases = [
        { xp: 0, expectedLevel: 1 },
        { xp: 99, expectedLevel: 1 },
        { xp: 100, expectedLevel: 2 },
        { xp: 999, expectedLevel: 4 },
        { xp: 10000, expectedLevel: 10 },
      ];
      
      testCases.forEach(({ xp, expectedLevel }) => {
        const level = xpService['calculateLevel'](xp);
        expect(level).toBe(expectedLevel);
      });
    });
  });
});
```

### 1.2 Integration Tests
```typescript
// backend/src/__tests__/integration/trading.test.ts
import request from 'supertest';
import { app } from '../../app';
import { connectDatabase } from '../../database/connection';
import { connectRedis } from '../../services/redis';
import { mockExtendedAPI } from '../mocks/extendedAPI';

describe('Trading API Integration', () => {
  beforeAll(async () => {
    await connectDatabase();
    await connectRedis();
    mockExtendedAPI.start();
  });
  
  afterAll(async () => {
    await cleanupDatabase();
    mockExtendedAPI.stop();
  });
  
  describe('POST /api/v1/trading/execute', () => {
    it('should execute a trade successfully', async () => {
      // Setup user
      const token = await createTestUser();
      
      // Mock Extended API response
      mockExtendedAPI.onPost('/v1/trade').reply(200, {
        txHash: '0x123...',
        orderId: 'order-123',
      });
      
      const response = await request(app)
        .post('/api/v1/trading/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          asset: 'BTC',
          direction: 'long',
          size: 100,
        });
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        tradeId: expect.any(Number),
        txHash: expect.stringMatching(/^0x/),
      });
      
      // Verify XP was awarded
      const xpResponse = await request(app)
        .get('/api/v1/xp/stats')
        .set('Authorization', `Bearer ${token}`);
      
      expect(xpResponse.body.totalXP).toBeGreaterThan(0);
    });
    
    it('should handle Extended API failures gracefully', async () => {
      const token = await createTestUser();
      
      // Mock API failure
      mockExtendedAPI.onPost('/v1/trade').reply(503);
      
      const response = await request(app)
        .post('/api/v1/trading/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          asset: 'BTC',
          direction: 'long',
          size: 100,
        });
      
      expect(response.status).toBe(202); // Accepted for retry
      expect(response.body).toMatchObject({
        success: false,
        message: 'Trade queued for execution',
        retryAfter: expect.any(Number),
      });
    });
  });
});
```

### 1.3 WebSocket Tests
```typescript
// backend/src/__tests__/integration/websocket.test.ts
import { WebSocket } from 'ws';
import { createTestServer } from '../utils/testServer';
import { generateAuthToken } from '../utils/auth';

describe('WebSocket Integration', () => {
  let server: any;
  let ws: WebSocket;
  let wsUrl: string;
  
  beforeEach(async () => {
    server = await createTestServer();
    const token = await generateAuthToken({ userId: 1 });
    wsUrl = `ws://localhost:${server.port}?token=${token}`;
  });
  
  afterEach(async () => {
    ws?.close();
    await server.close();
  });
  
  it('should connect and receive welcome message', (done) => {
    ws = new WebSocket(wsUrl);
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      expect(message.type).toBe('connected');
      expect(message.data.userId).toBe(1);
      done();
    });
  });
  
  it('should receive XP updates', (done) => {
    ws = new WebSocket(wsUrl);
    
    ws.on('open', () => {
      // Trigger XP award
      server.emit('xp_update', {
        userId: 1,
        xpGained: 50,
        totalXP: 150,
        level: 2,
        leveledUp: false,
      });
    });
    
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'xp_gained') {
        expect(message.data).toMatchObject({
          xpGained: 50,
          totalXP: 150,
          level: 2,
        });
        done();
      }
    });
  });
  
  it('should handle subscriptions', async () => {
    ws = new WebSocket(wsUrl);
    await waitForConnection(ws);
    
    // Subscribe to leaderboard
    ws.send(JSON.stringify({
      type: 'subscribe',
      data: { channel: 'leaderboard' },
    }));
    
    const response = await waitForMessage(ws, 'subscribed');
    expect(response.data.channel).toBe('leaderboard');
  });
});
```

## 2. Smart Contract Testing

### 2.1 Cairo Contract Tests
```rust
// contracts/tests/test_xp_system.cairo
#[cfg(test)]
mod tests {
    use starknet::testing::{set_caller_address, set_block_timestamp};
    use starknet::{ContractAddress, contract_address_const};
    use xp_system::{XPSystem, IXPSystemDispatcher, IXPSystemDispatcherTrait};
    
    fn setup() -> (IXPSystemDispatcher, ContractAddress, ContractAddress) {
        let admin = contract_address_const::<0x123>();
        let backend = contract_address_const::<0x456>();
        let user = contract_address_const::<0x789>();
        
        let contract = XPSystem::deploy(admin, backend);
        let dispatcher = IXPSystemDispatcher { contract_address: contract };
        
        (dispatcher, admin, user)
    }
    
    #[test]
    fn test_award_xp_success() {
        let (dispatcher, admin, user) = setup();
        
        // Set caller as backend
        set_caller_address(contract_address_const::<0x456>());
        
        // Award XP
        dispatcher.award_xp(user, 'first_trade', 100);
        
        // Check XP balance
        let xp = dispatcher.get_user_xp(user);
        assert(xp == 100, 'XP should be 100');
        
        // Check level
        let level = dispatcher.get_user_level(user);
        assert(level == 2, 'Should be level 2');
    }
    
    #[test]
    #[should_panic(expected: ('Action on cooldown',))]
    fn test_cooldown_enforcement() {
        let (dispatcher, _, user) = setup();
        set_caller_address(contract_address_const::<0x456>());
        
        // Award XP first time
        dispatcher.award_xp(user, 'daily_login', 5);
        
        // Try again immediately (should fail)
        dispatcher.award_xp(user, 'daily_login', 5);
    }
    
    #[test]
    fn test_batch_xp_award() {
        let (dispatcher, _, _) = setup();
        set_caller_address(contract_address_const::<0x456>());
        
        let updates = array![
            PendingXPUpdate {
                user: contract_address_const::<0x111>(),
                amount: 50,
                action_type: 'trade_executed',
                timestamp: 1000,
            },
            PendingXPUpdate {
                user: contract_address_const::<0x222>(),
                amount: 100,
                action_type: 'first_trade',
                timestamp: 1001,
            },
        ];
        
        dispatcher.batch_award_xp(updates);
        
        // Verify both users received XP
        assert(dispatcher.get_user_xp(contract_address_const::<0x111>()) == 50, 'User 1 XP wrong');
        assert(dispatcher.get_user_xp(contract_address_const::<0x222>()) == 100, 'User 2 XP wrong');
    }
}
```

### 2.2 Contract Security Tests
```rust
#[test]
#[should_panic(expected: ('Unauthorized caller',))]
fn test_unauthorized_award() {
    let (dispatcher, _, user) = setup();
    
    // Set caller as random address (not admin or backend)
    set_caller_address(contract_address_const::<0x999>());
    
    // Should fail
    dispatcher.award_xp(user, 'trade_executed', 50);
}

#[test]
#[should_panic(expected: ('Contract is paused',))]
fn test_paused_contract() {
    let (dispatcher, admin, user) = setup();
    
    // Pause as admin
    set_caller_address(admin);
    dispatcher.pause_contract();
    
    // Try to award XP (should fail)
    set_caller_address(contract_address_const::<0x456>());
    dispatcher.award_xp(user, 'trade_executed', 50);
}
```

## 3. Frontend Testing

### 3.1 Widget Tests
```dart
// frontend/test/widgets/trade_card_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:perps_gamified/widgets/trade_card.dart';
import 'package:perps_gamified/models/asset.dart';
import '../mocks/mock_providers.dart';

void main() {
  group('TradeCard Widget', () {
    testWidgets('displays asset information correctly', (tester) async {
      final asset = Asset(
        symbol: 'BTC',
        name: 'Bitcoin',
        price: 45000,
        icon: '₿',
        color: Colors.orange,
      );
      
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TradeCard(asset: asset),
          ),
        ),
      );
      
      expect(find.text('BTC'), findsOneWidget);
      expect(find.text('Bitcoin'), findsOneWidget);
      expect(find.text('45,000'), findsOneWidget);
      expect(find.text('₿'), findsOneWidget);
    });
    
    testWidgets('swipe right triggers long trade', (tester) async {
      final mockTrading = MockTradingProvider();
      
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: mockTrading),
          ],
          child: MaterialApp(
            home: TradeScreen(),
          ),
        ),
      );
      
      // Swipe right on the card
      await tester.drag(
        find.byType(TradeCard).first,
        const Offset(300, 0),
      );
      await tester.pumpAndSettle();
      
      verify(mockTrading.executeTrade(
        asset: 'BTC',
        direction: 'long',
        size: any,
      )).called(1);
    });
    
    testWidgets('shows loading state during trade', (tester) async {
      final mockTrading = MockTradingProvider();
      when(mockTrading.executeTrade(any, any, any))
          .thenAnswer((_) async {
        await Future.delayed(Duration(seconds: 2));
        return true;
      });
      
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: mockTrading),
          ],
          child: MaterialApp(
            home: TradeScreen(),
          ),
        ),
      );
      
      // Trigger trade
      await tester.tap(find.text('Quick Long'));
      await tester.pump();
      
      // Should show loading indicator
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      
      // Complete the trade
      await tester.pumpAndSettle();
      expect(find.byType(CircularProgressIndicator), findsNothing);
    });
  });
}
```

### 3.2 Integration Tests
```dart
// frontend/test/integration/trading_flow_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:perps_gamified/main.dart' as app;

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  
  group('Trading Flow Integration', () {
    testWidgets('complete trade flow from onboarding to trade', (tester) async {
      app.main();
      await tester.pumpAndSettle();
      
      // Onboarding
      expect(find.text('Trade Like a Game'), findsOneWidget);
      
      // Connect wallet
      await tester.tap(find.text('Connect Wallet'));
      await tester.pumpAndSettle();
      
      // Complete tutorial
      await tester.tap(find.text('Start Tutorial'));
      await tester.pumpAndSettle();
      
      // Swipe through tutorial
      for (int i = 0; i < 3; i++) {
        await tester.drag(
          find.byType(TutorialCard),
          const Offset(-300, 0),
        );
        await tester.pumpAndSettle();
      }
      
      // Start trading
      await tester.tap(find.text('Start Trading'));
      await tester.pumpAndSettle();
      
      // Should be on trade screen
      expect(find.text('Swipe to Trade'), findsOneWidget);
      
      // Execute a trade
      await tester.drag(
        find.byType(TradeCard).first,
        const Offset(300, 0),
      );
      await tester.pumpAndSettle();
      
      // Should show success
      expect(find.text('Trade Executed!'), findsOneWidget);
      expect(find.text('+20 XP'), findsOneWidget);
    });
  });
}
```

## 4. Load Testing

### 4.1 K6 Load Test Script
```javascript
// load-tests/trading-load-test.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import ws from 'k6/ws';

// Test data
const users = new SharedArray('users', function () {
  return JSON.parse(open('./test-users.json'));
});

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up
    { duration: '5m', target: 1000 },  // Stay at 1000 users
    { duration: '2m', target: 5000 },  // Spike test
    { duration: '5m', target: 1000 },  // Back to normal
    { duration: '2m', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'], // 95% under 500ms
    http_req_failed: ['rate<0.1'],                   // Error rate under 10%
    ws_connecting: ['p(95)<1000'],                   // WebSocket connection time
  },
};

export default function () {
  const user = users[Math.floor(Math.random() * users.length)];
  const params = {
    headers: {
      'Authorization': `Bearer ${user.token}`,
      'Content-Type': 'application/json',
    },
  };
  
  // Simulate user journey
  
  // 1. Get user stats
  const statsRes = http.get(`${__ENV.API_URL}/api/v1/xp/stats`, params);
  check(statsRes, {
    'stats status 200': (r) => r.status === 200,
  });
  
  sleep(Math.random() * 2);
  
  // 2. Get leaderboard
  const leaderboardRes = http.get(`${__ENV.API_URL}/api/v1/leaderboard`, params);
  check(leaderboardRes, {
    'leaderboard status 200': (r) => r.status === 200,
  });
  
  sleep(Math.random() * 3);
  
  // 3. Execute trade (30% of users)
  if (Math.random() < 0.3) {
    const tradePayload = JSON.stringify({
      asset: ['BTC', 'ETH', 'SOL'][Math.floor(Math.random() * 3)],
      direction: Math.random() > 0.5 ? 'long' : 'short',
      size: Math.floor(Math.random() * 900) + 100,
    });
    
    const tradeRes = http.post(
      `${__ENV.API_URL}/api/v1/trading/execute`,
      tradePayload,
      params
    );
    
    check(tradeRes, {
      'trade status ok': (r) => r.status === 200 || r.status === 202,
      'trade has id': (r) => r.json('tradeId') !== undefined,
    });
  }
  
  // 4. WebSocket connection (10% of users)
  if (Math.random() < 0.1) {
    const wsUrl = `${__ENV.WS_URL}?token=${user.token}`;
    
    ws.connect(wsUrl, {}, function (socket) {
      socket.on('open', () => {
        socket.send(JSON.stringify({
          type: 'subscribe',
          data: { channel: 'leaderboard' },
        }));
      });
      
      socket.on('message', (data) => {
        const message = JSON.parse(data);
        check(message, {
          'ws message has type': (m) => m.type !== undefined,
        });
      });
      
      socket.setTimeout(() => {
        socket.close();
      }, 30000); // Keep connection for 30s
    });
  }
  
  sleep(Math.random() * 5);
}
```

### 4.2 Stress Test Scenarios
```javascript
// load-tests/stress-test.js
import { scenario } from 'k6/execution';

export const options = {
  scenarios: {
    // Spike test - sudden traffic increase
    spike_test: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 0 },
        { duration: '10s', target: 5000 }, // Spike to 5000 users
        { duration: '1m', target: 5000 },  // Stay at 5000
        { duration: '10s', target: 0 },    // Quick ramp down
      ],
    },
    
    // Soak test - sustained load
    soak_test: {
      executor: 'constant-vus',
      vus: 1000,
      duration: '2h',
      startTime: '10m', // Start after spike test
    },
    
    // Breakpoint test - find the limit
    breakpoint_test: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 10000,
      stages: [
        { duration: '5m', target: 1000 },
        { duration: '5m', target: 2000 },
        { duration: '5m', target: 5000 },
        { duration: '5m', target: 10000 },
      ],
    },
  },
};
```

## 5. Mobile Testing

### 5.1 Device Testing Matrix
```yaml
# .github/workflows/device-testing.yml
name: Device Testing

on:
  push:
    branches: [main, develop]

jobs:
  test-android:
    runs-on: macos-latest
    strategy:
      matrix:
        api-level: [29, 30, 31, 33]
        device: ['pixel_4', 'pixel_6_pro']
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.16.0'
      
      - name: Run tests on Android
        uses: reactivecircus/android-emulator-runner@v2
        with:
          api-level: ${{ matrix.api-level }}
          profile: ${{ matrix.device }}
          script: |
            flutter test integration_test/app_test.dart
  
  test-ios:
    runs-on: macos-latest
    strategy:
      matrix:
        device: ['iPhone 13', 'iPhone 14 Pro', 'iPad Air']
        os: ['16.0', '17.0']
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Flutter
        uses: subosito/flutter-action@v2
      
      - name: Run tests on iOS
        run: |
          xcrun simctl create test-device \
            "com.apple.CoreSimulator.SimDeviceType.${{ matrix.device }}" \
            "com.apple.CoreSimulator.SimRuntime.iOS-${{ matrix.os }}"
          flutter test integration_test/app_test.dart
```

### 5.2 Performance Testing
```dart
// frontend/test/performance/app_performance_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/scheduler.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  
  testWidgets('app performance metrics', (tester) async {
    await binding.watchPerformance(() async {
      app.main();
      await tester.pumpAndSettle();
      
      // Navigate through app
      await tester.tap(find.text('Connect Wallet'));
      await tester.pumpAndSettle();
      
      // Scroll through trade cards
      await tester.fling(
        find.byType(TradeCard),
        const Offset(0, -300),
        1000,
      );
      await tester.pumpAndSettle();
      
      // Open ecosystem view
      await tester.tap(find.byIcon(Icons.castle));
      await tester.pumpAndSettle();
      
      // Check leaderboard
      await tester.tap(find.byIcon(Icons.leaderboard));
      await tester.pumpAndSettle();
    }, reportKey: 'app_performance');
  });
}
```

## 6. Security Testing

### 6.1 API Security Tests
```typescript
// backend/src/__tests__/security/api-security.test.ts
import request from 'supertest';
import { app } from '../../app';

describe('API Security', () => {
  describe('Authentication', () => {
    it('should reject requests without token', async () => {
      const response = await request(app)
        .get('/api/v1/xp/stats')
        .expect(401);
      
      expect(response.body.error).toBe('Authentication required');
    });
    
    it('should reject expired tokens', async () => {
      const expiredToken = generateExpiredToken();
      
      const response = await request(app)
        .get('/api/v1/xp/stats')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
      
      expect(response.body.error).toBe('Token expired');
    });
  });
  
  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const token = await createTestUser();
      
      // Make 31 requests (limit is 30 per minute)
      const requests = Array(31).fill(null).map(() =>
        request(app)
          .post('/api/v1/trading/execute')
          .set('Authorization', `Bearer ${token}`)
          .send({ asset: 'BTC', direction: 'long', size: 100 })
      );
      
      const responses = await Promise.all(requests);
      const rateLimited = responses.filter(r => r.status === 429);
      
      expect(rateLimited.length).toBeGreaterThan(0);
      expect(rateLimited[0].body.message).toBe('Too many trades, please slow down');
    });
  });
  
  describe('Input Validation', () => {
    it('should reject SQL injection attempts', async () => {
      const token = await createTestUser();
      
      const response = await request(app)
        .post('/api/v1/trading/execute')
        .set('Authorization', `Bearer ${token}`)
        .send({
          asset: "BTC'; DROP TABLE users; --",
          direction: 'long',
          size: 100,
        })
        .expect(400);
      
      expect(response.body.error).toContain('Invalid asset');
    });
    
    it('should sanitize XSS attempts', async () => {
      const token = await createTestUser();
      
      const response = await request(app)
        .put('/api/v1/user/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({
          username: '<script>alert("xss")</script>',
        })
        .expect(400);
      
      expect(response.body.error).toContain('Invalid username');
    });
  });
});
```

## 7. Monitoring & Alerting Tests

### 7.1 Synthetic Monitoring
```javascript
// monitoring/synthetic-tests.js
const synthetics = require('Synthetics');
const log = require('SyntheticsLogger');

const apiCanaryBlueprint = async function () {
  const urls = [
    '/health',
    '/api/v1/leaderboard',
    '/api/v1/assets/prices',
  ];
  
  for (const url of urls) {
    const fullUrl = `https://api.perpsgo.com${url}`;
    
    await synthetics.executeHttpStep(
      `Check ${url}`,
      {
        method: 'GET',
        url: fullUrl,
        headers: {
          'User-Agent': synthetics.getCanaryUserAgentString(),
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          throw new Error(`${url} returned ${res.statusCode}`);
        }
        
        if (res.timingPhases.total > 1000) {
          log.warn(`${url} slow response: ${res.timingPhases.total}ms`);
        }
      }
    );
  }
};

exports.handler = async () => {
  return await synthetics.getCanary().executeCanary(apiCanaryBlueprint);
};
```

## 8. Test Automation & CI/CD

### 8.1 GitHub Actions Workflow
```yaml
# .github/workflows/test-and-deploy.yml
name: Test and Deploy

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: cd backend && npm ci
      
      - name: Run unit tests
        run: cd backend && npm run test:unit
      
      - name: Run integration tests
        run: cd backend && npm run test:integration
        env:
          DATABASE_URL: postgres://postgres:postgres@localhost/test
          REDIS_URL: redis://localhost:6379
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
  
  test-contracts:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Install Scarb
        run: |
          curl -L https://github.com/software-mansion/scarb/releases/download/v0.7.0/scarb-v0.7.0-x86_64-unknown-linux-gnu.tar.gz | tar xz
          sudo mv scarb/bin/scarb /usr/local/bin/
      
      - name: Run contract tests
        run: cd contracts && scarb test
  
  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.16.0'
      
      - name: Install dependencies
        run: cd frontend && flutter pub get
      
      - name: Run tests
        run: cd frontend && flutter test --coverage
      
      - name: Upload coverage
        uses: codecov/codecov-action@v3
  
  load-test:
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    needs: [test-backend, test-contracts, test-frontend]
    steps:
      - uses: actions/checkout@v3
      
      - name: Run k6 load test
        uses: grafana/k6-action@v0.3.0
        with:
          filename: load-tests/trading-load-test.js
          flags: --out cloud
        env:
          K6_CLOUD_TOKEN: ${{ secrets.K6_CLOUD_TOKEN }}
          API_URL: ${{ secrets.STAGING_API_URL }}
```

## Testing Best Practices

### 1. Test Data Management
- Use factories for consistent test data
- Clean up after each test
- Use separate test databases
- Mock external services

### 2. Test Coverage Goals
- Unit tests: 80%+
- Integration tests: Critical paths
- E2E tests: Happy paths only
- Contract tests: 100% of public functions

### 3. Performance Benchmarks
- API response: < 200ms (p95)
- WebSocket latency: < 50ms
- Trade execution: < 2s
- App startup: < 3s

### 4. Security Testing Checklist
- [ ] SQL injection tests
- [ ] XSS prevention tests
- [ ] Authentication bypass attempts
- [ ] Rate limiting verification
- [ ] CORS configuration tests
- [ ] Session hijacking prevention

Remember: **Good tests are the foundation of a reliable production system!** 