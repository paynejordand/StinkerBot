import { WebSocketServer } from "ws";
import sc from "string-comparison";

const POI = {
  1: "Next player",
  2: "Previous player",
  3: "Kill leader",
  4: "Closest enemy",
  5: "Closest player",
  6: "Last attacker",
};

export class ApexConnection {
  constructor(initCallback, disconnectCallback) {
    console.log("ApexConnection constructor called.");
    this.wss = null;
    this.swap = new Map();
    this.names = new Map();
    this.sessions = new Map();
    this.initCallback = initCallback;
    this.disconnectCallback = disconnectCallback;
  }

  connect() {
    console.log("ApexConnection connect called.");
    this.wss = new WebSocketServer({ port: 7777 });
    this.wss.on("connection", (ws) => {
      console.log("New client connected");

      // Message event handler
      ws.on("message", (message) => {
        this.handleApexWebSocketMessage(JSON.parse(message.toString()), ws);
      });

      // Close event handler
      ws.on("close", () => {
        this.handleConnectionClosed(ws);
      });
    });
    return this.wss;
  }

  // Helper functions
  closestName(broadcaster_id, name) {
    console.log("Finding closest match for name: " + name);
    try {
      const ws = this.sessions.get(broadcaster_id);
      const playerNames = this.names.get(ws);
      if (!playerNames) return name;
      return sc.jaroWinkler.sortMatch(name, Array.from(playerNames)).pop()
        .member;
    } catch (e) {
      console.error("Error finding closest name: " + e);
      return name;
    }
  }

  sendMessageToWebsocket(message, broadcaster_id) {
    var ws = this.sessions.get(broadcaster_id);
    if (ws && ws.readyState === WebSocket.OPEN) {
      console.log("Sending message to broadcaster: " + message);
      ws.send(message);
    } else {
      console.log("No active session for broadcaster ID: " + broadcaster_id);
    }
  }

  // Websocket Event Handlers
  handleApexWebSocketMessage(message, ws) {
    switch (message.category) {
      case "init":
        this.handleInitMessage(message, ws);
        break;
      case "playerConnected":
        this.handlePlayerConnectedMessage(message, ws);
        break;
      case "matchStateEnd":
        this.handleMatchStateEndMessage(message, ws);
        break;
      case "playerDamaged":
        this.handlePlayerDamagedMessage(message, ws);
        break;
    }
  }

  handleConnectionClosed(ws) {
    console.log("Client disconnected");
    // Remove websocket from sessions Map
    for (const [key, value] of this.sessions.entries()) {
      if (value === ws) {
        this.disconnectCallback(key);
        this.sessions.delete(key);
        break;
      }
    }
    // Clean up names and swap Maps
    this.names.delete(ws);
    this.swap.delete(ws);
  }

  // Message Type Handlers
  handleInitMessage(message, ws) {
    console.log("Initialization message received.");
    console.log(message);
    if (!message.name) {
      console.error("Initialization message missing broadcaster name.");
      return;
    }
    if (this.sessions.has(message.name)) {
      console.log(
        "Broadcaster " + message.name + " is already connected. Overwriting session."
      );
    }
    this.sessions.set(message.name, ws);
    this.swap.set(ws, true);
    this.names.set(ws, new Set());
    this.initCallback(message.name);
  }

  handlePlayerConnectedMessage(message, ws) {
    console.log("Player connected message received: " + message.player.name);
    const playerNames = this.names.get(ws);
    if (playerNames) {
      playerNames.add(message.player.name.toLowerCase());
    }
  }

  handleMatchStateEndMessage(message, ws) {
    console.log("Match state ended message received.");
    const matchEndNames = this.names.get(ws);
    if (matchEndNames) {
      matchEndNames.clear();
    }
  }

  handlePlayerDamagedMessage(message, ws) {
    if (message.attacker.nucleusHash !== "" && this.swap.get(ws)) {
      // console.log(message);
      this.swap.set(ws, false);
      ws.send(JSON.stringify({ changeCam: { name: message.attacker.name } }));
    }
  }

  // Functions for handling requests from twitch/bot
  handleSpectate(broadcaster_id, type, target) {
    if (type === "poi") {
      console.log("Changing to POI: " + (POI[target] || target));
      this.sendMessageToWebsocket(JSON.stringify({ changeCam: { poi: target } }), broadcaster_id);
      target = POI[target] || target;
    } else if (type === "name") {
      target = this.closestName(broadcaster_id, target);
      this.sendMessageToWebsocket(JSON.stringify({ changeCam: { name: target } }), broadcaster_id);
    }
    
    return target;
  }

  handleSwap(broadcaster_id) {
    const ws = this.sessions.get(broadcaster_id);
    if (ws) {
      this.swap.set(ws, true);
    }
  }
}
