import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:flutter_card_swiper/flutter_card_swiper.dart';
import 'package:lottie/lottie.dart';
import 'package:haptic_feedback/haptic_feedback.dart';
import '../providers/trading_provider.dart';
import '../providers/xp_provider.dart';
import '../models/asset.dart';
import '../widgets/trade_size_selector.dart';
import '../widgets/xp_animation.dart';

class TradeScreen extends StatefulWidget {
  const TradeScreen({super.key});

  @override
  State<TradeScreen> createState() => _TradeScreenState();
}

class _TradeScreenState extends State<TradeScreen> with TickerProviderStateMixin {
  final CardSwiperController controller = CardSwiperController();
  late AnimationController _pulseController;
  late AnimationController _swipeHintController;
  
  double _currentTradeSize = 50.0;
  bool _isProcessingTrade = false;
  int _currentCardIndex = 0;
  
  final List<Asset> _tradableAssets = [
    Asset(symbol: 'BTC', name: 'Bitcoin', price: 45000, icon: '₿', color: const Color(0xFFFF9500)),
    Asset(symbol: 'ETH', name: 'Ethereum', price: 2500, icon: 'Ξ', color: const Color(0xFF627EEA)),
    Asset(symbol: 'SOL', name: 'Solana', price: 100, icon: '◎', color: const Color(0xFF00FFA3)),
    Asset(symbol: 'DOGE', name: 'Dogecoin', price: 0.15, icon: 'Ð', color: const Color(0xFFC2A633)),
    Asset(symbol: 'PEPE', name: 'Pepe', price: 0.0000012, icon: '🐸', color: const Color(0xFF77C159)),
  ];
  
  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    )..repeat();
    
    _swipeHintController = AnimationController(
      duration: const Duration(seconds: 3),
      vsync: this,
    );
    
    // Show swipe hint for new users
    _showSwipeHintIfNeeded();
  }
  
  @override
  void dispose() {
    _pulseController.dispose();
    _swipeHintController.dispose();
    controller.dispose();
    super.dispose();
  }
  
  void _showSwipeHintIfNeeded() async {
    final hasTraded = await context.read<TradingProvider>().hasUserTraded();
    if (!hasTraded && mounted) {
      _swipeHintController.repeat();
      Future.delayed(const Duration(seconds: 5), () {
        if (mounted) _swipeHintController.stop();
      });
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: Stack(
                alignment: Alignment.center,
                children: [
                  _buildSwipeHint(),
                  _buildCardSwiper(),
                  _buildSwipeIndicators(),
                ],
              ),
            ),
            _buildTradeSizeSelector(),
            _buildQuickActions(),
          ],
        ),
      ),
    );
  }
  
  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Swipe to Trade',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '← Short  |  Long →',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Colors.grey[400],
                ),
              ),
            ],
          ),
          Consumer<XPProvider>(
            builder: (context, xpProvider, _) {
              return Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [Colors.purple[400]!, Colors.blue[400]!],
                  ),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.flash_on, color: Colors.white, size: 16),
                    const SizedBox(width: 4),
                    Text(
                      '${xpProvider.currentXP} XP',
                      style: const TextStyle(
                        color: Colors.white,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
  
  Widget _buildCardSwiper() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20),
      child: CardSwiper(
        controller: controller,
        cardsCount: _tradableAssets.length,
        numberOfCardsDisplayed: 2,
        backCardOffset: const Offset(0, 40),
        padding: const EdgeInsets.all(20),
        cardBuilder: (context, index, horizontalThreshold, verticalThreshold) {
          return _buildTradeCard(_tradableAssets[index], horizontalThreshold);
        },
        onSwipe: _onSwipe,
        onEnd: _onEndOfCards,
      ),
    );
  }
  
  Widget _buildTradeCard(Asset asset, double swipeProgress) {
    final isSwipingRight = swipeProgress > 0;
    final opacity = (swipeProgress.abs() * 2).clamp(0.0, 1.0);
    
    return AnimatedBuilder(
      animation: _pulseController,
      builder: (context, child) {
        final scale = 1.0 + (_pulseController.value * 0.02);
        
        return Transform.scale(
          scale: scale,
          child: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  asset.color.withOpacity(0.8),
                  asset.color.withOpacity(0.4),
                ],
              ),
              borderRadius: BorderRadius.circular(30),
              boxShadow: [
                BoxShadow(
                  color: asset.color.withOpacity(0.4),
                  blurRadius: 20,
                  offset: const Offset(0, 10),
                ),
              ],
            ),
            child: Stack(
              children: [
                // Background pattern
                Positioned.fill(
                  child: CustomPaint(
                    painter: CardPatternPainter(color: asset.color),
                  ),
                ),
                
                // Card content
                Padding(
                  padding: const EdgeInsets.all(30),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        asset.icon,
                        style: const TextStyle(fontSize: 80),
                      ),
                      const SizedBox(height: 20),
                      Text(
                        asset.symbol,
                        style: Theme.of(context).textTheme.headlineLarge?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                      Text(
                        asset.name,
                        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                          color: Colors.white70,
                        ),
                      ),
                      const SizedBox(height: 30),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 20,
                          vertical: 10,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(20),
                        ),
                        child: Text(
                          '\$${asset.getFormattedPrice()}',
                          style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                
                // Swipe overlay
                if (swipeProgress != 0)
                  Positioned.fill(
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(30),
                        color: isSwipingRight
                            ? Colors.green.withOpacity(opacity * 0.5)
                            : Colors.red.withOpacity(opacity * 0.5),
                      ),
                      child: Center(
                        child: Icon(
                          isSwipingRight ? Icons.trending_up : Icons.trending_down,
                          color: Colors.white,
                          size: 100 * opacity,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
  
  Widget _buildSwipeHint() {
    return AnimatedBuilder(
      animation: _swipeHintController,
      builder: (context, child) {
        final offset = Tween<double>(
          begin: -30,
          end: 30,
        ).animate(CurvedAnimation(
          parent: _swipeHintController,
          curve: Curves.easeInOut,
        )).value;
        
        return Positioned(
          bottom: 300,
          child: Transform.translate(
            offset: Offset(offset, 0),
            child: Opacity(
              opacity: _swipeHintController.isAnimating ? 0.3 : 0.0,
              child: Row(
                children: [
                  const Icon(Icons.swipe, size: 40, color: Colors.white),
                  const SizedBox(width: 10),
                  Text(
                    'Swipe to trade!',
                    style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
  
  Widget _buildSwipeIndicators() {
    return Positioned(
      bottom: 280,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _buildDirectionIndicator('SHORT', Colors.red, Icons.trending_down),
          const SizedBox(width: 100),
          _buildDirectionIndicator('LONG', Colors.green, Icons.trending_up),
        ],
      ),
    );
  }
  
  Widget _buildDirectionIndicator(String label, Color color, IconData icon) {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: color.withOpacity(0.2),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: color),
        ),
        const SizedBox(height: 8),
        Text(
          label,
          style: TextStyle(
            color: color,
            fontWeight: FontWeight.bold,
          ),
        ),
      ],
    );
  }
  
  Widget _buildTradeSizeSelector() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.grey[900],
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Trade Size',
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              Text(
                '\$${_currentTradeSize.toStringAsFixed(0)}',
                style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).primaryColor,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: Theme.of(context).primaryColor,
              inactiveTrackColor: Colors.grey[800],
              thumbColor: Theme.of(context).primaryColor,
              overlayColor: Theme.of(context).primaryColor.withOpacity(0.2),
              trackHeight: 8,
              thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 12),
            ),
            child: Slider(
              value: _currentTradeSize,
              min: 10,
              max: 1000,
              divisions: 99,
              onChanged: (value) {
                HapticFeedback.lightImpact();
                setState(() {
                  _currentTradeSize = value;
                });
              },
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [10, 50, 100, 500, 1000].map((size) {
              return GestureDetector(
                onTap: () {
                  HapticFeedback.lightImpact();
                  setState(() {
                    _currentTradeSize = size.toDouble();
                  });
                },
                child: Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  decoration: BoxDecoration(
                    color: _currentTradeSize == size
                        ? Theme.of(context).primaryColor
                        : Colors.grey[800],
                    borderRadius: BorderRadius.circular(15),
                  ),
                  child: Text(
                    '\$$size',
                    style: TextStyle(
                      color: _currentTradeSize == size
                          ? Colors.white
                          : Colors.grey[400],
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }
  
  Widget _buildQuickActions() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Row(
        children: [
          Expanded(
            child: ElevatedButton.icon(
              onPressed: _isProcessingTrade ? null : () => _quickTrade('short'),
              icon: const Icon(Icons.trending_down),
              label: const Text('Quick Short'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.red,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: ElevatedButton.icon(
              onPressed: _isProcessingTrade ? null : () => _quickTrade('long'),
              icon: const Icon(Icons.trending_up),
              label: const Text('Quick Long'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.green,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(15),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
  
  Future<bool> _onSwipe(
    int previousIndex,
    int? currentIndex,
    CardSwiperDirection direction,
  ) async {
    if (_isProcessingTrade) return false;
    
    final asset = _tradableAssets[previousIndex];
    final isLong = direction == CardSwiperDirection.right;
    
    await _executeTrade(asset, isLong ? 'long' : 'short');
    
    return true;
  }
  
  void _onEndOfCards() {
    // Reset the cards
    setState(() {
      _currentCardIndex = 0;
    });
    controller.moveTo(0);
  }
  
  Future<void> _quickTrade(String direction) async {
    if (_isProcessingTrade) return;
    
    final currentAsset = _tradableAssets[_currentCardIndex];
    await _executeTrade(currentAsset, direction);
  }
  
  Future<void> _executeTrade(Asset asset, String direction) async {
    setState(() {
      _isProcessingTrade = true;
    });
    
    // Haptic feedback
    await HapticFeedback.heavyImpact();
    
    try {
      final tradingProvider = context.read<TradingProvider>();
      final success = await tradingProvider.executeTrade(
        asset: asset.symbol,
        direction: direction,
        size: _currentTradeSize,
      );
      
      if (success && mounted) {
        // Show success animation
        _showTradeSuccessAnimation();
        
        // Award XP
        context.read<XPProvider>().addXP(20, 'trade_executed');
      }
    } catch (error) {
      // Show error
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Trade failed: $error'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() {
        _isProcessingTrade = false;
      });
    }
  }
  
  void _showTradeSuccessAnimation() {
    showGeneralDialog(
      context: context,
      barrierDismissible: true,
      barrierLabel: '',
      barrierColor: Colors.black54,
      transitionDuration: const Duration(milliseconds: 300),
      pageBuilder: (context, anim1, anim2) {
        return Center(
          child: Material(
            color: Colors.transparent,
            child: Container(
              width: 200,
              height: 200,
              decoration: BoxDecoration(
                color: Colors.grey[900],
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Lottie.asset(
                    'assets/animations/success.json',
                    width: 100,
                    height: 100,
                    repeat: false,
                  ),
                  const Text(
                    'Trade Executed!',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '+20 XP',
                    style: TextStyle(
                      color: Colors.green,
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
      transitionBuilder: (context, anim1, anim2, child) {
        return FadeTransition(
          opacity: anim1,
          child: ScaleTransition(
            scale: anim1,
            child: child,
          ),
        );
      },
    );
    
    // Auto dismiss after 2 seconds
    Future.delayed(const Duration(seconds: 2), () {
      if (mounted) Navigator.of(context).pop();
    });
  }
}

// Custom painter for card pattern
class CardPatternPainter extends CustomPainter {
  final Color color;
  
  CardPatternPainter({required this.color});
  
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color.withOpacity(0.1)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2;
    
    // Draw diagonal lines pattern
    for (double i = -size.width; i < size.width * 2; i += 40) {
      canvas.drawLine(
        Offset(i, 0),
        Offset(i + size.height, size.height),
        paint,
      );
    }
  }
  
  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}