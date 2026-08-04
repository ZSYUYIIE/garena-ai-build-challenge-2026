const extensionIdPattern = /^[a-p]{32}$/;

export function isAllowedExtensionOrigin(origin) {
  if (typeof origin !== "string" || !origin) return false;

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "chrome-extension:" &&
      extensionIdPattern.test(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      !parsed.search &&
      !parsed.hash &&
      (parsed.pathname === "" || parsed.pathname === "/")
    );
  } catch {
    return false;
  }
}

export function rejectUpgrade(socket, statusCode, message) {
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${statusCode} ${httpStatusText(statusCode)}\r\n` +
      "Connection: close\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      "\r\n" +
      body
  );
}

function httpStatusText(statusCode) {
  if (statusCode === 403) return "Forbidden";
  if (statusCode === 404) return "Not Found";
  return "Bad Request";
}
