import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:lottie/lottie.dart';
import '../providers/xp_provider.dart';
import '../providers/ecosystem_provider.dart';
import '../widgets/ecosystem_building.dart';
import '../widgets/level_progress_bar.dart';
import '../models/ecosystem_level.dart';

class EcosystemScreen extends StatefulWidget {
  const EcosystemScreen({super.key});

  @override
  State<EcosystemScreen> createState() => _EcosystemScreenState();
}

class _EcosystemScreenState extends State<EcosystemScreen>
    with TickerProviderStateMixin {
  late AnimationController _floatingController;
  late AnimationController _particleController;
  bool _showLevelUpAnimation = false;
  
  @override
  void initState() {
    super.initState();
    _floatingController = AnimationController(
      duration: const Duration(seconds: 3),
      vsync: this,
    )..repeat(reverse: true);
    
    _particleController = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    )..repeat();
    
    // Check for level up
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _checkLevelUp();
    });
  }
  
  @override
  void dispose() {
    _floatingController.dispose();
    _particleController.dispose();
    super.dispose();
  }
  
  void _checkLevelUp() {
    final xpProvider = context.read<XPProvider>();
    if (xpProvider.hasLeveledUp) {
      setState(() {
        _showLevelUpAnimation = true;
      });
      HapticFeedback.heavyImpact();
      
      Future.delayed(const Duration(seconds: 3), () {
        if (mounted) {
          setState(() {
            _showLevelUpAnimation = false;
          });
          xpProvider.clearLevelUpFlag();
        }
      });
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          _buildBackground(),
          _buildEcosystem(),
          _buildUI(),
          if (_showLevelUpAnimation) _buildLevelUpOverlay(),
        ],
      ),
    );
  }
  
  Widget _buildBackground() {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            const Color(0xFF1a1a2e),
            const Color(0xFF16213e),
            const Color(0xFF0f3460),
          ],
        ),
      ),
      child: CustomPaint(
        painter: StarFieldPainter(_particleController),
        size: Size.infinite,
      ),
    );
  }
  
  Widget _buildEcosystem() {
    return Consumer2<XPProvider, EcosystemProvider>(
      builder: (context, xpProvider, ecosystemProvider, _) {
        final level = xpProvider.currentLevel;
        final ecosystemData = ecosystemProvider.getEcosystemForLevel(level);
        
        return Center(
          child: AnimatedBuilder(
            animation: _floatingController,
            builder: (context, child) {
              final offsetY = _floatingController.value * 10 - 5;
              
              return Transform.translate(
                offset: Offset(0, offsetY),
                child: _buildEcosystemVisual(ecosystemData, level),
              );
            },
          ),
        );
      },
    );
  }
  
  Widget _buildEcosystemVisual(EcosystemLevel ecosystem, int level) {
    return Container(
      width: 350,
      height: 400,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Base platform
          Positioned(
            bottom: 0,
            child: Container(
              width: 300,
              height: 150,
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  colors: [
                    Colors.purple.withOpacity(0.3),
                    Colors.blue.withOpacity(0.1),
                  ],
                ),
                borderRadius: BorderRadius.circular(150),
              ),
            ),
          ).animate().scale(
            duration: const Duration(milliseconds: 800),
            curve: Curves.elasticOut,
          ),
          
          // Main building
          Positioned(
            bottom: 100,
            child: EcosystemBuilding(
              type: ecosystem.buildingType,
              level: level,
            ),
          ).animate()
            .fadeIn(duration: const Duration(milliseconds: 600))
            .slideY(begin: 0.2, end: 0),
          
          // Decorations
          ...ecosystem.decorations.map((decoration) {
            return Positioned(
              left: decoration.x,
              bottom: decoration.y,
              child: _buildDecoration(decoration),
            ).animate()
              .fadeIn(
                delay: Duration(milliseconds: decoration.animationDelay),
                duration: const Duration(milliseconds: 500),
              )
              .scale(begin: 0.8, end: 1.0);
          }).toList(),
          
          // Floating elements for higher levels
          if (level >= 7)
            ..._buildFloatingElements(level),
        ],
      ),
    );
  }
  
  Widget _buildDecoration(EcosystemDecoration decoration) {
    return Container(
      width: decoration.size,
      height: decoration.size,
      child: decoration.isAnimated
          ? Lottie.asset(
              'assets/animations/${decoration.asset}.json',
              width: decoration.size,
              height: decoration.size,
            )
          : Image.asset(
              'assets/images/${decoration.asset}.png',
              width: decoration.size,
              height: decoration.size,
            ),
    );
  }
  
  List<Widget> _buildFloatingElements(int level) {
    final elements = <Widget>[];
    
    if (level >= 8) {
      // Add floating islands
      elements.add(
        Positioned(
          left: 50,
          top: 50,
          child: AnimatedBuilder(
            animation: _floatingController,
            builder: (context, child) {
              final offsetY = _floatingController.value * 15 - 7.5;
              final rotation = _floatingController.value * 0.1 - 0.05;
              
              return Transform.translate(
                offset: Offset(0, offsetY),
                child: Transform.rotate(
                  angle: rotation,
                  child: Container(
                    width: 80,
                    height: 60,
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        colors: [Colors.purple[300]!, Colors.blue[300]!],
                      ),
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.purple.withOpacity(0.5),
                          blurRadius: 20,
                          offset: const Offset(0, 10),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          ),
        ),
      );
    }
    
    if (level >= 10) {
      // Add dragon or phoenix
      elements.add(
        Positioned(
          right: 30,
          top: 80,
          child: Lottie.asset(
            'assets/animations/dragon.json',
            width: 120,
            height: 120,
          ),
        ).animate(
          onPlay: (controller) => controller.repeat(),
        ).moveX(
          begin: -20,
          end: 20,
          duration: const Duration(seconds: 4),
          curve: Curves.easeInOut,
        ),
      );
    }
    
    return elements;
  }
  
  Widget _buildUI() {
    return SafeArea(
      child: Column(
        children: [
          _buildHeader(),
          const Spacer(),
          _buildLevelInfo(),
          _buildProgressSection(),
          const SizedBox(height: 20),
        ],
      ),
    );
  }
  
  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.all(20),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back, color: Colors.white),
            onPressed: () => Navigator.pop(context),
          ),
          Text(
            'Your Kingdom',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
              fontWeight: FontWeight.bold,
              color: Colors.white,
            ),
          ),
          IconButton(
            icon: const Icon(Icons.settings, color: Colors.white),
            onPressed: () {
              // Show ecosystem settings
            },
          ),
        ],
      ),
    );
  }
  
  Widget _buildLevelInfo() {
    return Consumer<XPProvider>(
      builder: (context, xpProvider, _) {
        final level = xpProvider.currentLevel;
        final title = _getLevelTitle(level);
        
        return Column(
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.purple[400]!, Colors.blue[400]!],
                ),
                borderRadius: BorderRadius.circular(30),
                boxShadow: [
                  BoxShadow(
                    color: Colors.purple.withOpacity(0.5),
                    blurRadius: 20,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.stars, color: Colors.white),
                  const SizedBox(width: 8),
                  Text(
                    'Level $level',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Text(
              title,
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: Colors.white70,
              ),
            ),
          ],
        );
      },
    );
  }
  
  Widget _buildProgressSection() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 20),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.3),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: Colors.purple.withOpacity(0.3),
          width: 1,
        ),
      ),
      child: Consumer<XPProvider>(
        builder: (context, xpProvider, _) {
          return Column(
            children: [
              LevelProgressBar(
                currentXP: xpProvider.currentXP,
                currentLevel: xpProvider.currentLevel,
                xpForCurrentLevel: xpProvider.xpForCurrentLevel,
                xpForNextLevel: xpProvider.xpForNextLevel,
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildStat('Total XP', '${xpProvider.currentXP}'),
                  _buildStat('Trades', '${xpProvider.totalTrades}'),
                  _buildStat('Streak', '${xpProvider.currentStreak}🔥'),
                ],
              ),
            ],
          );
        },
      ),
    );
  }
  
  Widget _buildStat(String label, String value) {
    return Column(
      children: [
        Text(
          value,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 24,
            fontWeight: FontWeight.bold,
          ),
        ),
        Text(
          label,
          style: TextStyle(
            color: Colors.white.withOpacity(0.6),
            fontSize: 14,
          ),
        ),
      ],
    );
  }
  
  Widget _buildLevelUpOverlay() {
    return Container(
      color: Colors.black.withOpacity(0.8),
      child: Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Lottie.asset(
              'assets/animations/level_up.json',
              width: 300,
              height: 300,
              repeat: false,
            ),
            const SizedBox(height: 20),
            Text(
              'LEVEL UP!',
              style: Theme.of(context).textTheme.displaySmall?.copyWith(
                color: Colors.white,
                fontWeight: FontWeight.bold,
              ),
            ).animate()
              .fadeIn(delay: const Duration(milliseconds: 500))
              .scale(begin: 0.8, end: 1.2),
            const SizedBox(height: 10),
            Consumer<XPProvider>(
              builder: (context, xpProvider, _) {
                return Text(
                  'You reached Level ${xpProvider.currentLevel}!',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                    color: Colors.white70,
                  ),
                );
              },
            ),
          ],
        ),
      ),
    ).animate().fadeIn(duration: const Duration(milliseconds: 300));
  }
  
  String _getLevelTitle(int level) {
    const titles = {
      1: 'Novice Trader',
      2: 'Apprentice',
      3: 'Merchant',
      4: 'Master Trader',
      5: 'Market Maker',
      6: 'Trade Lord',
      7: 'Market Wizard',
      8: 'Grand Master',
      9: 'Trade Titan',
      10: 'Castle Lord',
    };
    
    return titles[level] ?? 'Unknown';
  }
}

// Custom painter for animated star field
class StarFieldPainter extends CustomPainter {
  final Animation<double> animation;
  final List<Star> stars = [];
  
  StarFieldPainter(this.animation) : super(repaint: animation) {
    // Generate random stars
    final random = Random();
    for (int i = 0; i < 100; i++) {
      stars.add(Star(
        x: random.nextDouble(),
        y: random.nextDouble(),
        size: random.nextDouble() * 2 + 0.5,
        speed: random.nextDouble() * 0.5 + 0.1,
      ));
    }
  }
  
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Colors.white;
    
    for (final star in stars) {
      final opacity = (sin(animation.value * 2 * pi * star.speed) + 1) / 2;
      paint.color = Colors.white.withOpacity(opacity * 0.8);
      
      canvas.drawCircle(
        Offset(star.x * size.width, star.y * size.height),
        star.size,
        paint,
      );
    }
  }
  
  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => true;
}

class Star {
  final double x;
  final double y;
  final double size;
  final double speed;
  
  Star({
    required this.x,
    required this.y,
    required this.size,
    required this.speed,
  });
}