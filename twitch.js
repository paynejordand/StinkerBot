import WebSocket from "ws";
import { inRange } from "./util.js";
import { POI } from "./constants.js";

const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";
const SPECTATE_COOLDOWN_MS = 10 * 1000; // 10 second cooldown

export class TwitchConnection {
  constructor() {
    console.log("TwitchConnection constructor called.");
    this.ws = null;
    this.websocketSessionID = null;
    this.scoreLink = "";
    this.spectateCooldowns = new Map();
  }

  get WebSocket() {
    return this.ws;
  }

  set sessionID(id) {
    console.log("Setting TwitchConnection sessionID: " + id);
    this.websocketSessionID = id;
  }

  connect() {
    console.log("TwitchConnection connect called.");
    this.ws = new WebSocket(EVENTSUB_WEBSOCKET_URL);
    return this.ws;
  }

  async registerEventSubListener(broadcaster_id) {
    console.log(
      "Registering EventSub listener for broadcaster_id: " + broadcaster_id,
    );
    let response = await fetch(
      "https://api.twitch.tv/helix/eventsub/subscriptions",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.OAUTH_TOKEN_BOT,
          "Client-Id": process.env.CLIENT_ID,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: broadcaster_id,
            user_id: process.env.BOT_CHANNEL_ID,
          },
          transport: {
            method: "websocket",
            session_id: this.websocketSessionID,
          },
        }),
      },
    );

    if (response.status != 202) {
      let data = await response.json();
      console.error(
        "Failed to subscribe to channel.chat.message. API call returned status code " +
          response.status,
      );
      console.error(data);
      process.exit(1);
    } else {
      const data = await response.json();
      console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
    }
  }

  isModerator(badges) {
    for (const badge of badges) {
      if (badge.set_id == "moderator") {
        return true;
      }
    }
    return false;
  }

  isBroadcaster(badges) {
    for (const badge of badges) {
      if (badge.set_id == "broadcaster") {
        return true;
      }
    }
    return false;
  }

  handleHelpCommand(broadcaster_id) {
    this.sendChatMessage(
      "Available commands: !spectate <name|(1-6)>, !swap, !score",
      broadcaster_id,
    );
  }

  handleSpectateCommand(messageText, broadcaster_id) {
    let parts = messageText.split(" ");

    // Check cooldown
    const now = Date.now();
    const lastCooldown = this.spectateCooldowns.get(broadcaster_id);
    if (lastCooldown && now - lastCooldown < SPECTATE_COOLDOWN_MS) {
      const remainingTime = Math.ceil(
        (SPECTATE_COOLDOWN_MS - (now - lastCooldown)) / 1000,
      );
      this.sendChatMessage(
        `Please wait ${remainingTime} second(s) before using !spectate again.`,
        broadcaster_id,
      );
      return { type: "invalid", target: null };
    }
    this.spectateCooldowns.set(broadcaster_id, now);

    if (parts.length == 1) {
      this.sendChatMessage("Usage: !spectate <name|(1-6)>", broadcaster_id);
      return { type: "invalid", target: null };
    }

    if (inRange(parseInt(parts[1]), 1, 6)) {
      let targetPOI = POI[parseInt(parts[1])] || null;
      this.sendChatMessage(
        "Switching to player of interest: " + targetPOI,
        broadcaster_id,
      );
      return {
        type: "poi",
        target: targetPOI,
      };
    } else {
      let playerName = "";
      for (let i = 1; i < parts.length; i++) {
        playerName += parts[i];
        if (i != parts.length - 1) {
          playerName += " ";
        }
      }
      console.log("Original player name: " + playerName);
      //playerName = closestName(broadcaster_id, playerName);
      this.sendChatMessage(
        "Switching to player with the closest name to: " + playerName,
        broadcaster_id,
      );
      return {
        type: "name",
        target: playerName,
      };
    }
  }

  handleSwapCommand(broadcaster_id) {
    self.sendChatMessage(
      "Swapping to next instance of player damage!",
      broadcaster_id,
    );
  }

  async handleSetScoreCommand(badges, newScoreLink, broadcaster_id) {
    // check if user is a moderator
    if (!this.isModerator(badges) && !this.isBroadcaster(badges)) {
      this.sendChatMessage(
        "Only mods in this channel can use this command!",
        broadcaster_id,
      );
      return;
    }

    try {
      let response = await fetch(newScoreLink);
      if (response.status !== 200) {
        this.sendChatMessage("Invalid link.", broadcaster_id);
        return;
      }
    } catch (error) {
      console.error(error);
      this.sendChatMessage("Invalid link.", broadcaster_id);
      return;
    }
    // TODO: may want to make sure this link follows the right format for OS/summary
    this.scoreLink = newScoreLink;
    this.sendChatMessage("Score link set to " + newScoreLink, broadcaster_id);
  }

  async handleScoreCommand(broadcaster_id) {
    if (!this.scoreLink) {
      this.sendChatMessage("No valid link for scores set.", broadcaster_id);
      return;
    }
    try {
      let response = await fetch(this.scoreLink);
      if (response.status !== 200) {
        this.sendChatMessage("Invalid link was set.", broadcaster_id);
        return;
      }
      this.sendChatMessage(await response.text(), broadcaster_id);
    } catch (error) {
      console.error(error);
      return;
    }
  }

  handleShuffleCommand(badges, broadcaster_id) {
    if (!isModerator(badges) && !isBroadcaster(badges)) {
      sendChatMessage(
        "Only mods in this channel can use this command!",
        broadcaster_id,
      );
      return;
    }
  }

  async sendChatMessage(message, broadcaster_id) {
    let response = await fetch("https://api.twitch.tv/helix/chat/messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.OAUTH_TOKEN_BOT,
        "Client-Id": process.env.CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        broadcaster_id: broadcaster_id,
        sender_id: process.env.BOT_CHANNEL_ID,
        message: message,
      }),
    });
    if (response.status != 200) {
      let data = await response.json();
      console.error("Failed to send chat message");
      console.error(data);
    } else {
      console.log("Sent chat message: " + message);
    }
  }
}
