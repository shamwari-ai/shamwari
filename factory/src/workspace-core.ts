import { OPENCODE_ARGV, OPENCODE_PORT, CA_PATH, opencodeEnv } from "./opencode";

/**
 * One person's workspace: the logic of the `FactoryWorkspace` Durable Object
 * (workspace.ts), written against interfaces so test/workspace.test.ts can run
 * it against a fake container in Node.
 *
 * It follows Cloudflare's Sandbox SDK 1.0 pattern ("Replace the Sandbox
 * class", "Move outbound rules", "Run a server in the background" and "Start
 * an OpenCode server"): the Durable Object starts its own container, routes
 * every HTTP and HTTPS request the container makes through the `Outbound`
 * entrypoint, starts `opencode serve` once per container, and proxies the
 * OpenCode web UI and API through its own fetch().
 *
 * What the container is given: the OpenCode configuration and switches
 * (opencode.ts). What it is NOT given: any credential, any Shamwari account
 * data, any Internet route except through the Worker.
 */

/** Big enough for OpenCode's server: on `lite` it did not answer in 30 s (Cloudflare's OpenCode notes). */
export const INSTANCE = "standard-1" as const;
/** Sleep after 15 idle minutes. The person's files go with the container (see docs/factory.md). */
export const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
const SERVER_DIR = "/var/lib/servers/opencode";
const SERVER_START_MS = 60_000;
const GATEWAY_KEY = "gateway";
/** A credential that lapses sooner than this is not handed out. */
const CREDENTIAL_MARGIN_MS = 30_000;

// From Cloudflare's "Run a server in the background": starts the server in its
// own process group unless it already runs in THIS instance (boot id check).
const CURRENT = `current() {
	read -r pid boot 2>/dev/null <"$1/pid" &&
		[ "$boot" = "$(cat /proc/sys/kernel/random/boot_id)" ]
}`;
const SERVE = `${CURRENT}
dir=$1; shift
current "$dir" && kill -0 "$pid" 2>/dev/null && exit 0
mkdir -p "$dir" && rm -f "$dir/pid"
setsid sh -c 'echo "$$ $(cat /proc/sys/kernel/random/boot_id)" >"$0/pid"; exec "$@"' \\
	"$dir" "$@" >"$dir/log" 2>&1`;
const EXITED = `${CURRENT}
current "$1" || exit 1
kill -0 "$pid" 2>/dev/null && exit 1
tail -n 20 "$1/log"`;
/** The HTTPS intercept's CA appears once the intercept is registered. */
const CA_READY = [
  "timeout",
  "10",
  "sh",
  "-c",
  `until [ -s ${CA_PATH} ]; do sleep 0.1; done`,
];

export interface StorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export interface FilesLike {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
}

export interface WorkspaceDeps {
  container: Container;
  storage: StorageLike;
  /** The `Outbound` entrypoint, bound to this workspace (ctx.exports.Outbound({ props })). */
  outbound: Fetcher;
  files: FilesLike;
  gatewayOrigin: string;
  now(): number;
  wait(ms: number): Promise<void>;
}

interface StoredCredential {
  token: string;
  expiresAt: number;
}

export class WorkspaceCore {
  private setup: Promise<void> | null = null;
  private serverReady = false;

  constructor(private readonly d: WorkspaceDeps) {}

  /** Set up each new container, and a running one after the Durable Object restarts. */
  ensureRunning(): Promise<void> {
    if (this.setup === null || !this.d.container.running) {
      this.setup = this.startContainer().catch((error) => {
        this.setup = null;
        throw error;
      });
    }
    return this.setup;
  }

  private async startContainer(): Promise<void> {
    const c = this.d.container;
    if (!c.running) {
      this.serverReady = false;
      c.start({
        image: c.images.factory!,
        instance: INSTANCE,
        // No route out except the two intercepts below.
        enableInternet: false,
      });
    }
    try {
      await c.interceptAllOutboundHttp(this.d.outbound);
      await c.interceptOutboundHttps("*", this.d.outbound);
      await this.run(CA_READY, "the intercept certificate did not appear");
      await this.d.files.mkdir("/workspace", { recursive: true });
      await c.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    } catch (error) {
      // The next request starts a new container; none runs half set up.
      await c.destroy();
      throw error;
    }
  }

  private async run(argv: string[], failure: string): Promise<void> {
    const p = await this.d.container.exec(argv);
    if ((await p.exitCode) !== 0) throw new Error(failure);
  }

  /** Start `opencode serve` once per container and wait until it answers. */
  async openCode(): Promise<Fetcher> {
    await this.ensureRunning();
    const c = this.d.container;
    const server = c.getTcpPort(OPENCODE_PORT);
    if (this.serverReady) return server;
    await c.exec(["sh", "-c", SERVE, "sh", SERVER_DIR, ...OPENCODE_ARGV], {
      cwd: "/workspace",
      env: opencodeEnv(this.d.gatewayOrigin),
      // Ignoring the output lets the server outlive this request.
      stdout: "ignore",
      stderr: "ignore",
    });
    const deadline = this.d.now() + SERVER_START_MS;
    while (this.d.now() < deadline) {
      try {
        const r = await server.fetch("http://opencode/", {
          signal: AbortSignal.timeout(1_000),
        });
        await r.body?.cancel();
        this.serverReady = true;
        return server;
      } catch {
        const check = await c.exec(["sh", "-c", EXITED, "sh", SERVER_DIR]);
        const out = await check.output();
        if (out.exitCode === 0) {
          // The log is OpenCode's own output; it is not returned to the browser.
          console.error(
            "opencode exited:",
            new TextDecoder().decode(out.stdout).slice(-500),
          );
          throw new Error("OpenCode exited during start");
        }
        await this.d.wait(500);
      }
    }
    throw new Error("OpenCode did not answer in time");
  }

  /**
   * The OpenCode web UI and API, at the root of the factory hostname. The UI
   * finds its server from `?url=`; a page load without it, or with any other
   * value, is sent back to the same page with this origin, so a link cannot
   * point the person's UI at someone else's server.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const accept = request.headers.get("Accept") ?? "";
    const page =
      request.method === "GET" &&
      (accept.includes("text/html") || url.pathname === "/");
    if (page && url.searchParams.get("url") !== url.origin) {
      url.searchParams.set("url", url.origin);
      return new Response(null, {
        status: 302,
        headers: { Location: url.toString(), "Cache-Control": "no-store" },
      });
    }
    const server = await this.openCode();
    // The container port accepts only http: URLs.
    url.protocol = "http:";
    return server.fetch(new Request(url.toString(), request));
  }

  /** Called by the Worker on every signed-in request, with the token it just verified. */
  async setGatewayCredential(token: string, expiresAt: number): Promise<void> {
    const prev = await this.d.storage.get<StoredCredential>(GATEWAY_KEY);
    if (prev && prev.token === token) return;
    await this.d.storage.put<StoredCredential>(GATEWAY_KEY, {
      token,
      expiresAt,
    });
  }

  /** What the Outbound entrypoint hands the gateway; null once it has lapsed. */
  async gatewayCredential(): Promise<string | null> {
    const v = await this.d.storage.get<StoredCredential>(GATEWAY_KEY);
    if (!v) return null;
    if (v.expiresAt * 1000 - this.d.now() < CREDENTIAL_MARGIN_MS) return null;
    return v.token;
  }
}
