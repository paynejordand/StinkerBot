import dotenv from "dotenv";
dotenv.config();

const EXPIRATION_DEFAULT = 45 * 60 * 1000; // minutes * seconds * milliseconds

export async function validateToken() {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    method: "GET",
    headers: {
      Authorization: "OAuth " + process.env.OAUTH_TOKEN_BOT,
    },
  });
  if (response.status != 200) {
    console.log("Token validation failed with status code " + response.status);
    return false;
  }
  console.log("Token is valid.");
  setTimeout(() => validateToken(), EXPIRATION_DEFAULT);
  return true;
}

export async function refreshToken() {
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body:
      "grant_type=refresh_token&client_id=" +
      process.env.CLIENT_ID +
      "&refresh_token=" +
      process.env.REFRESH_TOKEN_BOT +
      "&client_secret=" +
      process.env.CLIENT_SECRET,
  });

  if (response.status != 200) {
    console.log("Token refresh failed with status code " + response.status);
    return false;
  }

  const data = await response.clone().json();
  process.env.OAUTH_TOKEN_BOT = data.access_token;
  process.env.REFRESH_TOKEN_BOT = data.refresh_token;
  console.log(
    "Token refreshed. New access token expires in " +
      data.expires_in +
      " seconds.",
  );
  setTimeout(
    () => refreshToken(),
    data.expires_in * 1000 - 10000, // Subtract 10 seconds to ensure token is refreshed before it expires
  );

  return true;
}

export async function getAuth(oauthToken, _refreshToken) {
  // https://dev.twitch.tv/docs/authentication/validate-tokens/#how-to-validate-a-token
  let response = await validateToken(oauthToken);
  console.log(await response.clone().json());

  if (response.status != 200) {
    console.log("-- Attempting to refresh token --");
    let response = await refreshToken(_refreshToken);
    let data = await response.json();
    if (response.status != 200) {
      console.log(response);
      console.error(
        "Token is not valid. /oauth2/token returned status code " +
          response.status,
      );
      console.error(data);
      return false;
    }
    oauthToken = data.access_token;
    _refreshToken = data.refresh_token;
  }

  console.log("Validated token.");
  process.env.OAUTH_TOKEN_BOT = oauthToken;
  process.env.REFRESH_TOKEN_BOT = _refreshToken;
  setTimeout(
    () => getAuth(process.env.OAUTH_TOKEN_BOT, process.env.REFRESH_TOKEN_BOT),
    EXPIRATION_DEFAULT,
  );
  return true;
}
