// websocketService.js
class WebSocketService {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectInterval = 3000;
    this.maxReconnectAttempts = 5;
    this.reconnectAttempts = 0;
    this.isAuthenticated = false;
    this.userInfo = null;
  }

  // Add event listener
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  // Remove event listener
  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  // Emit event to all listeners
  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in ${event} listener:`, error);
        }
      });
    }
  }

  // Connect to WebSocket
  connect(teamId, userId, displayName) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    this.userInfo = { teamId, userId, displayName };
    
    return new Promise((resolve, reject) => {
      this.emit('connectionStatusChange', 'connecting');
      
      this.ws = new WebSocket('ws://localhost:8081/ws');

      this.ws.onopen = () => {

        this.reconnectAttempts = 0;
        this.emit('connectionStatusChange', 'connected');

        // Send authentication message
        const authMessage = {
          type: 'auth',
          token: 'fake_development_token',
          teamId: teamId,
          userId: userId,
          displayName: displayName
        };

        this.send(authMessage);
        resolve();
      };

      this.ws.onmessage = (event) => {
        console.log('WebSocket message received:', event.data);
        
        // Function to split concatenated JSON messages
        const splitJsonMessages = (str) => {
          const messages = [];
          let braceCount = 0;
          let currentMessage = '';
          
          for (let i = 0; i < str.length; i++) {
            const char = str[i];
            currentMessage += char;
            
            if (char === '{') {
              braceCount++;
            } else if (char === '}') {
              braceCount--;
              
              // When braceCount reaches 0, we have a complete JSON object
              if (braceCount === 0) {
                messages.push(currentMessage);
                currentMessage = '';
              }
            }
          }
          
          return messages;
        };
        
        try {
          const messages = splitJsonMessages(event.data);
          
          messages.forEach(messageStr => {
            if (messageStr.trim()) { // Only process non-empty messages
              try {
                const data = JSON.parse(messageStr);
                this.handleMessage(data);
              } catch (parseError) {
                console.error('Error parsing individual message:', parseError);
                console.error('Problematic message:', messageStr);
              }
            }
          });
          
        } catch (error) {
          console.error('Error processing WebSocket messages:', error);
        }
      };
      this.ws.onclose = (event) => {
        this.isAuthenticated = false;
        this.emit('connectionStatusChange', 'disconnected');
        this.emit('authStatusChange', false);

        // Attempt to reconnect if not manually closed
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          setTimeout(() => {
            this.reconnectAttempts++;
            if (this.userInfo) {
              this.connect(this.userInfo.teamId, this.userInfo.userId, this.userInfo.displayName);
            }
          }, this.reconnectInterval);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('connectionStatusChange', 'error');
        reject(error);
      };
    });
  }

  // Handle incoming messages
  handleMessage(data) {
    switch (data.type) {
      case 'authSuccess':
        this.isAuthenticated = true;
        this.emit('connectionStatusChange', 'authenticated');
        this.emit('authStatusChange', true);
        this.emit('systemMessage', 'Successfully connected to chat');
        this.requestOnlineUsers();
        break;

      case 'authError':
        this.isAuthenticated = false;
        this.emit('connectionStatusChange', 'auth_failed');
        this.emit('authStatusChange', false);
        this.emit('systemMessage', 'Authentication failed: ' + data.message);
        break;

      case 'userMessage':
  
        this.emit('message', {
          id: Date.now() + Math.random(),
          type: 'userMessage',
          content: data.content,
          sender: data.senderId,
          senderName: data.senderName,
          recipient: data.recipientId,
          timestamp: new Date(data.timestamp || Date.now()),
          isOwn: data.senderId === this.userInfo?.userId,
          isPrivate: !!data.recipientId
        });
        break;

      case 'privateMessage':
        this.emit('message', {
          id: Date.now() + Math.random(),
          type: 'privateMessage',
          content: data.content,
          sender: data.senderId,
          senderName: data.senderName,
          recipient: data.recipientId,
          timestamp: new Date(data.timestamp || Date.now()),
          isOwn: data.senderId === this.userInfo?.userId,
          isPrivate: true
        });
        break;

      case 'systemAlert':
        this.emit('systemMessage', data.message);
        break;

      case 'onlineUsers':
        this.emit('onlineUsersUpdate', data.users || []);
        break;

      case 'userJoined':
        this.emit('userJoined', {
          userId: data.userId,
          userName: data.userName || data.userId,
          displayName: data.displayName
        });
        break;

      case 'userLeft':
        this.emit('userLeft', {
          userId: data.userId,
          userName: data.userName || data.userId
        });
        break;

      case 'typingStart':
        this.emit('typingStart', {
          userId: data.userId,
          userName: data.userName,
          recipient: data.recipientId
        });
        break;

      case 'typingStop':
        this.emit('typingStop', {
          userId: data.userId,
          recipient: data.recipientId
        });
        break;

      default:
        console.log('Unknown message type:', data);
    }
  }

  // Send message
  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  // Send public message
  sendMessage(content) {
    if (!this.isAuthenticated || !content.trim()) return false;
    return this.send({
      type: 'userMessage',
      content: content.trim(),
      senderId: this.userInfo.userId,
      senderName: this.userInfo.displayName || this.userInfo.userId,
      teamId: this.userInfo.teamId,
      timestamp: new Date().toISOString()
    });
  }

  // Send private message
  sendPrivateMessage(content, recipientId) {
    if (!this.isAuthenticated || !content.trim() || !recipientId) return false;

    return this.send({
      type: 'privateMessage',
      content: content.trim(),
      senderId: this.userInfo.userId,
      senderName: this.userInfo.displayName || this.userInfo.userId,
      recipientId: recipientId,
      teamId: this.userInfo.teamId,
      timestamp: new Date().toISOString()
    });
  }

  // Send typing indicator
  sendTyping(isTyping, recipientId = null) {
    if (!this.isAuthenticated) return false;

    return this.send({
      type: isTyping ? 'typingStart' : 'typingStop',
      userId: this.userInfo.userId,
      userName: this.userInfo.displayName || this.userInfo.userId,
      recipientId: recipientId,
      teamId: this.userInfo.teamId
    });
  }

  // Request online users
  requestOnlineUsers() {
    return this.send({
      type: 'getOnlineUsers'
    });
  }

  // Update display name
  updateDisplayName(newDisplayName) {
    if (!this.isAuthenticated) return false;

    this.userInfo.displayName = newDisplayName;
    return this.send({
      type: 'updateDisplayName',
      displayName: newDisplayName,
      userId: this.userInfo.userId,
      teamId: this.userInfo.teamId
    });
  }

  // Disconnect
  disconnect() {
    if (this.ws) {
      this.ws.close(1000, 'User disconnected');
      this.ws = null;
    }
    this.isAuthenticated = false;
    this.userInfo = null;
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
  }

  // Get connection state
  getConnectionState() {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return this.isAuthenticated ? 'authenticated' : 'connected';
      case WebSocket.CLOSING:
        return 'disconnecting';
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'unknown';
    }
  }
}

// Create singleton instance
const wsService = new WebSocketService();
export default wsService;