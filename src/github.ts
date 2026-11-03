const API = "https://api.github.com";

export class GitHubError extends Error {}

function headers(): Record<string, string> {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token === "") {
    throw new GitHubError("GITHUB_TOKEN is not set; the search API allows ten unauthenticated requests a minute");
  }
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}

/** Null on 404, so a missing file or release is an answer rather than an error. */
export async function getJson<T>(path: string): Promise<T | null> {
  const response = await fetch(`${API}${path}`, { headers: headers() });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new GitHubError(`${path} answered ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}
