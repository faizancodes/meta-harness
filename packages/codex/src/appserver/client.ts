import { createInterface } from "node:readline";
import { HarnessError } from "@metaharness/core";
import { spawnCodexAppServer } from "./transport-stdio.js";
import type {
  CodexAppServerClientConfig,
  CodexAppServerClientLike,
  CodexAppServerErrorLike,
  CodexAppServerInboundMessage,
  CodexAppServerInitializeParams,
  CodexAppServerJsonRpcId,
  CodexAppServerResponseLike,
  CodexAppServerThreadResponseLike,
  CodexAppServerThreadResumeParamsLike,
  CodexAppServerThreadStartParamsLike,
  CodexAppServerTurnResponseLike,
  CodexAppServerTurnStartParamsLike
} from "./protocol.js";
import type { CodexAppServerStdioTransport } from "./transport-stdio.js";

export class CodexAppServerClient implements CodexAppServerClientLike {
  private readonly pending = new Map<
    CodexAppServerJsonRpcId,
    {
      reject: (error: Error) => void;
      resolve: (value: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly queue = new AsyncQueue<CodexAppServerInboundMessage>();
  private readonly rl: ReturnType<typeof createInterface>;
  private nextId = 1;

  constructor(
    private readonly config: CodexAppServerClientConfig,
    private readonly transport: CodexAppServerStdioTransport = spawnCodexAppServer(config)
  ) {
    this.rl = createInterface({
      input: transport.process.stdout
    });
    this.rl.on("line", (line) => this.handleLine(line));
    transport.process.once("error", (error) => this.fail(error));
    transport.process.once("exit", (code, signal) => {
      this.fail(
        new HarnessError(
          `Codex app-server exited unexpectedly with code ${code ?? "unknown"} and signal ${
            signal ?? "unknown"
          }. ${this.transport.stderrTail()}`.trim(),
          "PROVIDER_PROCESS_EXITED"
        )
      );
    });
  }

  static async start(config: CodexAppServerClientConfig): Promise<CodexAppServerClient> {
    return new CodexAppServerClient(config);
  }

  async initialize(params: CodexAppServerInitializeParams): Promise<unknown> {
    const initialized = await this.request("initialize", params);
    await this.notify("initialized", {});
    return initialized;
  }

  async startThread(
    params: CodexAppServerThreadStartParamsLike
  ): Promise<CodexAppServerThreadResponseLike> {
    return (await this.request(
      "thread/start",
      params
    )) as CodexAppServerThreadResponseLike;
  }

  async resumeThread(
    params: CodexAppServerThreadResumeParamsLike
  ): Promise<CodexAppServerThreadResponseLike> {
    return (await this.request(
      "thread/resume",
      params
    )) as CodexAppServerThreadResponseLike;
  }

  async startTurn(
    params: CodexAppServerTurnStartParamsLike
  ): Promise<CodexAppServerTurnResponseLike> {
    return (await this.request("turn/start", params)) as CodexAppServerTurnResponseLike;
  }

  async interruptTurn(threadId: string, turnId: string): Promise<unknown> {
    return this.request("turn/interrupt", {
      threadId,
      turnId
    });
  }

  events(): AsyncIterable<CodexAppServerInboundMessage> {
    return this.queue;
  }

  async respond(id: CodexAppServerJsonRpcId, result: unknown): Promise<void> {
    this.write({
      id,
      result
    });
  }

  async respondError(
    id: CodexAppServerJsonRpcId,
    error: CodexAppServerErrorLike
  ): Promise<void> {
    this.write({
      error,
      id
    });
  }

  async close(): Promise<void> {
    this.rl.close();
    this.queue.close();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(
        new HarnessError("Codex app-server client was closed.", "PROVIDER_CLOSED")
      );
    }
    this.pending.clear();
    if (!this.transport.process.killed) {
      this.transport.process.kill();
    }
  }

  private async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new HarnessError(
            `Timed out waiting for Codex app-server response to ${method}.`,
            "PROVIDER_TIMEOUT"
          )
        );
      }, this.config.requestTimeoutMs);
      this.pending.set(id, {
        reject,
        resolve,
        timer
      });
    });
    this.write({
      id,
      method,
      params
    });
    return promise;
  }

  private async notify(method: string, params: unknown): Promise<void> {
    this.write({
      method,
      params
    });
  }

  private write(message: unknown): void {
    this.transport.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch (error) {
      this.queue.push({
        method: "metaharness/parseError",
        params: {
          error,
          line
        }
      });
      return;
    }
    if (!isRecord(message)) {
      return;
    }
    if ("id" in message && !("method" in message)) {
      this.handleResponse(message as unknown as CodexAppServerResponseLike);
      return;
    }
    if (typeof message.method === "string") {
      this.queue.push(message as unknown as CodexAppServerInboundMessage);
    }
  }

  private handleResponse(response: CodexAppServerResponseLike): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    if (response.error) {
      pending.reject(
        new HarnessError(
          response.error.message,
          typeof response.error.code === "string"
            ? response.error.code
            : "PROVIDER_RPC_ERROR"
        )
      );
      return;
    }
    pending.resolve(response.result);
  }

  private fail(error: Error): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    this.queue.fail(error);
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private closed = false;
  private error: Error | undefined;
  private readonly resolvers: Array<(result: IteratorResult<T>) => void> = [];
  private readonly values: T[] = [];

  push(value: T): void {
    if (this.closed) {
      return;
    }
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver({
        done: false,
        value
      });
      return;
    }
    this.values.push(value);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const resolver of this.resolvers.splice(0)) {
      resolver({
        done: true,
        value: undefined as T
      });
    }
  }

  fail(error: Error): void {
    this.error = error;
    this.close();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.values.length > 0) {
        yield this.values.shift() as T;
        continue;
      }
      if (this.error) {
        throw this.error;
      }
      if (this.closed) {
        return;
      }
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.resolvers.push(resolve);
      });
      if (this.error) {
        throw this.error;
      }
      if (next.done) {
        return;
      }
      yield next.value;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
