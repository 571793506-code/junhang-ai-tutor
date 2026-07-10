import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { recognizeImages } from "./ocr-node.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test("MiniMax page OCR limits concurrency to two and preserves page order", async () => {
  let active = 0;
  let maxActive = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      const payload = JSON.parse(body);
      const page = Number(String(payload.image_url).match(/page-(\d+)/)?.[1] || 0);
      active += 1;
      maxActive = Math.max(maxActive, active);
      setTimeout(() => {
        active -= 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          content: JSON.stringify({
            text: `page-${page}`,
            studentAnswerText: `answer-${page}`,
            printedText: `prompt-${page}`,
            confidence: 0.9,
            questions: []
          })
        }));
      }, page === 1 ? 60 : page === 2 ? 15 : 5);
    });
  });
  const address = await listen(server);

  try {
    const result = await recognizeImages(
      {
        OCR_ENGINE: "vision",
        OCR_VISION_PROVIDER: "minimax",
        OCR_VISION_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        OCR_VISION_API_KEY: "test-key",
        OCR_VISION_MODEL: "coding_plan/vlm"
      },
      {
        images: [1, 2, 3].map((page) => ({ dataUrl: `data:image/png;base64,page-${page}` }))
      }
    );

    assert.equal(maxActive, 2);
    assert.deepEqual(result.raw.pages.map((item) => item.text), ["page-1", "page-2", "page-3"]);
    assert.ok(result.text.indexOf("page-1") < result.text.indexOf("page-2"));
    assert.ok(result.text.indexOf("page-2") < result.text.indexOf("page-3"));
  } finally {
    await close(server);
  }
});
