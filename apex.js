import { WebSocketServer } from "ws";
import sc from "string-comparison";

var wss;
var swap = true;
var names = new Set();

// WebSocket will persist the application loop until you exit the program forcefully

function startWebSocketServer(port) {
  wss = new WebSocketServer({ port: port });
  names.add("stinker");
  names.add("rah");
  wss.on("error", console.error);

  wss.on("connection", (ws) => {
    console.log("New client connected");

    // Message event handler
    ws.on("message", (message) => {
      console.log(`Received: ${message}`);
      handleMessage(JSON.parse(message.toString()));
    });

    // Close event handler
    ws.on("close", () => {
      console.log("Client disconnected");
    });
  });
  return wss;
}

function handleMessage(message) {
  //console.log("Handling message: " + message);
  switch(message.category) {
    case "init":
      console.log("Initialization message received.");
      break;
    case "playerConnected":
      console.log("Player connected message received: " + message.player.name);
      names.add(message.player.name.toLowerCase());
      break;
    case "matchStateEnded":
      console.log("Match state ended message received.");
      names.clear();
      break;
    case "playerDamaged":
      console.log("Player damaged message received.");
      if (message.attacker.nucleasHash == "") break; // Ignore non-player damage
      if (swap) { 
        swap = false;
        broadcastMessage(JSON.stringify({ changeCam: { name: message.attacker.name } }));
      }
      break;
    default:
      console.log("Unknown message category: " + message.category);
  }
}

function closestName(name) {
  return sc.levenshtein.sortMatch(name, Array.from(names)).pop().member;
}

function swapCam()
{
  swap = true;
}

function broadcastMessage(message) {
  console.log("Broadcasting message: " + message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

export { startWebSocketServer, swapCam, broadcastMessage, closestName };