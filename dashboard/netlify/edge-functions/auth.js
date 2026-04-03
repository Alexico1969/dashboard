const COOKIE_NAME = "cd_auth";
const COOKIE_MAX_AGE = 60 * 60 * 8; // 8 hours

export default async function handler(request, context) {
  const password = Deno.env.get("PSSW");

  // If no password is set, pass through
  if (!password) return context.next();

  const url = new URL(request.url);

  // Handle login form submission
  if (request.method === "POST" && url.pathname === "/_auth") {
    const body = await request.formData();
    const attempt = body.get("password") ?? "";

    if (attempt === password) {
      const response = new Response(null, {
        status: 302,
        headers: { Location: "/" },
      });
      response.headers.set(
        "Set-Cookie",
        `${COOKIE_NAME}=${password}; Path=/; Max-Age=${COOKIE_MAX_AGE}; HttpOnly; SameSite=Strict; Secure`
      );
      return response;
    }

    return loginPage(true);
  }

  // Check auth cookie
  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  const token = match ? match[1] : null;

  if (token === password) return context.next();

  return loginPage(false);
}

function loginPage(failed) {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>CloudDesk — Login</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0d1117;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 14px;
      padding: 40px 36px;
      width: 340px;
      text-align: center;
    }
    .logo { font-size: 2.5rem; margin-bottom: 12px; }
    h1 { font-size: 1.1rem; font-weight: 700; color: #e6edf3; margin-bottom: 4px; }
    p  { font-size: 0.8rem; color: #8b949e; margin-bottom: 28px; }
    input[type="password"] {
      width: 100%;
      padding: 10px 14px;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      color: #e6edf3;
      font-size: 0.9rem;
      outline: none;
      margin-bottom: 12px;
      transition: border-color 0.2s;
    }
    input[type="password"]:focus { border-color: #58a6ff; }
    button {
      width: 100%;
      padding: 10px;
      background: #238636;
      border: 1px solid #2ea043;
      border-radius: 8px;
      color: #fff;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    button:hover { background: #2ea043; }
    .error {
      font-size: 0.75rem;
      color: #f85149;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">☁️</div>
    <h1>CloudDesk Dashboard</h1>
    <p>Enter your password to continue</p>
    <form method="POST" action="/_auth">
      <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password"/>
      <button type="submit">Unlock</button>
      ${failed ? '<div class="error">Incorrect password. Try again.</div>' : ""}
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: failed ? 401 : 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export const config = { path: "/*" };
