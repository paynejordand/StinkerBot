import { WebSocketServer } from "ws";
import sc from "string-comparison";

var wss;
var swap = new Map();
var names = new Map();
const APEX_WEBSOCKET_URL = "ws://localhost:7777";

var sessions = new Map();

export class ApexConnection {
  constructor() {
    console.log("ApexConnection constructor called.");
    this.wss = null;
    this.swap = new Map();
    this.names = new Map();
    this.sessions = new Map();
  }
  connect() {
    console.log("ApexConnection connect called.");
    this.wss = new WebSocketServer({ port: 7777 });
    return this.wss;
  }

  handleInitMessage(message, ws) {
    console.log("Initialization message received.");
    console.log(message);
    this.sessions.set(message.name, ws);
    this.swap.set(ws, true);
    this.names.set(ws, new Set());
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

  handleSpectateMessage(message, ws) {
    console.log("--- Spectate Message ---");
    console.log(message);
  }

  handleConnectionClosed(ws) {
    console.log("Client disconnected");
    // Remove websocket from sessions Map
    for (const [key, value] of this.sessions.entries()) {
      if (value === ws) {
        this.sessions.delete(key);
        break;
      }
    }
    // Clean up names and swap Maps
    this.names.delete(ws);
    this.swap.delete(ws);
  }
}

// WebSocket will persist the application loop until you exit the program forcefully
export function startWebSocketServer(port) {
  wss = new WebSocketServer({ port: port });

  wss.on("error", console.error);

  wss.on("connection", (ws) => {
    console.log("New client connected");

    // Message event handler
    ws.on("message", (message) => {
      handleMessage(JSON.parse(message.toString()), ws);
    });

    // Close event handler
    ws.on("close", () => {
      console.log("Client disconnected");
      // Remove websocket from sessions Map
      for (const [key, value] of sessions.entries()) {
        if (value === ws) {
          sessions.delete(key);
          break;
        }
      }
      // Clean up names and swap Maps
      names.delete(ws);
      swap.delete(ws);
    });
  });
  return wss;
}

function handleMessage(message, ws) {
  //console.log("Handling message: " + message);
  switch (message.category) {
    case "init":
      console.log("Initialization message received.");
      console.log(message);
      sessions.set(message.name, ws);
      swap.set(ws, true);
      names.set(ws, new Set());
      break;
    case "playerConnected":
      console.log("Player connected message received: " + message.player.name);
      const playerNames = names.get(ws);
      if (playerNames) {
        playerNames.add(message.player.name.toLowerCase());
      }
      break;
    case "matchStateEnd":
      console.log("Match state ended message received.");
      const matchEndNames = names.get(ws);
      if (matchEndNames) {
        matchEndNames.clear();
      }
      break;
    case "playerDamaged":
      if (message.attacker.nucleusHash !== "" && swap.get(ws)) {
        // console.log(message);
        swap.set(ws, false);
        ws.send(JSON.stringify({ changeCam: { name: message.attacker.name } }));
      }
      break;
    case "observerAnnotation":
      console.log("--- Annotation ---");
      console.log(message);
      break;
  }
}

export function closestName(broadcaster_id, name) {
  console.log("Finding closest match for name: " + name);
  try {
    const ws = sessions.get(broadcaster_id);
    const playerNames = names.get(ws);
    if (!playerNames) return name;
    return sc.jaroWinkler.sortMatch(name, Array.from(playerNames)).pop().member;
  } catch (e) {
    console.error("Error finding closest name: " + e);
    return name;
  }
}

export function swapCam(broadcaster_id) {
  const ws = sessions.get(broadcaster_id);
  if (ws) {
    swap.set(ws, true);
  }
}

export function broadcastMessage(message, broadcaster_id) {
  var ws = sessions.get(broadcaster_id);
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log("Sending message to broadcaster: " + message);
    ws.send(message);
  } else {
    console.log("No active session for broadcaster ID: " + broadcaster_id);
  }
}
