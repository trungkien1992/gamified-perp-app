import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../services/storage_service.dart';
import '../services/api_service.dart';

enum ConnectionStatus {
  connecting,
  connected,
  disconnected,
  error,
}

class WebSocketProvider extends ChangeNotifier {
  WebSocketChannel? _channel;
  ConnectionStatus _status = ConnectionStatus.disconnected;
  Timer? _reconnectTimer;
  Timer? _pingTimer;
  StreamSubscription? _connectivitySubscription;
  
  final Map<String, Function(Map<String, dynamic>)> _messageHandlers = {};
  final Map<String, Completer> _pendingRequests = {};
  final Set<String> _subscriptions = {};
  
  int _reconnectAttempts = 0;
  static const int _maxReconnectAttempts = 5;
  static const Duration _reconnectDelay = Duration(seconds: 2);
  
  ConnectionStatus get status => _status;
  bool get isConnected => _status == ConnectionStatus.connected;
  
  WebSocketProvider() {
    _setupConnectivityListener();
  }
  
  void _setupConnectivityListener() {
    _connectivitySubscription = Connectivity().onConnectivityChanged.listen(
      (ConnectivityResult result) {
        if (result != ConnectivityResult.none && _status == ConnectionStatus.disconnected) {
          connect();
        }
      },
    );
  }
  
  Future<void> connect() async {
    if (_status == ConnectionStatus.connecting || _status == ConnectionStatus.connected) {
      return;
    }
    
    _setStatus(ConnectionStatus.connecting);
    
    try {
      // Get auth token
      final token = await StorageService.getAuthToken();
      if (token == null) {
        throw Exception('No authentication token');
      }
      
      // Connect to WebSocket
      final wsUrl = ApiService.getWebSocketUrl(token);
      _channel = WebSocketChannel.connect(Uri.parse(wsUrl));
      
      // Listen to messages
      _channel!.stream.listen(
        _handleMessage,
        onError: _handleError,
        onDone: _handleDone,
        cancelOnError: false,
      );
      
      _setStatus(ConnectionStatus.connected);
      _reconnectAttempts = 0;
      _startPingTimer();
      
      // Resubscribe to channels
      _resubscribeToChannels();
      
    } catch (e) {
      debugPrint('WebSocket connection failed: $e');
      _setStatus(ConnectionStatus.error);
      _scheduleReconnect();
    }
  }
  
  void _handleMessage(dynamic message) {
    try {
      final data = json.decode(message);
      final type = data['type'] as String?;
      final id = data['id'] as String?;
      
      if (type == null) return;
      
      // Handle response to request
      if (id != null && _pendingRequests.containsKey(id)) {
        _pendingRequests[id]!.complete(data['data']);
        _pendingRequests.remove(id);
        return;
      }
      
      // Handle server-initiated messages
      switch (type) {
        case 'connected':
          debugPrint('WebSocket connected: ${data['data']}');
          break;
          
        case 'pong':
          // Heartbeat response
          break;
          
        case 'xp_gained':
          _notifyHandlers('xp_update', data['data']);
          break;
          
        case 'trade_update':
          _notifyHandlers('trade_update', data['data']);
          break;
          
        case 'leaderboard_update':
          _notifyHandlers('leaderboard_update', data['data']);
          break;
          
        case 'achievement_unlocked':
          _notifyHandlers('achievement', data['data']);
          break;
          
        case 'error':
          debugPrint('WebSocket error: ${data['data']}');
          break;
          
        default:
          debugPrint('Unknown message type: $type');
      }
    } catch (e) {
      debugPrint('Failed to handle WebSocket message: $e');
    }
  }
  
  void _handleError(error) {
    debugPrint('WebSocket error: $error');
    _setStatus(ConnectionStatus.error);
    _cleanup();
    _scheduleReconnect();
  }
  
  void _handleDone() {
    debugPrint('WebSocket connection closed');
    _setStatus(ConnectionStatus.disconnected);
    _cleanup();
    _scheduleReconnect();
  }
  
