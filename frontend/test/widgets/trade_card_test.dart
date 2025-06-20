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