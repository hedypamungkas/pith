import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const SAMPLE_HTML = `<!doctype html>
<html>
  <head><title>Sample Article</title></head>
  <body>
    <nav><a href="/">Home</a><a href="/about">About</a></nav>
    <div id="cookie-banner">We use cookies. Accept all.</div>
    <main>
      <article>
        <h1>Sample Article</h1>
        <p>This is the real content that should survive extraction. It talks
        about something specific enough to be recognizably the article body,
        not the boilerplate around it.</p>
        <p>A second paragraph adds enough length for Readability to treat
        this as an article rather than a stub page.</p>
      </article>
    </main>
    <footer>Copyright 2026. All rights reserved.</footer>
  </body>
</html>`;

export interface TestServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startTestHtmlServer(): Promise<TestServerHandle> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(SAMPLE_HTML);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export { SAMPLE_HTML };

const JS_RENDERED_TEXT =
  "This content only exists after JavaScript executes and mutates the DOM.";

const JS_SHELL_HTML = `<!doctype html>
<html>
  <head><title>Example App</title></head>
  <body>
    <div id="root">Loading...</div>
    <script>
      document.getElementById('root').innerHTML =
        '<main><article><h1>Rendered Title</h1><p>${JS_RENDERED_TEXT}</p></article></main>';
    </script>
  </body>
</html>`;

/**
 * Serves a page whose real content only appears after client-side JS runs —
 * proves the headless tier actually executes scripts rather than just
 * reading the initial response body, the way the static tier does.
 */
export async function startJsRenderTestServer(): Promise<TestServerHandle> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(JS_SHELL_HTML);
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

export { JS_RENDERED_TEXT };