  void _scheduleReconnect() {
    if (_reconnectAttempts >= _maxReconnectAttempts) {
      debugPrint('Max reconnection attempts reached');
      return;
    }
    
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(
      _reconnectDelay * (_reconnectAttempts + 1),
      () {
        _reconnectAttempts++;
        connect();
      },
    );
  }
  
  void _startPingTimer() {
    _pingTimer?.cancel();
    _pingTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      send({'type': 'ping', 'id': DateTime.now().millisecondsSinceEpoch.toString()});
    });
  }
  
  void _cleanup() {
    _channel?.sink.close();
    _channel = null;
    _reconnectTimer?.cancel();
    _pingTimer?.cancel();
  }
  
  void _setStatus(ConnectionStatus newStatus) {
    if (_status != newStatus) {
      _status = newStatus;
      notifyListeners();
    }
  }
  
  void _notifyHandlers(String event, Map<String, dynamic> data) {
    _messageHandlers[event]?.call(data);
  }
  
  void _resubscribeToChannels() {
    for (final channel in _subscriptions) {
      send({
        'type': 'subscribe',
        'data': {'channel': channel},
      });
    }
  }
  
  // Public methods
  
  void send(Map<String, dynamic> message) {
    if (!isConnected || _channel == null) {
      debugPrint('Cannot send message: WebSocket not connected');
      return;
    }
    
    try {
      _channel!.sink.add(json.encode(message));
    } catch (e) {
      debugPrint('Failed to send WebSocket message: $e');
    }
  }
  
  Future<T?> request<T>(String type, Map<String, dynamic> data) async {
    if (!isConnected) {
      throw Exception('WebSocket not connected');
    }
    
    final id = DateTime.now().millisecondsSinceEpoch.toString();
    final completer = Completer<T>();
    
    _pendingRequests[id] = completer;
    
    send({
      'type': type,
      'data': data,
      'id': id,
    });
    
    // Timeout after 10 seconds
    return completer.future.timeout(
      const Duration(seconds: 10),
      onTimeout: () {
        _pendingRequests.remove(id);
        throw TimeoutException('WebSocket request timed out');
      },
    );
  }
  
  void subscribe(String channel) {
    _subscriptions.add(channel);
    
    if (isConnected) {
      send({
        'type': 'subscribe',
        'data': {'channel': channel},
      });
    }
  }
  
  void unsubscribe(String channel) {
    _subscriptions.remove(channel);
    
    if (isConnected) {
      send({
        'type': 'unsubscribe',
        'data': {'channel': channel},
      });
    }
  }
  
  void onMessage(String event, Function(Map<String, dynamic>) handler) {
    _messageHandlers[event] = handler;
  }
  
  void removeMessageHandler(String event) {
    _messageHandlers.remove(event);
  }
  
  Future<Map<String, dynamic>?> getActiveTrades() async {
    try {
      return await request<Map<String, dynamic>>('get_active_trades', {});
    } catch (e) {
      debugPrint('Failed to get active trades: $e');
      return null;
    }
  }
  
  Future<Map<String, dynamic>?> getLeaderboardPosition() async {
    try {
      return await request<Map<String, dynamic>>('get_leaderboard_position', {});
    } catch (e) {
      debugPrint('Failed to get leaderboard position: $e');
      return null;
    }
  }
  
  @override
  void dispose() {
    _cleanup();
    _connectivitySubscription?.cancel();
    super.dispose();
  }
}

// Extension for easy WebSocket usage in widgets
extension WebSocketContext on BuildContext {
  WebSocketProvider get ws => Provider.of<WebSocketProvider>(this, listen: false);
  
  void listenToWebSocket(String event, Function(Map<String, dynamic>) handler) {
    final ws = this.ws;
    ws.onMessage(event, handler);
  }
  
  void stopListeningToWebSocket(String event) {
    final ws = this.ws;
    ws.removeMessageHandler(event);
  }
}