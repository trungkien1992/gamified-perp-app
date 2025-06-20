// This is a simplified dependency for demonstration.
class WebSocketService {
    sendToUser(userId: number, data: any) {
      // In a real app, this would send data over a websocket.
      console.log(`Sending data to user ${userId}`, data);
    }
  }
  
  export const webSocketService = new WebSocketService();
  