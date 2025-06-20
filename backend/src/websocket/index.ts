import { WebSocketServer, WebSocket } from 'ws';
import { verify } from 'jsonwebtoken';
import { logger } from '../utils/logger';
import { getRedis } from '../services/redis';

interface AuthenticatedWebSocket extends WebSocket {
  userId?: number;
  isAlive?: boolean;
}

interface WSMessage {
  type: string;
  data?: any;
  id?: string;
}

export class WebSocketService {
  private static instance: WebSocketService;
  private wss!: WebSocketServer;
  private clients: Map<number, Set<AuthenticatedWebSocket>> = new Map();
  private redis = getRedis();
  private heartbeatInterval?: NodeJS.Timer;
  
  private constructor() {}
  
  static getInstance(): WebSocketService {
    if (!this.instance) {
      this.instance = new WebSocketService();
    }
    return this.instance;
  }
  
  initialize(wss: WebSocketServer) {
    this.wss = wss;
    this.setupWebSocketServer();
    this.startHeartbeat();
    this.subscribeToRedisEvents();
  }
  
  private setupWebSocketServer() {
    this.wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
      logger.info('New WebSocket connection attempt');
      
      // Extract token from query params
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const token = url.searchParams.get('token');
      
      if (!token) {
        ws.close(1008, 'Missing authentication token');
        return;
      }
      
      // Verify token
      try {
        const decoded = verify(token, process.env.JWT_SECRET!) as any;
        ws.userId = decoded.userId;
        ws.isAlive = true;
        
        // Add to clients map
        if (!this.clients.has(ws.userId)) {
          this.clients.set(ws.userId, new Set());
        }
        this.clients.get(ws.userId)!.add(ws);
        
        logger.info(`User ${ws.userId} connected via WebSocket`);
        
        // Send welcome message
        this.sendToClient(ws, {
          type: 'connected',
          data: {
            userId: ws.userId,
            timestamp: Date.now(),
          },
        });
        
        // Setup event handlers
        this.setupClientHandlers(ws);
        
      } catch (error) {
        logger.error('WebSocket auth failed:', error);
        ws.close(1008, 'Invalid authentication token');
      }
    });
  }
  
  private setupClientHandlers(ws: AuthenticatedWebSocket) {
    // Handle incoming messages
    ws.on('message', async (data) => {
      try {
        const message: WSMessage = JSON.parse(data.toString());
        await this.handleMessage(ws, message);
      } catch (error) {
        logger.error('Failed to handle WebSocket message:', error);
        this.sendError(ws, 'Invalid message format');
      }
    });
    
    // Handle pong for heartbeat
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    // Handle close
    ws.on('close', () => {
      if (ws.userId) {
        const userClients = this.clients.get(ws.userId);
        if (userClients) {
          userClients.delete(ws);
          if (userClients.size === 0) {
            this.clients.delete(ws.userId);
          }
        }
        logger.info(`User ${ws.userId} disconnected`);
      }
    });
    
    // Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket error:', error);
    });
  }
  
  private async handleMessage(ws: AuthenticatedWebSocket, message: WSMessage) {
    const { type, data, id } = message;
    
    switch (type) {
      case 'ping':
        this.sendToClient(ws, { type: 'pong', id });
        break;
        
      case 'subscribe':
        await this.handleSubscribe(ws, data);
        break;
        
      case 'unsubscribe':
        await this.handleUnsubscribe(ws, data);
        break;
        
      case 'get_active_trades':
        await this.handleGetActiveTrades(ws);
        break;
        
      case 'get_leaderboard_position':
        await this.handleGetLeaderboardPosition(ws);
        break;
        
      default:
        this.sendError(ws, `Unknown message type: ${type}`);
    }
  }
  
  private async handleSubscribe(ws: AuthenticatedWebSocket, data: any) {
    const { channel } = data;
    
    // Store subscription in Redis
    await this.redis.sadd(`subscriptions:${ws.userId}`, channel);
    
    this.sendToClient(ws, {
      type: 'subscribed',
      data: { channel },
    });
  }
  
  private async handleUnsubscribe(ws: AuthenticatedWebSocket, data: any) {
    const { channel } = data;
    
    // Remove subscription from Redis
    await this.redis.srem(`subscriptions:${ws.userId}`, channel);
    
    this.sendToClient(ws, {
      type: 'unsubscribed',
      data: { channel },
    });
  }
  
  private async handleGetActiveTrades(ws: AuthenticatedWebSocket) {
    // This would normally query the database
    // For now, send mock data
    this.sendToClient(ws, {
      type: 'active_trades',
      data: {
        trades: [],
      },
    });
  }
  
  private async handleGetLeaderboardPosition(ws: AuthenticatedWebSocket) {
    const userId = ws.userId!;
    
    // Get user's position from Redis
    const rank = await this.redis.zrevrank('leaderboard:global', userId.toString());
    const score = await this.redis.zscore('leaderboard:global', userId.toString());
    
    this.sendToClient(ws, {
      type: 'leaderboard_position',
      data: {
        rank: rank !== null ? rank + 1 : null,
        score: score ? parseInt(score) : 0,
      },
    });
  }
  
  private startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws: AuthenticatedWebSocket) => {
        if (ws.isAlive === false) {
          ws.terminate();
          return;
        }
        
        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }
  
  private subscribeToRedisEvents() {
    // Subscribe to Redis pub/sub for cross-server communication
    const subscriber = this.redis.duplicate();
    
    subscriber.subscribe('trade_updates');
    subscriber.subscribe('xp_updates');
    subscriber.subscribe('leaderboard_updates');
    
    subscriber.on('message', async (channel, message) => {
      try {
        const data = JSON.parse(message);
        
        switch (channel) {
          case 'trade_updates':
            await this.handleTradeUpdate(data);
            break;
          case 'xp_updates':
            await this.handleXPUpdate(data);
            break;
          case 'leaderboard_updates':
            await this.handleLeaderboardUpdate(data);
            break;
        }
      } catch (error) {
        logger.error('Failed to handle Redis message:', error);
      }
    });
  }
  
  private async handleTradeUpdate(data: any) {
    const { userId, trade } = data;
    
    this.sendToUser(userId, {
      type: 'trade_update',
      data: trade,
    });
  }
  
  private async handleXPUpdate(data: any) {
    const { userId, xpGained, totalXP, level, leveledUp } = data;
    
    this.sendToUser(userId, {
      type: 'xp_gained',
      data: {
        xpGained,
        totalXP,
        level,
        leveledUp,
      },
    });
  }
  
  private async handleLeaderboardUpdate(data: any) {
    // Broadcast to all connected clients subscribed to leaderboard
    const { updates } = data;
    
    for (const [userId, clients] of this.clients.entries()) {
      const subscriptions = await this.redis.smembers(`subscriptions:${userId}`);
      
      if (subscriptions.includes('leaderboard')) {
        const update = updates.find((u: any) => u.userId === userId);
        if (update) {
          this.sendToUser(userId, {
            type: 'leaderboard_update',
            data: update,
          });
        }
      }
    }
  }
  
  sendToUser(userId: number, message: WSMessage) {
    const userClients = this.clients.get(userId);
    
    if (userClients) {
      userClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          this.sendToClient(client, message);
        }
      });
    }
  }
  
  broadcast(message: WSMessage) {
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.sendToClient(client as AuthenticatedWebSocket, message);
      }
    });
  }
  
  private sendToClient(ws: WebSocket, message: WSMessage) {
    try {
      ws.send(JSON.stringify(message));
    } catch (error) {
      logger.error('Failed to send WebSocket message:', error);
    }
  }
  
  private sendError(ws: WebSocket, error: string) {
    this.sendToClient(ws, {
      type: 'error',
      data: { error },
    });
  }
  
  async publishTradeUpdate(userId: number, trade: any) {
    await this.redis.publish('trade_updates', JSON.stringify({
      userId,
      trade,
    }));
  }
  
  async publishXPUpdate(userId: number, xpData: any) {
    await this.redis.publish('xp_updates', JSON.stringify({
      userId,
      ...xpData,
    }));
  }
  
  async publishLeaderboardUpdate(updates: any[]) {
    await this.redis.publish('leaderboard_updates', JSON.stringify({
      updates,
    }));
  }
  
  shutdown() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    
    // Close all connections
    this.wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
  }
}

export function setupWebSocket(wss: WebSocketServer) {
  const wsService = WebSocketService.getInstance();
  wsService.initialize(wss);
  
  return wsService;
}