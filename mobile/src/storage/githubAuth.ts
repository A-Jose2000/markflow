import * as SecureStore from "expo-secure-store";

const GITHUB_TOKEN_KEY = "markflow.github-token.v1";

export async function loadGitHubToken(): Promise<string | undefined> {
  try {
    const token = await SecureStore.getItemAsync(GITHUB_TOKEN_KEY);
    const trimmedToken = token?.trim();

    return trimmedToken || undefined;
  } catch {
    return undefined;
  }
}

export async function saveGitHubToken(token: string): Promise<void> {
  const trimmedToken = token.trim();

  if (!trimmedToken) {
    await clearGitHubToken();
    return;
  }

  await SecureStore.setItemAsync(GITHUB_TOKEN_KEY, trimmedToken);
}

export async function clearGitHubToken(): Promise<void> {
  await SecureStore.deleteItemAsync(GITHUB_TOKEN_KEY);
}
