import http from 'http';
import app from './app';
import { webSocketService } from './services/WebSocketService';
const server = http.createServer(app);
webSocketService.init(server);
server.listen(8080, () => {
  console.log('Server running on http://localhost:8080');
});
