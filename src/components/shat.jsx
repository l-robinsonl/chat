import { useState, useEffect, useRef } from 'react';
import { Send, Users, LogOut, Settings, Circle, MessageCircle, X, Hash, User } from 'lucide-react';
import wsService from '../services/websocketService';


const ChatComponent = () => {
  // User state
  const [teamId, setTeamId] = useState('');
  const [userId, setUserId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [tempDisplayName, setTempDisplayName] = useState('');

  // Connection state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');

  // Chat state
  const [messages, setMessages] = useState([]);
  const [privateChats, setPrivateChats] = useState(new Map()); // Map of userId -> messages array
  const [newMessage, setNewMessage] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [typingUsers, setTypingUsers] = useState(new Set());

  // UI state
  const [showSettings, setShowSettings] = useState(false);
  const [activeChat, setActiveChat] = useState('main'); // 'main' or userId for private chat
  const [unreadCounts, setUnreadCounts] = useState(new Map()); // Track unread messages per chat

  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };
  useEffect(() => {
    scrollToBottom();
  }, [messages, privateChats, activeChat]);

  // WebSocket event handlers
  useEffect(() => {
    const handleConnectionStatus = (status) => {
      setConnectionStatus(status);
    };

    const handleAuthStatus = (authenticated) => {
      setIsAuthenticated(authenticated);
    };

    const handleMessage = (message) => {
      // Skip messages from the current user to avoid duplicates (we already show optimistic messages)
      if (message.isOwn) {
        return;
      }

      if (message.isPrivate) {
        // Handle private message
        const chatPartnerId = message.sender;
        setPrivateChats(prev => {
          const newChats = new Map(prev);
          const existingMessages = newChats.get(chatPartnerId) || [];
          newChats.set(chatPartnerId, [...existingMessages, message]);
          return newChats;
        });

        // Update unread count if not in active chat
        if (activeChat !== chatPartnerId) {
          setUnreadCounts(prev => {
            const newCounts = new Map(prev);
            newCounts.set(chatPartnerId, (newCounts.get(chatPartnerId) || 0) + 1);
            return newCounts;
          });
        }
      } else {
        // Handle public message
        setMessages(prev => [...prev, message]);

        // Update unread count for main chat if not active
        if (activeChat !== 'main' && message.type !== 'system') {
          setUnreadCounts(prev => {
            const newCounts = new Map(prev);
            newCounts.set('main', (newCounts.get('main') || 0) + 1);
            return newCounts;
          });
        }
      }
    };

    const handleSystemMessage = (content) => {
      const systemMessage = {
        id: Date.now() + Math.random(),
        type: 'system',
        content,
        sender: 'System',
        senderName: 'System',
        timestamp: new Date(),
        isOwn: false,
        isPrivate: false
      };
      setMessages(prev => [...prev, systemMessage]);
    };

    const handleOnlineUsers = (users) => {
      setOnlineUsers(users);
    };

    const handleUserJoined = (user) => {
      setOnlineUsers(prev => [...prev.filter(u => u.userId !== user.userId), {
        userId: user.userId,
        displayName: user.displayName
      }]);

      const systemMessage = {
        id: Date.now() + Math.random(),
        type: 'system',
        content: `${user.displayName} joined the chat`,
        sender: 'System',
        senderName: 'System',
        timestamp: new Date(),
        isOwn: false,
        isPrivate: false
      };
      setMessages(prev => [...prev, systemMessage]);
    };

    const handleUserLeft = (user) => {
      setOnlineUsers(prev => prev.filter(u => u.userId !== user.userId));

      const systemMessage = {
        id: Date.now() + Math.random(),
        type: 'system',
        content: `${user.displayName} left the chat`,
        sender: 'System',
        senderName: 'System',
        timestamp: new Date(),
        isOwn: false,
        isPrivate: false
      };
      setMessages(prev => [...prev, systemMessage]);
    };

    const handleTypingStart = (data) => {
      if (data.userId !== userId) {
        setTypingUsers(prev => new Set([...prev, `${data.userId}:${data.recipient || 'main'}`]));
      }
    };

    const handleTypingStop = (data) => {
      setTypingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(`${data.userId}:${data.recipient || 'main'}`);
        return newSet;
      });
    };

    // Register event listeners
    wsService.on('connectionStatusChange', handleConnectionStatus);
    wsService.on('authStatusChange', handleAuthStatus);
    wsService.on('message', handleMessage);
    wsService.on('systemMessage', handleSystemMessage);
    wsService.on('onlineUsersUpdate', handleOnlineUsers);
    wsService.on('userJoined', handleUserJoined);
    wsService.on('userLeft', handleUserLeft);
    wsService.on('typingStart', handleTypingStart);
    wsService.on('typingStop', handleTypingStop);

    return () => {
      // Cleanup event listeners
      wsService.off('connectionStatusChange', handleConnectionStatus);
      wsService.off('authStatusChange', handleAuthStatus);
      wsService.off('message', handleMessage);
      wsService.off('systemMessage', handleSystemMessage);
      wsService.off('onlineUsersUpdate', handleOnlineUsers);
      wsService.off('userJoined', handleUserJoined);
      wsService.off('userLeft', handleUserLeft);
      wsService.off('typingStart', handleTypingStart);
      wsService.off('typingStop', handleTypingStop);
    };
  }, [userId, activeChat]);

  // Handle login
  const handleLogin = async () => {
    if (!teamId.trim() || !userId.trim()) return;

    const finalDisplayName = tempDisplayName.trim() || userId;
    setDisplayName(finalDisplayName);

    try {
      await wsService.connect(teamId, userId, finalDisplayName);
    } catch (error) {
      console.error('Failed to connect:', error);
    }
  };

  // Handle logout
  const handleLogout = () => {
    wsService.disconnect();
    setIsAuthenticated(false);
    setMessages([]);
    setPrivateChats(new Map());
    setOnlineUsers([]);
    setUnreadCounts(new Map());
    setActiveChat('main');
    setConnectionStatus('disconnected');
  };

  // Send message
  const sendMessage = () => {
    if (!newMessage.trim() || !isAuthenticated) return;
    console.log("sending message", newMessage, "to", activeChat);
    const messageContent = newMessage.trim();
    let success = false;

    if (activeChat === 'main') {
      console.log("sending main chat message", messageContent);
      success = wsService.sendMessage(messageContent);

      // Add message optimistically to UI for main chat
      if (success) {
        const optimisticMessage = {
          id: Date.now() + Math.random(),
          type: 'userMessage',
          content: messageContent,
          sender: userId,
          senderName: displayName || userId,
          timestamp: new Date(),
          isOwn: true,
          isPrivate: false
        };
        setMessages(prev => [...prev, optimisticMessage]);
      }
    } else {
      console.log("sending private chat message", messageContent, "to", activeChat);
      success = wsService.sendPrivateMessage(messageContent, activeChat);

      // Add message optimistically to UI for private chat
      if (success) {
        const optimisticMessage = {
          id: Date.now() + Math.random(),
          type: 'privateMessage',
          content: messageContent,
          sender: userId,
          senderName: displayName || userId,
          recipient: activeChat,
          timestamp: new Date(),
          isOwn: true,
          isPrivate: true
        };

        setPrivateChats(prev => {
          const newChats = new Map(prev);
          const existingMessages = newChats.get(activeChat) || [];
          newChats.set(activeChat, [...existingMessages, optimisticMessage]);
          return newChats;
        });
      }
    }

    if (success) {
      setNewMessage('');
      // Stop typing indicator
      wsService.sendTyping(false, activeChat === 'main' ? null : activeChat);
    }
  };

  // Handle typing
  const handleTyping = (value) => {
    setNewMessage(value);

    // Send typing start
    wsService.sendTyping(true, activeChat === 'main' ? null : activeChat);

    // Clear existing timeout
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    // Set timeout to stop typing
    typingTimeoutRef.current = setTimeout(() => {
      wsService.sendTyping(false, activeChat === 'main' ? null : activeChat);
    }, 2000);
  };

  // Start private chat
  const startPrivateChat = (targetUserId) => {
    if (targetUserId === userId) return;

    setActiveChat(targetUserId);
    // Clear unread count
    setUnreadCounts(prev => {
      const newCounts = new Map(prev);
      newCounts.delete(targetUserId);
      return newCounts;
    });
  };

  // Switch to main chat
  const switchToMainChat = () => {
    setActiveChat('main');
    // Clear unread count
    setUnreadCounts(prev => {
      const newCounts = new Map(prev);
      newCounts.delete('main');
      return newCounts;
    });
  };

  // Close private chat
  const closePrivateChat = (targetUserId, e) => {
    e.stopPropagation();
    setPrivateChats(prev => {
      const newChats = new Map(prev);
      newChats.delete(targetUserId);
      return newChats;
    });
    setUnreadCounts(prev => {
      const newCounts = new Map(prev);
      newCounts.delete(targetUserId);
      return newCounts;
    });
    if (activeChat === targetUserId) {
      setActiveChat('main');
    }
  };

  // Update display name
  const updateDisplayName = () => {
    if (tempDisplayName.trim()) {
      const newName = tempDisplayName.trim();
      setDisplayName(newName);
      setShowSettings(false);
      wsService.updateDisplayName(newName);
    }
  };

  // Format timestamp
  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Get connection status color
  const getStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
      case 'authenticated':
        return 'text-green-500';
      case 'connecting':
        return 'text-yellow-500';
      case 'error':
      case 'auth_failed':
        return 'text-red-500';
      default:
        return 'text-gray-500';
    }
  };

  // Get current messages
  const getCurrentMessages = () => {
    if (activeChat === 'main') {
      return messages;
    }
    return privateChats.get(activeChat) || [];
  };

  // Get current typing users
  const getCurrentTypingUsers = () => {
    const chatId = activeChat === 'main' ? 'main' : activeChat;
    return Array.from(typingUsers)
      .filter(entry => entry.endsWith(`:${chatId}`))
      .map(entry => entry.split(':')[0]);
  };

  // Get active chat name
  const getActiveChatName = () => {
    if (activeChat === 'main') {
      return 'Team Chat';
    }
    const user = onlineUsers.find(u => u.userId === activeChat);
    return user ? (user.displayName || user.userId) : activeChat;
  };

  // Login screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Join Chat</h1>
            <p className="text-gray-600">Enter your team and user details</p>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Team ID
              </label>
              <input
                type="text"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                placeholder="e.g., team-alpha"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                User ID
              </label>
              <input
                type="text"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g., john-doe"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Display Name (optional)
              </label>
              <input
                type="text"
                value={tempDisplayName}
                onChange={(e) => setTempDisplayName(e.target.value)}
                placeholder="e.g., John Doe"
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              />
            </div>

            <button
              onClick={handleLogin}
              disabled={!teamId.trim() || !userId.trim() || connectionStatus === 'connecting'}
              className="w-full bg-blue-600 text-white py-3 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {connectionStatus === 'connecting' ? 'Connecting...' : 'Join Chat'}
            </button>

            {connectionStatus === 'authFailed' && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
                Failed to connect. Please check your connection and try again.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Main chat interface
  return (
    <div className="min-h-screen bg-gray-100 flex">
      {/* Sidebar */}
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Team Chat</h2>
              <p className="text-sm text-gray-600">{teamId}</p>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Settings size={20} />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>

          {/* Connection status */}
          <div className="flex items-center space-x-2">
            <Circle size={8} className={`${getStatusColor()} fill-current`} />
            <span className="text-sm text-gray-600 capitalize">
              {connectionStatus.replace('_', ' ')}
            </span>
          </div>
        </div>

        {/* Settings panel */}
        {showSettings && (
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <h3 className="text-sm font-medium text-gray-900 mb-3">Settings</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Display Name
                </label>
                <div className="flex space-x-2">
                  <input
                    type="text"
                    value={tempDisplayName}
                    onChange={(e) => setTempDisplayName(e.target.value)}
                    placeholder={displayName}
                    className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    onClick={updateDisplayName}
                    className="px-3 py-2 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    Update
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto">
          {/* Main chat */}
          <div
            onClick={switchToMainChat}
            className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${activeChat === 'main' ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
              }`}
          >
            <div className="flex items-center space-x-3">
              <Hash size={20} className="text-gray-500" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-900">Team Chat</span>
                  {unreadCounts.get('main') > 0 && (
                    <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 min-w-[20px] text-center">
                      {unreadCounts.get('main')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">Public team discussion</p>
              </div>
            </div>
          </div>

          {/* Private chats */}
          {Array.from(privateChats.keys()).map(chatPartnerId => {
            const user = onlineUsers.find(u => u.userId === chatPartnerId);
            const isOnline = !!user;
            const displayName = user?.displayName || chatPartnerId;

            return (
              <div
                key={chatPartnerId}
                onClick={() => startPrivateChat(chatPartnerId)}
                className={`p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors ${activeChat === chatPartnerId ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
                  }`}
              >
                <div className="flex items-center space-x-3">
                  <div className="relative">
                    <User size={20} className="text-gray-500" />
                    {isOnline && (
                      <Circle size={8} className="absolute -bottom-1 -right-1 text-green-500 fill-current bg-white rounded-full" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">{displayName}</span>
                      <div className="flex items-center space-x-2">
                        {unreadCounts.get(chatPartnerId) > 0 && (
                          <span className="bg-red-500 text-white text-xs rounded-full px-2 py-1 min-w-[20px] text-center">
                            {unreadCounts.get(chatPartnerId)}
                          </span>
                        )}
                        <button
                          onClick={(e) => closePrivateChat(chatPartnerId, e)}
                          className="p-1 hover:bg-gray-200 rounded transition-colors"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500">
                      {isOnline ? 'Online' : 'Offline'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Online users */}
          <div className="p-4">
            <div className="flex items-center space-x-2 mb-4">
              <Users size={16} className="text-gray-500" />
              <h3 className="text-sm font-medium text-gray-900">
                Online ({onlineUsers.length})
              </h3>
            </div>
            <div className="space-y-2">
              {onlineUsers.map(user => (
                <div
                  key={user.userId}
                  className="flex items-center justify-between group"
                >
                  <div className="flex items-center space-x-3">
                    <Circle size={8} className="text-green-500 fill-current" />
                    <span className="text-sm text-gray-700">
                      {user.userId === userId ?
                        `${user.displayName || user.userId} (you)` :
                        (user.displayName || user.userId)
                      }
                    </span>
                  </div>
                  {user.userId !== userId && (
                    <button
                      onClick={() => startPrivateChat(user.userId)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-all"
                      title="Start private chat"
                    >
                      <MessageCircle size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Chat header */}
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            {activeChat === 'main' ? (
              <Hash size={20} className="text-gray-500" />
            ) : (
              <User size={20} className="text-gray-500" />
            )}
            <div>
              <h1 className="text-xl font-semibold text-gray-900">
                {getActiveChatName()}
              </h1>
              <p className="text-sm text-gray-600">
                {activeChat === 'main' ?
                  `${onlineUsers.length} members online` :
                  `Private conversation`
                }
              </p>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {getCurrentMessages().map((message) => (
            <div
              key={message.id}
              className={`flex ${message.isOwn ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${message.type === 'system'
                  ? 'bg-gray-100 text-gray-600 text-center text-sm'
                  : message.isOwn
                    ? 'bg-blue-600 text-white'
                    : 'bg-white border border-gray-200 text-gray-900'
                  }`}
              >
                {message.type !== 'system' && !message.isOwn && (
                  <div className="text-xs font-medium mb-1 text-gray-500">
                    {message.senderName}
                  </div>
                )}
                <div className="break-words">{message.content}</div>
                <div
                  className={`text-xs mt-1 ${message.type === 'system'
                    ? 'text-gray-400'
                    : message.isOwn
                      ? 'text-blue-100'
                      : 'text-gray-400'
                    }`}
                >
                  {formatTime(message.timestamp)}
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicators */}
          {getCurrentTypingUsers().length > 0 && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-600 px-4 py-2 rounded-lg text-sm">
                {getCurrentTypingUsers().length === 1 ? (
                  <span>{getCurrentTypingUsers()[0]} is typing...</span>
                ) : (
                  <span>{getCurrentTypingUsers().length} people are typing...</span>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Message input */}
        <div className="bg-white border-t border-gray-200 p-4">
          <div className="flex space-x-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => handleTyping(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={
                activeChat === 'main'
                  ? "Type your message..."
                  : `Message ${getActiveChatName()}...`
              }
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
              disabled={!isAuthenticated}
            />
            <button
              onClick={sendMessage}
              disabled={!newMessage.trim() || !isAuthenticated}
              className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center space-x-2"
            >
              <Send size={20} />
            </button>
          </div>

          {activeChat !== 'main' && (
            <div className="mt-2 text-xs text-gray-500">
              This is a private conversation. Only you and {getActiveChatName()} can see these messages.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatComponent;
