/**
 * Basic Auth validation utility.
 * Decodes Authorization header and compares against env vars.
 */

export function validateBasicAuth(request: Request): {
  valid: boolean;
  error?: string;
} {
  const authHeader = request.headers.get("Authorization");

  if (!authHeader) {
    return { valid: false, error: "Missing Authorization header" };
  }

  if (!authHeader.startsWith("Basic ")) {
    return { valid: false, error: "Invalid Authorization scheme. Expected Basic." };
  }

  const expectedUsername = process.env.BASIC_AUTH_USERNAME;
  const expectedPassword = process.env.BASIC_AUTH_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    console.error("BASIC_AUTH_USERNAME or BASIC_AUTH_PASSWORD not configured");
    return { valid: false, error: "Server authentication not configured" };
  }

  try {
    const base64Credentials = authHeader.slice(6); // Remove "Basic "
    const credentials = atob(base64Credentials);
    const [username, password] = credentials.split(":");

    if (username === expectedUsername && password === expectedPassword) {
      return { valid: true };
    }

    return { valid: false, error: "Invalid credentials" };
  } catch {
    return { valid: false, error: "Malformed Authorization header" };
  }
}
