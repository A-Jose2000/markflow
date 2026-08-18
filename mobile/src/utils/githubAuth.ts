const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_AUTHENTICATED_USER_URL = "https://api.github.com/user";

export interface GitHubTokenValidation {
  login: string;
}

export async function validateGitHubToken(token: string): Promise<GitHubTokenValidation> {
  const response = await fetch(GITHUB_AUTHENTICATED_USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    }
  });

  if (!response.ok) {
    throw new Error(messageFromGitHubAuthResponse(response));
  }

  const payload: unknown = await response.json();

  if (!payload || typeof payload !== "object" || typeof (payload as { login?: unknown }).login !== "string") {
    throw new Error("GitHub accepted the token, but returned an unexpected account response.");
  }

  return {
    login: (payload as { login: string }).login
  };
}

function messageFromGitHubAuthResponse(response: Response): string {
  if (response.status === 401) {
    return "GitHub rejected this token. Revoke it, create a new token, and paste the new value.";
  }

  if (response.status === 403) {
    return "GitHub accepted the request but blocked access. Check token restrictions and organization SSO.";
  }

  return `Could not validate GitHub token (${response.status} ${response.statusText}).`;
}
