import { WebSocketServer } from "ws";
import sc from "string-comparison";

var wss;
var swap = new Map();
var names = new Map();
const APEX_WEBSOCKET_URL = "ws://localhost:7777";
export const POI = {
  1: "Next player",
  2: "Previous player",
  3: "Kill leader",
  4: "Closest enemy",
  5: "Closest player",
  6: "Last attacker",
};

var sessions = new Map();

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
  switch(message.category) {
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
        ws.send(
          JSON.stringify({ changeCam: { name: message.attacker.name } })
        );
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

export function swapCam(broadcaster_id)
{
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
  }
  else {
    console.log("No active session for broadcaster ID: " + broadcaster_id);
  }
}