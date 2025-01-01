import { ApiClient } from "@twurple/api";
import { AccessToken, RefreshingAuthProvider } from "@twurple/auth";

export function createApiClient() {
  const clientId = import.meta.env.VITE_CLIENT_ID ?? "";

  const authProvider = new RefreshingAuthProvider({
    clientId,
    clientSecret: undefined as unknown as string,
  });
  authProvider.onRefreshFailure((userId, error) => {
    console.error(error);
    localStorage.removeItem(`twitch/${userId}`);
    localStorage.removeItem("userId");
  });

  const apiClient = new ApiClient({ authProvider });

  authProvider.onRefresh((userId, newTokenData) => {
    localStorage.setItem(`twitch/${userId}`, JSON.stringify(newTokenData));
  });

  let userId = localStorage.getItem("userId");
  if (userId !== null) {
    const token = localStorage.getItem(`twitch/${userId}`);
    if (token !== null) {
      authProvider.addUser(userId, JSON.parse(token) as AccessToken, ["chat"]);
    } else {
      userId = null;
      localStorage.removeItem("userId");
    }
  }

  async function setUser(token: AccessToken, userId?: string): Promise<string> {
    const previousUserId = localStorage.getItem("userId");
    if (previousUserId !== null) {
      localStorage.removeItem(`twitch/${previousUserId}`);
      authProvider.removeUser(previousUserId);
    }
    if (userId !== undefined) {
      localStorage.setItem("userId", userId);
      localStorage.setItem(`twitch/${userId}`, JSON.stringify(token));
      authProvider.addUser(userId, token, ["chat"]);
      return userId;
    } else {
      const userId = await authProvider.addUserForToken(token, ["chat"]);
      localStorage.setItem("userId", userId);
      localStorage.setItem(`twitch/${userId}`, JSON.stringify(token));
      return userId;
    }
  }

  // TODO: listen to https://developer.mozilla.org/en-US/docs/Web/API/Window/storage_event

  return {
    apiClient,
    setUser,
    userId,
    authProvider,
  };
}
