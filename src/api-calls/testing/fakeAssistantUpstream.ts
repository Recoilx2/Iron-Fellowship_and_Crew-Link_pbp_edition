/**
 * Fake OpenAI-compatible model server for the GM assistant live tests
 * (ticket #129).
 *
 * Serves `/models` and streaming `/chat/completions`, records every chat
 * request it receives (model, messages, headers, whether the caller hung
 * up), and can be switched between answering, failing fast and stalling
 * mid-stream. The live tests point the stack's functions container at this
 * server over `host.docker.internal`, so nothing here ever leaves the test
 * run: the API key it checks is a throwaway test value.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type FakeUpstreamMode = "ok" | "fail" | "stall";

export interface ReceivedChatRequest {
  authorization: string | null;
  body: { model?: unknown; messages?: unknown } & Record<string, unknown>;
  /** True when the caller aborted before the reply finished. */
  aborted: boolean;
}

export interface FakeAssistantUpstream {
  /** Base URL the functions container reaches, e.g. http://host.docker.internal:4010. */
  containerUrl: string;
  receivedChats: ReceivedChatRequest[];
  receivedModelsRequests: number;
  mode: FakeUpstreamMode;
  /** SSE content chunks sent in `ok` mode. */
  chunks: string[];
  /** HTTP status sent in `fail` mode. */
  failStatus: number;
  close(): Promise<void>;
}

export const FAKE_CHAT_MODEL = "live-chat-model";
export const FAKE_OTHER_MODEL = "live-other-model";
export const FAKE_THIRD_MODEL = "live-third-model";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on("data", (chunk: Buffer) => parts.push(chunk));
    req.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    req.on("error", reject);
  });
}

export function startFakeAssistantUpstream(port: number): Promise<FakeAssistantUpstream> {
  const receivedChats: ReceivedChatRequest[] = [];
  let receivedModelsRequests = 0;
  const state: { mode: FakeUpstreamMode; chunks: string[]; failStatus: number } = {
    mode: "ok",
    chunks: ["Hello ", "traveller"],
    failStatus: 500,
  };
  const server: Server = createServer(async (req, res: ServerResponse) => {
    if (req.url === "/models" && req.method === "GET") {
      receivedModelsRequests += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          data: [
            { id: FAKE_CHAT_MODEL, context_length: 4096 },
            { id: FAKE_OTHER_MODEL },
            { id: FAKE_THIRD_MODEL, context_length: 16384 },
          ],
        }),
      );
      return;
    }
    if (req.url === "/chat/completions" && req.method === "POST") {
      const raw = await readBody(req);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      const record: ReceivedChatRequest = {
        authorization: req.headers.authorization ?? null,
        body: parsed,
        aborted: false,
      };
      receivedChats.push(record);
      if (state.mode === "fail") {
        res.writeHead(state.failStatus, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "fake upstream boom", type: "server_error" },
          }),
        );
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      if (state.mode === "stall") {
        // Send one chunk so the caller has something to stop, then hold the
        // connection open until the caller hangs up. Detect the hangup on
        // the response: when the client aborts mid-response the request
        // object is already fully consumed (readBody drained it), so its
        // `close` event does not fire again, but the response `close` fires
        // with writableEnded=false.
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: state.chunks[0] ?? "Part " } }] })}\n\n`,
        );
        await new Promise<void>((resolve) => {
          res.on("close", () => {
            if (!res.writableEnded) record.aborted = true;
            resolve();
          });
        });
        return;
      }
      for (const chunk of state.chunks) {
        res.write(
          `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`,
        );
      }
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "unknown fake path" }));
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "0.0.0.0", () => {
      resolve({
        containerUrl: `http://host.docker.internal:${port}`,
        receivedChats,
        get receivedModelsRequests() {
          return receivedModelsRequests;
        },
        get mode() {
          return state.mode;
        },
        set mode(mode: FakeUpstreamMode) {
          state.mode = mode;
        },
        get chunks() {
          return state.chunks;
        },
        set chunks(chunks: string[]) {
          state.chunks = chunks;
        },
        get failStatus() {
          return state.failStatus;
        },
        set failStatus(status: number) {
          state.failStatus = status;
        },
        close: () =>
          new Promise<void>((done) => {
            // Drop lingering stall-mode sockets first: close() alone waits
            // for every open connection, including aborted ones.
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
