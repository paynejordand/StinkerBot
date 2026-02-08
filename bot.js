import { refreshToken, validateToken } from "./auth.js";
import { ApexConnection } from "./apex.js";
import { TwitchConnection } from "./twitch.js";

import dotenv from "dotenv";
dotenv.config();

// Twitch Connection Callbacks
const handleSpectate = (broadcaster_id, type, target) => {
  console.log("Handling spectate for: " + type + " : " + target);
  const finalTarget = apexConnection.handleSpectate(
    broadcaster_id,
    type,
    target,
  );
  return "We swapped to " + finalTarget + "!";
};

const handleSwap = (broadcaster_id) => {
  console.log("Handling swap for: " + broadcaster_id);
  apexConnection.handleSwap(broadcaster_id);
};

// Apex Connection Callbacks
const handleInit = (broadcaster_id) => {
  console.log("Handling init for: " + broadcaster_id);
  twitchConnection.registerEventSubListener(broadcaster_id);
};

const handleDisconnect = (broadcaster_id) => {
  console.log("Handling disconnect for: " + broadcaster_id);
  twitchConnection.deregisterEventSubListener(broadcaster_id);
};

const handleKraberPickup = (broadcaster_id, playerName) => {
  console.log(
    "Kraber picked up by " + playerName + " on broadcaster " + broadcaster_id,
  );
  twitchConnection.sendChatMessage(
    "WEE WOO! " + playerName + " has a Kraber!",
    broadcaster_id,
  );
};

// Instantiate Connections
const twitchConnection = new TwitchConnection(handleSpectate, handleSwap);
const apexConnection = new ApexConnection(
  handleInit,
  handleDisconnect,
  handleKraberPickup,
);

// Start executing the bot from here
(async () => {
  // Verify that the authentication is valid
  const refreshSuccess = await refreshToken();
  if (!refreshSuccess) {
    console.error("Failed to refresh token during startup. Exiting.");
    process.exit(1);
  }
  const validateSuccess = await validateToken();
  if (!validateSuccess) {
    console.error("Failed to validate Twitch OAuth token. Exiting.");
    process.exit(1);
  }

  const twitchWS = twitchConnection.connect();
  const apexWSS = apexConnection.connect();
})();